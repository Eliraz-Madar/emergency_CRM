from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.decorators import action, api_view, parser_classes, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django.http import StreamingHttpResponse
from django.db.models import Q
from django.utils import timezone
import json
import time
import os
import queue
import threading

# Per-connection queues for the field SSE stream
_field_sse_queues: list = []
_field_sse_lock = threading.Lock()


def _push_field_sse(event: dict):
    with _field_sse_lock:
        for q in list(_field_sse_queues):
            try:
                q.put_nowait(event)
            except Exception:
                pass

from .models import (
    Incident, Task, Unit, IncidentEvent, ReportMedia, PushToken,
    FieldCommand, FieldCommandNote, FieldCommandMission,
    MajorIncident, IncidentFigureReport,
)
from .serializers import (
    IncidentSerializer, TaskSerializer, UnitSerializer, IncidentEventSerializer,
    FieldCommandSerializer, FieldCommandMissionSerializer,
    MajorIncidentSerializer, MajorIncidentGoLiveSerializer,
    PerimeterSerializer, SectorSerializer, TaskGroupSerializer,
    IncidentFigureReportSerializer, FIGURE_FIELDS,
)
from .permissions import ReadOnlyOrAdminDispatcher, TaskPermission, ACTOR_ROLE_HEADER
# Kept solely because field_incident_detail() below (part of the training
# simulation, out of scope for the mock->real migration) still uses it for an
# optional cosmetic location lookup. Every dashboard-facing mock_* endpoint
# that used to depend on this service has been removed.
from simulated.mock_data import get_mock_service
from simulated.realtime import get_realtime_service
from simulated.field_incident_data import get_field_incident_service
import time as _time


def _has_real_position(unit):
    """True if `unit` already carries a genuine GPS fix worth protecting from
    being overwritten by a device's no-GPS fallback (mobile-app/utils/
    location.js MOCK_LOCATION, sent with is_mock_location=true). (0, 0) is the
    seed default for a brand-new routine-dispatch unit — not a real position
    either."""
    return (
        unit.location_lat is not None and unit.location_lng is not None
        and (unit.location_lat, unit.location_lng) != (0.0, 0.0)
    )


def normalize_unit_type(unit_type):
    """Return a canonical UI/dispatch type used by the web dashboard and mobile app."""
    if unit_type is None:
        return "POLICE"

    raw = str(unit_type).strip().upper().replace("-", "_").replace(" ", "_")

    if raw in {"POLICE", "POLICEMAN", "POLICE_CAR", "PATROL", "COP"}:
        return "POLICE"
    if raw in {"FIRE", "FIRE_TRUCK", "FIREFIGHTER", "HAZMAT", "RESCUE", "TANKER"}:
        return "FIRE"
    if raw in {"MEDICAL", "MEDIC", "MEDICINE", "AMBULANCE", "EMS", "PARAMEDIC"}:
        return "MEDICAL"
    if raw.startswith("MED"):
        return "MEDICAL"
    if raw.startswith("FIRE") or raw.startswith("HAZ") or raw.startswith("RESC"):
        return "FIRE"
    if raw.startswith("POL") or raw.startswith("PATR") or raw.startswith("COP"):
        return "POLICE"
    return "POLICE"


def _log_status_change(*, incident=None, actor, title, description, severity=None,
                       event_type=None):
    """Record a manual status transition into IncidentEvent, attributed to the acting user."""
    IncidentEvent.objects.create(
        incident=incident,
        event_type=event_type or IncidentEvent.EventType.STATUS_CHANGE,
        severity=severity or IncidentEvent.Severity.INFO,
        title=title,
        description=description,
        created_by=getattr(actor, "username", "") or "system",
        actor_id=getattr(actor, "id", None),
    )


# Actions whose broadcasts must ALSO reach the Field Incident Command
# dashboard's own SSE stream (field_incident_updates_stream / _field_sse_queues
# — a separate channel from get_realtime_service()). These are the
# central-room writes that change what a single field command's own dashboard
# should display (its linked incidents, attached forces, open/closed state),
# so an already-open field dashboard reflects them without a manual reload.
# The payload is the full FieldCommandSerializer shape plus incident_id/
# unit_id — see FieldCommandViewSet.perform_create/assign_unit/assign_incident/
# close — and carries field_command_id (the public field_key) so the client
# can ignore events for other posts.
_FIELD_DASHBOARD_RELAYED_ACTIONS = frozenset({
    "field_command_incident_assigned",
    "field_command_incident_unassigned",
    "field_command_unit_assigned",
    "field_command_closed",
    "field_command_mission_created",
    "field_command_mission_updated",
    # A unit on a linked incident sent a status change / field report — the
    # post's Operational Timeline should reflect it live (see
    # TaskViewSet.perform_update / field_incident_add_event).
    "field_command_note_added",
    # A crew on a linked incident dropped offline / came back — the post's
    # assigned-forces status must flip live, not wait for a manual refresh.
    "unit_claimed",
    "unit_disconnected",
})


def _broadcast_realtime(event: dict):
    """
    Push a real-time event to every client connected to /api/mock/updates/stream/.
    Only ever called from request handlers reacting to a genuine, explicit
    write — never from a timer or simulator (see "final changes/01_..." for
    the background tickers that were removed for exactly that reason).
    """
    event.setdefault("timestamp", _time.time())
    get_realtime_service().broadcast(event)
    if event.get("action") in _FIELD_DASHBOARD_RELAYED_ACTIONS:
        _push_field_sse(event)


def _actor_fields(actor):
    return {
        "user_id": getattr(actor, "id", None),
        "username": getattr(actor, "username", "") or "system",
        "role": getattr(actor, "role", "") or "",
    }


def _log_field_command_note(field_command, kind, message):
    """Append a typed entry to a field command's operational log. These
    surface on the field command's own Operational Timeline (via
    FieldCommandSerializer.get_operational_notes) so the post sees every
    tasking / assignment it receives from the central room — persisted, not
    just a transient toast."""
    FieldCommandNote.objects.create(
        field_command=field_command, kind=kind, message=message,
    )


def _mission_actor_label(actor, mission):
    """"<Force> · <Unit name>" identifying who moved a mission — the force the
    task belongs to and the specific mobile unit that reported it. Falls back
    to the login name, then a generic label, when a piece is missing."""
    force = mission.get_force_type_display() if mission.force_type else ""
    unit = getattr(getattr(actor, "unit", None), "name", "") or ""
    if force and unit:
        return f"{force} · {unit}"
    if unit:
        return unit
    if force:
        return f"{force} · {getattr(actor, 'username', '') or 'field unit'}"
    return getattr(actor, "username", "") or "the field"


def _log_task_to_incident_feed(mission, actor, title, description):
    """Mirror a force-typed task (FieldCommandMission scoped to an Incident)
    into that incident's own Event Log — created and status-advanced tasks
    both show up in the war-room's incident Events tab, not just the field
    command's Operational Timeline."""
    if not mission.incident_id:
        return
    _log_status_change(
        incident=mission.incident, actor=actor,
        title=title, description=description,
        event_type=IncidentEvent.EventType.ASSIGNMENT,
    )
    _broadcast_realtime({
        "type": "user_action",
        "action": "incident_event_added",
        "incident_id": mission.incident_id,
        "title": title,
    })


# ── En-route trip (shared movement simulation) ─────────────────────────────
# In-memory only, like _field_sse_queues — a trip is transient and it's fine
# for it to vanish on restart (a reconnecting crew re-triggers it lazily). Both
# the war-room map and the mobile map read the SAME trip via
# GET /api/tasks/<id>/trip/, so the vehicle's position, ETA and distance always
# agree between the two screens.
_active_trips: dict = {}
_active_trips_lock = threading.Lock()

# Both clients compress the drive by this factor so a demo isn't a 15-minute
# wait. MUST stay in sync with TRIP_SPEEDUP in the web Dashboard and the
# mobile IncidentMapScreen.
TRIP_SPEEDUP = 8


def _fetch_osrm_route(from_lat, from_lng, to_lat, to_lng):
    """Return (coords[[lat,lng]...], duration_s, distance_m). Falls back to a
    straight line at ~40 km/h so a trip always has a drawable path."""
    import urllib.request
    import json as _json
    url = (
        "https://router.project-osrm.org/route/v1/driving/"
        f"{from_lng},{from_lat};{to_lng},{to_lat}"
        "?overview=full&geometries=geojson"
    )
    try:
        with urllib.request.urlopen(url, timeout=6) as resp:
            data = _json.loads(resp.read().decode("utf-8"))
        route = (data.get("routes") or [None])[0]
        geo = ((route or {}).get("geometry") or {}).get("coordinates") or []
        if route and len(geo) >= 2:
            coords = [[lat, lng] for lng, lat in geo]
            return coords, float(route.get("duration") or 0.0), float(route.get("distance") or 0.0)
    except Exception:
        pass
    import math
    dlat, dlng = to_lat - from_lat, to_lng - from_lng
    approx_km = math.hypot(dlat * 111.0, dlng * 96.0)
    steps = 24
    coords = [
        [from_lat + dlat * i / steps, from_lng + dlng * i / steps]
        for i in range(steps + 1)
    ]
    return coords, (approx_km / 40.0) * 3600.0, approx_km * 1000.0


def _start_trip(task, from_lat, from_lng, accepted_at=None):
    """Record that a drive began. The OSRM path is fetched lazily on the first
    GET /tasks/<id>/trip/ so this stays fast inside the PATCH request.

    `accepted_at` is normally "now" (the crew just tapped "On My Way"), but a
    lazy rebuild after a server restart passes the task's own timestamp so the
    vehicle resumes at the right point on the road instead of snapping back to
    the start."""
    incident = task.incident
    if from_lat is None or from_lng is None or incident is None:
        return
    if accepted_at is None:
        accepted_at = timezone.now()
    with _active_trips_lock:
        _active_trips[task.id] = {
            "task_id": task.id,
            "incident_id": incident.id,
            "unit_id": task.assigned_unit_id,
            "from_lat": from_lat,
            "from_lng": from_lng,
            "incident_lat": incident.location_lat,
            "incident_lng": incident.location_lng,
            "coords": None,
            "duration_s": None,
            "distance_m": None,
            "speedup": TRIP_SPEEDUP,
            "accepted_at": accepted_at.isoformat(),
        }


def _resolved_trip(task_id):
    """Return the trip with its OSRM path filled in (fetching it once)."""
    with _active_trips_lock:
        trip = _active_trips.get(task_id)
        needs_path = trip is not None and not trip.get("coords")
    if needs_path:
        coords, duration_s, distance_m = _fetch_osrm_route(
            trip["from_lat"], trip["from_lng"],
            trip["incident_lat"], trip["incident_lng"])
        with _active_trips_lock:
            trip = _active_trips.get(task_id)
            if trip is not None:
                trip["coords"] = coords
                trip["duration_s"] = duration_s
                trip["distance_m"] = distance_m
    return trip


def _end_trip(task_id):
    with _active_trips_lock:
        _active_trips.pop(task_id, None)


def _end_trips_for_incident(incident_id):
    with _active_trips_lock:
        for tid in [k for k, v in _active_trips.items() if v.get("incident_id") == incident_id]:
            _active_trips.pop(tid, None)


def _trip_position(task_id, now_dt=None):
    """Where the vehicle for `task_id` is RIGHT NOW along its active trip, as
    (lat, lng) — or None if there's no resolved trip. Mirrors the client-side
    interpolation (mobile-app/utils/trip.js tripState) so a server snapshot
    lands exactly where the moving marker was."""
    import math
    from django.utils.dateparse import parse_datetime

    trip = _resolved_trip(task_id)
    coords = trip.get("coords") if trip else None
    if not coords or len(coords) < 2:
        return None
    duration_s = trip.get("duration_s") or 0
    if duration_s <= 0:
        return tuple(coords[-1])
    accepted = parse_datetime(trip.get("accepted_at") or "")
    if accepted is None:
        return tuple(coords[0])
    elapsed_s = ((now_dt or timezone.now()) - accepted).total_seconds()
    speedup = trip.get("speedup") or TRIP_SPEEDUP
    progress = max(0.0, min(1.0, (elapsed_s * speedup) / duration_s))

    def _hav(a, b):
        dlat = math.radians(b[0] - a[0])
        dlng = math.radians(b[1] - a[1])
        s = (math.sin(dlat / 2) ** 2
             + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0]))
             * math.sin(dlng / 2) ** 2)
        return 6371.0 * 2 * math.atan2(math.sqrt(s), math.sqrt(1 - s))

    seg = [_hav(coords[i - 1], coords[i]) for i in range(1, len(coords))]
    total = sum(seg)
    if total == 0:
        return tuple(coords[-1])
    target = progress * total
    for i, d in enumerate(seg):
        if target <= d or i == len(seg) - 1:
            t = max(0.0, min(1.0, target / d)) if d > 0 else 0.0
            return (coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
                    coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t)
        target -= d
    return tuple(coords[-1])


def _active_task_for_unit(unit):
    """The unit's current non-terminal Task on a live incident, or None."""
    if unit is None:
        return None
    return (
        unit.tasks.select_related("incident")
        .exclude(status__in=Task.TERMINAL_STATUSES)
        .exclude(incident__status__in=(Incident.Status.RESOLVED, Incident.Status.CLOSED))
        .order_by("-timestamp")
        .first()
    )


def _unit_field_key(unit):
    """The public field_key of the Field Command coordinating this unit's
    current incident, or None. Lets a unit connect/disconnect broadcast tell
    the field war-room which post to refresh."""
    task = _active_task_for_unit(unit)
    incident = getattr(task, "incident", None)
    fc = getattr(incident, "field_command", None)
    return getattr(fc, "field_key", None)


class IncidentViewSet(viewsets.ModelViewSet):
    queryset = Incident.objects.all().order_by("-created_at")
    serializer_class = IncidentSerializer
    permission_classes = [ReadOnlyOrAdminDispatcher]

    def perform_create(self, serializer):
        # IncidentSerializer.validate_status() already forces status=OPEN on create.
        instance = serializer.save()
        actor = self.request.user
        _log_status_change(
            incident=instance,
            actor=actor,
            title="Incident created",
            description=f"Incident created with status {instance.status}.",
        )
        _broadcast_realtime({
            "type": "user_action",
            "action": "incident_created",
            **_actor_fields(actor),
            "incident_id": instance.id,
            "incident_title": instance.title,
            "status": instance.status,
            # Full IncidentSerializer shape so a client can insert this
            # directly into its incidents list/map with no re-fetch — same
            # fields every other incident in that list already has (id,
            # title, description, location_lat, location_lng, priority,
            # status, channel, field_command, field_command_name,
            # created_at, tasks, assigned_unit_ids, closed_* , major_incident).
            **IncidentSerializer(instance).data,
        })

    def perform_update(self, serializer):
        old_status = serializer.instance.status
        instance = serializer.save()
        if instance.status != old_status:
            actor = self.request.user
            _log_status_change(
                incident=instance,
                actor=actor,
                title=f"Incident status changed: {old_status} → {instance.status}",
                description=(
                    f"Changed by {getattr(actor, 'username', 'unknown')} "
                    f"(role={getattr(actor, 'role', '') or 'unknown'})."
                ),
                severity=(
                    IncidentEvent.Severity.WARNING
                    if instance.status == Incident.Status.CLOSED
                    else IncidentEvent.Severity.INFO
                ),
            )
            _broadcast_realtime({
                "type": "user_action",
                "action": "incident_status_update",
                **_actor_fields(actor),
                "incident_id": instance.id,
                "incident_title": instance.title,
                "old_status": old_status,
                "new_status": instance.status,
            })

            # Arriving on scene (or resolving/closing) ends the drive, so the
            # war-room and mobile both stop the vehicle at the incident.
            if instance.status in (
                Incident.Status.ON_SCENE, Incident.Status.RESOLVED, Incident.Status.CLOSED,
            ):
                _end_trips_for_incident(instance.id)

            # A closed incident releases its forces: cancel every non-terminal
            # task so no unit stays "assigned" to it anywhere (dashboard panels,
            # the vehicle card, the mobile task list).
            if instance.status == Incident.Status.CLOSED:
                stale = list(instance.tasks.exclude(status__in=Task.TERMINAL_STATUSES))
                for t in stale:
                    t.status = Task.Status.CANCELLED
                    t.save(update_fields=["status"])
                    if t.assigned_unit_id:
                        _broadcast_realtime({
                            "type": "user_action",
                            "action": "incident_unit_unassigned",
                            **_actor_fields(actor),
                            "incident_id": instance.id,
                            "unit_id": t.assigned_unit_id,
                        })

            # Mirror the transition onto a linked Field Command Post's
            # Operational Timeline. TaskViewSet.perform_update already does this
            # for task-status changes, but an incident advanced directly — most
            # importantly the mobile app driving it to ON_SCENE when a crew taps
            # "Arrived" (see mobile-app/utils/taskActions.markArrived, which
            # PATCHes /api/incidents/<id>/ and never the task) — reached the
            # field commander's timeline nowhere until now.
            if instance.field_command_id:
                fc = instance.field_command
                active_task = (
                    instance.tasks
                    .exclude(status__in=Task.TERMINAL_STATUSES)
                    .select_related("assigned_unit")
                    .order_by("-timestamp")
                    .first()
                )
                unit = active_task.assigned_unit if active_task else None
                unit_name = (
                    unit.name if unit
                    else (f"Unit {active_task.mock_unit_id}"
                          if active_task and active_task.mock_unit_id else "A unit")
                )
                if instance.status == Incident.Status.ON_SCENE:
                    note_msg = f"{unit_name} arrived on scene at '{instance.title}' and is starting operations."
                else:
                    note_msg = (
                        f"Incident '{instance.title}' status changed: "
                        f"{old_status} → {instance.status}."
                    )
                _log_field_command_note(fc, FieldCommandNote.Kind.STATUS, note_msg)
                _broadcast_realtime({
                    "type": "user_action",
                    "action": "field_command_note_added",
                    **_actor_fields(actor),
                    "field_command_id": fc.field_key,
                    "incident_id": instance.id,
                    **FieldCommandSerializer(fc).data,
                })

    @action(detail=True, methods=["post"], url_path="assign-unit")
    def assign_unit(self, request, pk=None):
        """Assign a real Unit to this incident by creating a Task — the
        dashboard's real equivalent of the old mock_incident_assign."""
        incident = self.get_object()
        unit_id = request.data.get("unit_id")
        if not unit_id:
            return Response({"detail": "unit_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            unit = Unit.objects.get(pk=unit_id)
        except (Unit.DoesNotExist, ValueError, TypeError):
            return Response({"detail": "Unit not found."}, status=status.HTTP_404_NOT_FOUND)

        # Reuse only a LIVE task for this (incident, unit) pair. A previous
        # dispatch that was cancelled / completed leaves a terminal Task behind;
        # get_or_create would hand that back and the crew would be re-dispatched
        # to an incident that never reappears in their app. Start a fresh
        # PENDING task in that case.
        task = (
            Task.objects.filter(incident=incident, assigned_unit=unit)
            .exclude(status__in=Task.TERMINAL_STATUSES)
            .order_by("-timestamp")
            .first()
        )
        created = task is None
        if created:
            task = Task.objects.create(
                incident=incident, assigned_unit=unit,
                title=f"Respond: {incident.title}", status=Task.Status.PENDING,
            )
        actor = self.request.user
        if created:
            _log_status_change(
                incident=incident, actor=actor,
                title=f"{unit.name} assigned to {incident.title}",
                description=f"Assigned by {getattr(actor, 'username', '') or 'command center'}.",
            )
            _broadcast_realtime({
                "type": "user_action",
                "action": "incident_unit_assigned",
                **_actor_fields(actor),
                "incident_id": incident.id,
                "unit_id": unit.id,
            })

            # Advance OPEN -> PENDING so the mobile app can accept the dispatch
            # (PENDING -> EN_ROUTE). Never forces past a state the field/operator
            # already advanced the incident to.
            if incident.status == Incident.Status.OPEN:
                allowed, _err = incident.can_transition_to(
                    Incident.Status.PENDING, "dispatcher")
                if allowed:
                    old_status = incident.status
                    incident.status = Incident.Status.PENDING
                    incident.save(update_fields=["status"])
                    _log_status_change(
                        incident=incident, actor=actor,
                        title=f"Incident status changed: {old_status} → {incident.status}",
                        description="Automatically advanced on unit assignment.",
                    )
                    _broadcast_realtime({
                        "type": "user_action",
                        "action": "incident_status_update",
                        **_actor_fields(actor),
                        "incident_id": incident.id,
                        "incident_title": incident.title,
                        "old_status": old_status,
                        "new_status": incident.status,
                    })

            # Field Command Post linked to this incident should log the dispatch.
            if incident.field_command_id:
                fc = incident.field_command
                _log_field_command_note(
                    fc, FieldCommandNote.Kind.FORCE_ASSIGNED,
                    f"{unit.name} dispatched to '{incident.title}'.",
                )
                _broadcast_realtime({
                    "type": "user_action",
                    "action": "field_command_note_added",
                    **_actor_fields(actor),
                    "field_command_id": fc.field_key,
                    "incident_id": incident.id,
                    **FieldCommandSerializer(fc).data,
                })

            _notify_unit_dispatched(unit.id, incident.title, incident.id)
        return Response(self.get_serializer(incident).data)

    @action(detail=True, methods=["post"], url_path="note")
    def add_note(self, request, pk=None):
        incident = self.get_object()
        note = request.data.get("note")
        if not note:
            return Response({"detail": "note is required."}, status=status.HTTP_400_BAD_REQUEST)
        actor = self.request.user
        _log_status_change(incident=incident, actor=actor, title="Note added", description=note)
        return Response(self.get_serializer(incident).data)

    @action(detail=True, methods=["post"], url_path="unassign-unit")
    def unassign_unit(self, request, pk=None):
        """Undo an assign-unit: cancel the unit's non-terminal Task on this
        incident. Real equivalent of the old mobile_cancel_dispatch for
        panel/map-driven dispatch."""
        incident = self.get_object()
        unit_id = request.data.get("unit_id")
        if not unit_id:
            return Response({"detail": "unit_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        cancelled = (
            Task.objects.filter(incident=incident, assigned_unit_id=unit_id)
            .exclude(status__in=Task.TERMINAL_STATUSES)
            .update(status=Task.Status.CANCELLED)
        )
        actor = self.request.user
        if cancelled:
            _log_status_change(
                incident=incident, actor=actor,
                title="Unit unassigned",
                description=f"Dispatch cancelled by {getattr(actor, 'username', '') or 'command center'}.",
            )
            _broadcast_realtime({
                "type": "user_action",
                "action": "incident_unit_unassigned",
                **_actor_fields(actor),
                "incident_id": incident.id,
                "unit_id": unit_id,
            })
            try:
                _set_registry_status(int(unit_id), "Available")
            except (TypeError, ValueError):
                pass
        return Response(self.get_serializer(incident).data)

    @action(detail=True, methods=["get", "post"], url_path="figures",
            permission_classes=[IsAuthenticated])
    def figures(self, request, pk=None):
        """Field crews' casualty headcounts for this incident.

        GET  -> every crew's latest {injured,dead,trapped,treated,evacuated}.
        POST -> upsert the calling crew's row (keyed on the user's unit) with a
                fresh full set of numbers. The linked Field Command Post's
                totals refresh live off the `field_command_note_added` /
                `incident_event_added` broadcasts below.
        """
        incident = self.get_object()

        if request.method == "GET":
            qs = incident.figure_reports.select_related("unit").all()
            return Response(IncidentFigureReportSerializer(qs, many=True).data)

        actor = request.user
        unit = getattr(actor, "unit", None)
        counts = {}
        for f in FIGURE_FIELDS:
            try:
                counts[f] = max(0, int(request.data.get(f, 0) or 0))
            except (TypeError, ValueError):
                counts[f] = 0

        report, _created = IncidentFigureReport.objects.update_or_create(
            incident=incident, unit=unit,
            defaults={**counts, "reported_by": getattr(actor, "username", "") or "Field unit"},
        )

        unit_name = unit.name if unit is not None else (getattr(actor, "username", "") or "Field unit")
        summary_line = " · ".join(
            f"{f.capitalize()} {counts[f]}" for f in FIGURE_FIELDS
        )
        _log_status_change(
            incident=incident, actor=actor,
            title=f"Casualty figures — {unit_name}",
            description=summary_line,
            event_type=IncidentEvent.EventType.CASUALTY_UPDATE,
        )
        _broadcast_realtime({
            "type": "user_action",
            "action": "incident_event_added",
            "incident_id": incident.id,
            "title": f"Casualty figures — {unit_name}",
        })
        if incident.field_command_id:
            fc = incident.field_command
            _log_field_command_note(
                fc, FieldCommandNote.Kind.STATUS,
                f"{unit_name} reported figures on '{incident.title}': {summary_line}.",
            )
            _broadcast_realtime({
                "type": "user_action",
                "action": "field_command_note_added",
                **_actor_fields(actor),
                "field_command_id": fc.field_key,
                "incident_id": incident.id,
                **FieldCommandSerializer(fc).data,
            })

        qs = incident.figure_reports.select_related("unit").all()
        return Response(
            IncidentFigureReportSerializer(qs, many=True).data,
            status=status.HTTP_200_OK,
        )


class TaskViewSet(viewsets.ModelViewSet):
    queryset = Task.objects.select_related(
        "incident", "assigned_unit").all().order_by("-timestamp")
    serializer_class = TaskSerializer
    permission_classes = [TaskPermission]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params

        if params.get("incident"):
            qs = qs.filter(incident_id=params["incident"])

        # Mobile app passes ?mock_unit=<id> to filter by the specific dispatched unit.
        # Since the mobile app now claims a real Unit (POST /api/units/claim/) and
        # passes that Unit's real pk here, <id> may match either the legacy
        # mock_unit_id (set by the routine-unit dispatch bridge, mobile_dispatch())
        # or the real assigned_unit FK (set by IncidentViewSet.assign_unit) — a task
        # dispatched to this unit by either path must be visible here.
        if params.get("mock_unit"):
            try:
                unit_id = int(params["mock_unit"])
                qs = qs.filter(Q(mock_unit_id=unit_id) | Q(assigned_unit_id=unit_id))
            except (ValueError, TypeError):
                qs = qs.none()

        return qs

    def perform_update(self, serializer):
        old_status = serializer.instance.status
        new_status = serializer.validated_data.get("status", old_status)

        # Atomic claim of the transition — same rationale as TaskViewSet.arrive.
        # `UPDATE ... WHERE status = <old>` is a single serialised statement, so
        # of two near-simultaneous PATCHes that both read the task as PENDING
        # only ONE flips it (`transitioned` True) and runs the side effects
        # below — the event-log line, trip start/stop and dashboard broadcasts.
        # The loser writes 0 rows here, still returns a clean response, but
        # never logs a second "en route" / "arrived" record for the same change.
        transitioned = False
        if new_status != old_status:
            transitioned = bool(
                Task.objects
                .filter(pk=serializer.instance.pk, status=old_status)
                .update(status=new_status)
            )

        instance = serializer.save()
        if transitioned:
            actor = self.request.user
            incident = instance.incident
            unit = instance.assigned_unit
            unit_name = (
                unit.name if unit
                else (f"Unit {instance.mock_unit_id}" if instance.mock_unit_id else "Unit")
            )
            # Human-readable headline for the regional dashboard's event log —
            # "Engine 3 en route to Structure Fire" reads better there than
            # "Task 'Respond' status changed".
            if instance.status == Task.Status.IN_PROGRESS and old_status != Task.Status.IN_PROGRESS:
                event_title = f"{unit_name} en route to {incident.title}"
            elif instance.status == Task.Status.DONE:
                event_title = f"{unit_name} completed its task on {incident.title}"
            elif instance.status == Task.Status.CANCELLED:
                event_title = f"{unit_name} stood down from {incident.title}"
            else:
                event_title = f"Task '{instance.title}' status changed"
            _log_status_change(
                incident=incident,
                actor=actor,
                title=event_title,
                description=(
                    f"{old_status} → {instance.status} by "
                    f"{getattr(actor, 'username', 'unknown')} "
                    f"(role={getattr(actor, 'role', '') or 'unknown'})."
                ),
            )

            # "On My Way": a unit accepting its task starts the shared en-route
            # trip and advances the incident into EN_ROUTE.
            if instance.status == Task.Status.IN_PROGRESS and old_status != Task.Status.IN_PROGRESS:
                _start_trip(
                    instance,
                    getattr(unit, "location_lat", None),
                    getattr(unit, "location_lng", None),
                )
            if instance.status in Task.TERMINAL_STATUSES:
                _end_trip(instance.id)

            if instance.status == Task.Status.IN_PROGRESS and incident.status in (
                Incident.Status.OPEN, Incident.Status.PENDING,
            ):
                inc_old = incident.status
                incident.status = Incident.Status.EN_ROUTE
                incident.save(update_fields=["status"])
                # No second IncidentEvent here — the task event above already
                # reads "<unit> en route to <incident>". Logging "Incident
                # status changed: PENDING → EN_ROUTE" too just doubles the
                # "en route" line in the regional event log. The broadcast is
                # still needed so other dashboards move the incident status.
                _broadcast_realtime({
                    "type": "user_action",
                    "action": "incident_status_update",
                    **_actor_fields(actor),
                    "incident_id": incident.id,
                    "incident_title": incident.title,
                    "old_status": inc_old,
                    "new_status": incident.status,
                })

            # Fires for every caller (field unit accepting/arriving/completing,
            # or a dispatcher/admin editing status directly) since both paths
            # below funnel through perform_update(). Carries unit/incident
            # context so the dashboard can draw the route + announce en route
            # without a re-fetch.
            _broadcast_realtime({
                "type": "user_action",
                "action": "task_status_update",
                **_actor_fields(actor),
                "task_id": instance.id,
                "task_title": instance.title,
                "old_status": old_status,
                "new_status": instance.status,
                "unit_id": unit.id if unit else None,
                "unit_name": unit_name,
                "incident_id": incident.id,
                "incident_lat": incident.location_lat,
                "incident_lng": incident.location_lng,
            })

            # Mirror the update into the linked Field Command Post's log so its
            # Operational Timeline reflects everything its assigned units report.
            if incident.field_command_id:
                fc = incident.field_command
                if instance.status == Task.Status.IN_PROGRESS and old_status != Task.Status.IN_PROGRESS:
                    fc_msg = f"{unit_name} en route to '{incident.title}'."
                elif instance.status == Task.Status.DONE:
                    fc_msg = f"{unit_name} completed its task on '{incident.title}'."
                elif instance.status == Task.Status.CANCELLED:
                    fc_msg = f"{unit_name} stood down from '{incident.title}'."
                else:
                    fc_msg = f"{unit_name}: {old_status} → {instance.status} on '{incident.title}'"
                _log_field_command_note(fc, FieldCommandNote.Kind.STATUS, fc_msg)
                _broadcast_realtime({
                    "type": "user_action",
                    "action": "field_command_note_added",
                    **_actor_fields(actor),
                    "field_command_id": fc.field_key,
                    "incident_id": incident.id,
                    **FieldCommandSerializer(fc).data,
                })

    def partial_update(self, request, *args, **kwargs):
        user_role = getattr(request.user, "role", "")

        if user_role == "fieldunit":
            status_value = request.data.get("status")
            if status_value is None:
                return Response({"detail": "Field units can only update status."}, status=status.HTTP_400_BAD_REQUEST)
            kwargs["partial"] = True
            instance = self.get_object()
            serializer = self.get_serializer(
                instance, data={"status": status_value}, partial=True)
            serializer.is_valid(raise_exception=True)
            self.perform_update(serializer)
            return Response(serializer.data)
        return super().partial_update(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="arrive",
            permission_classes=[IsAuthenticated])
    def arrive(self, request, pk=None):
        """The field crew confirms it has physically reached the scene.

        This — never the war-room's trip animation — is what flips the
        vehicle to "on scene / starting operations" on every dashboard and
        fires the arrival announcement. Idempotent: tapping twice is a no-op
        past the first call.
        """
        task = self.get_object()
        actor = request.user
        incident = task.incident
        unit = task.assigned_unit
        unit_name = (
            unit.name if unit
            else (f"Unit {task.mock_unit_id}" if task.mock_unit_id else "Unit")
        )

        # Atomic claim of the arrival. `UPDATE ... WHERE arrived_at IS NULL` is
        # a single statement the database serialises, so exactly ONE concurrent
        # caller updates a row — the others update 0 and fall straight through
        # to the no-op return. Without this, two near-simultaneous /arrive/
        # calls (crew double-taps, or taps "Arrived" and immediately files an
        # "on scene" report — both hit this endpoint) could each read
        # arrived_at as NULL and both run every side effect, logging and
        # announcing the same arrival two or three times. Every side effect —
        # status change, timeline entries and ALL broadcasts — stays behind
        # this guard.
        stamped_at = timezone.now()
        claimed = (
            Task.objects
            .filter(pk=task.pk, arrived_at__isnull=True)
            .update(arrived_at=stamped_at)
        )
        if not claimed:
            return Response(self.get_serializer(self.get_object()).data)

        task.arrived_at = stamped_at
        _end_trip(task.id)

        # Park the vehicle ON the event — heartbeats stop moving a dispatched
        # unit, so without this its stored position would drift to wherever
        # the trip animation last left it, and a reconnect would show it just
        # short of the scene instead of at it.
        if unit is not None and incident is not None and incident.location_lat is not None:
            unit.location_lat = incident.location_lat
            unit.location_lng = incident.location_lng
            unit.save(update_fields=["location_lat", "location_lng"])

        inc_old = incident.status if incident else None
        incident_advanced = False
        if incident is not None:
            allowed, _err = incident.can_transition_to(
                Incident.Status.ON_SCENE, "fieldunit")
            if allowed:
                incident.status = Incident.Status.ON_SCENE
                incident.save(update_fields=["status"])
                incident_advanced = True
                _end_trips_for_incident(incident.id)

        if incident is not None:
            _log_status_change(
                incident=incident, actor=actor,
                title=f"{unit_name} arrived on scene",
                description=(
                    f"{unit_name} confirmed arrival and is starting operations "
                    f"on '{incident.title}'."
                ),
            )
            if incident.field_command_id:
                fc = incident.field_command
                _log_field_command_note(
                    fc, FieldCommandNote.Kind.STATUS,
                    f"{unit_name} arrived on scene at '{incident.title}' and is starting operations.",
                )
                _broadcast_realtime({
                    "type": "user_action",
                    "action": "field_command_note_added",
                    **_actor_fields(actor),
                    "field_command_id": fc.field_key,
                    "incident_id": incident.id,
                    **FieldCommandSerializer(fc).data,
                })

        if incident_advanced:
            _broadcast_realtime({
                "type": "user_action",
                "action": "incident_status_update",
                **_actor_fields(actor),
                "incident_id": incident.id,
                "incident_title": incident.title,
                "old_status": inc_old,
                "new_status": incident.status,
            })

        _broadcast_realtime({
            "type": "user_action",
            "action": "task_arrived",
            **_actor_fields(actor),
            "task_id": task.id,
            "task_title": task.title,
            "unit_id": unit.id if unit else task.mock_unit_id,
            "unit_name": unit_name,
            "incident_id": incident.id if incident else None,
        })

        return Response(self.get_serializer(task).data)

    @action(detail=False, methods=["get"], url_path="by-incident/(?P<incident_id>[^/.]+)")
    def by_incident(self, request, incident_id=None):
        tasks = self.get_queryset().filter(incident_id=incident_id)
        serializer = self.get_serializer(tasks, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["get"], url_path="trip",
            permission_classes=[ReadOnlyOrAdminDispatcher])
    def trip(self, request, pk=None):
        """The active en-route trip for this task — the single source of truth
        for the vehicle's road path, ETA and distance, read by BOTH the
        war-room map and the mobile map so they never disagree. Anonymous-
        readable (the war-room isn't an authenticated client)."""
        task = self.get_object()
        with _active_trips_lock:
            exists = task.id in _active_trips
        # A crew is driving for as long as its own task is IN_PROGRESS and the
        # incident hasn't been resolved/closed — NOT only while the incident
        # sits at EN_ROUTE (a second unit, or this crew arriving, can push the
        # shared incident to ON_SCENE while this drive is still in progress).
        if not exists and task.status == Task.Status.IN_PROGRESS and task.incident and (
            task.incident.status not in (Incident.Status.RESOLVED, Incident.Status.CLOSED)
        ):
            # Server restarted mid-drive, or the trip was never started — rebuild
            # it from the unit's position, resuming at the task's accept time so
            # the vehicle doesn't jump back to the start.
            unit = task.assigned_unit
            _start_trip(
                task,
                getattr(unit, "location_lat", None),
                getattr(unit, "location_lng", None),
                accepted_at=task.timestamp,
            )
        trip = _resolved_trip(task.id)
        if trip is None:
            return Response({"detail": "No active trip."}, status=status.HTTP_404_NOT_FOUND)
        return Response(trip)

    @action(detail=True, methods=["get"], url_path="reports",
            permission_classes=[ReadOnlyOrAdminDispatcher])
    def reports(self, request, pk=None):
        """Field reports already filed against this task, newest first — the
        history the mobile report screen shows above the form so a crew can
        see what they've already sent. Each row is the full IncidentEvent
        shape (status line + notes in `description`, plus any `media`)."""
        task = self.get_object()
        events = (
            task.events.prefetch_related("media")
            .order_by("-created_at")
        )
        return Response(
            IncidentEventSerializer(events, many=True, context={"request": request}).data
        )


class UnitViewSet(viewsets.ModelViewSet):
    queryset = Unit.objects.all()
    serializer_class = UnitSerializer
    permission_classes = [ReadOnlyOrAdminDispatcher]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        # Mobile unit-selection: everything except units an *active* holder
        # (someone else, heartbeating recently) currently controls. A unit
        # whose previous holder's app died — stale last_seen — is claimable
        # again, and a user can always re-claim their own unit (so a
        # reconnecting device picks the same car instead of spawning a second).
        if params.get("claimable") == "true":
            user = getattr(self.request, "user", None)
            stale_cutoff = timezone.now() - Unit.HEARTBEAT_STALE_AFTER
            active_holder = (
                Q(app_user__isnull=False)
                & Q(is_online=True)
                & (Q(last_seen__isnull=True) | Q(last_seen__gte=stale_cutoff))
            )
            if user is not None and getattr(user, "is_authenticated", False):
                active_holder &= ~Q(app_user=user)
            qs = qs.exclude(active_holder)
        if params.get("type"):
            qs = qs.filter(type=params["type"])
        return qs

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        # Optional distance sort for "nearby units" on mobile unit selection.
        lat = request.query_params.get("lat")
        lng = request.query_params.get("lng")
        if lat is not None and lng is not None and isinstance(response.data, list):
            try:
                lat, lng = float(lat), float(lng)
                response.data.sort(
                    key=lambda u: (u["location_lat"] - lat) ** 2 + (u["location_lng"] - lng) ** 2
                )
            except (TypeError, ValueError, KeyError):
                pass
        return response

    @action(detail=True, methods=["get"], url_path="tasks")
    def tasks(self, request, pk=None):
        """Tasks currently assigned to this unit (strict FK — never the legacy
        mock_unit_id namespace). Powers the regional dashboard's
        selected-vehicle panel; a freshly-claimed unit with no dispatch has
        none. Inherits UnitViewSet's read permission (no auth required)."""
        unit = self.get_object()
        qs = (unit.tasks.select_related("incident")
              .all().order_by("-timestamp"))
        return Response(TaskSerializer(qs, many=True, context={"request": request}).data)

    @action(detail=False, methods=["post"], permission_classes=[IsAuthenticated])
    def claim(self, request):
        """
        Attach the authenticated user to a Unit: marks it online and sets its
        location from the device's current GPS. Accepts either an existing
        unit `id` (the normal mobile-selection path) or `name`/`type` to
        find-or-create one — reusing the exact same matching the war-room
        dispatch bridge uses (_get_or_create_db_unit_for_routine_unit), so a
        unit claimed this way lines up with what a dispatcher later
        dispatches by name. See final changes/05_user_unit_claiming_and_live_sync.md.
        """
        data = request.data
        try:
            lat = float(data.get("location_lat"))
            lng = float(data.get("location_lng"))
        except (TypeError, ValueError):
            return Response(
                {"detail": "location_lat and location_lng are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        unit_id = data.get("id")
        if unit_id:
            try:
                unit = Unit.objects.get(pk=unit_id)
            except (Unit.DoesNotExist, ValueError, TypeError):
                return Response({"detail": "Unit not found."}, status=status.HTTP_404_NOT_FOUND)
        else:
            unit = _get_or_create_db_unit_for_routine_unit({
                "name": data.get("name"),
                "type": data.get("type"),
            })
            if not unit:
                return Response(
                    {"detail": "id, or name and a valid type, are required."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        existing_owner = getattr(unit, "app_user", None)
        if existing_owner and existing_owner.id != request.user.id and unit.is_online:
            return Response(
                {"detail": f"Unit is already claimed by {existing_owner.username}."},
                status=status.HTTP_409_CONFLICT,
            )

        # Release any different unit this user previously held.
        previous_unit = getattr(request.user, "unit", None)
        if previous_unit and previous_unit.id != unit.id:
            previous_unit.is_online = False
            previous_unit.save(update_fields=["is_online"])

        request.user.unit = unit
        request.user.save(update_fields=["unit"])

        # A reconnecting crew's device often hasn't got a real GPS fix yet at
        # the exact moment it claims — mobile-app/utils/location.js falls back
        # to a fixed Tel-Aviv-center MOCK_LOCATION and flags is_mock_location.
        # Trust that fallback only for a genuinely new unit with no position on
        # file yet; otherwise keep the unit's last real fix so it doesn't
        # visibly teleport there and back on every reconnect.
        is_mock_location = str(data.get("is_mock_location", "")).strip().lower() in ("1", "true", "yes")
        # Take the incoming GPS only when we have no position at all yet, or
        # it's a real fix for a unit that's free to roam. A dispatched unit's
        # position is server-managed (claim spot → trip → arrival → disconnect
        # snapshot), so reconnecting keeps it exactly where it was.
        accept_gps = (
            not _has_real_position(unit)
            or (not is_mock_location and _active_task_for_unit(unit) is None)
        )
        update_fields = ["is_online", "last_seen", "availability_status"]
        if accept_gps:
            unit.location_lat = lat
            unit.location_lng = lng
            update_fields += ["location_lat", "location_lng"]
        unit.is_online = True
        unit.last_seen = timezone.now()
        unit.availability_status = "AVAILABLE"
        unit.save(update_fields=update_fields)

        IncidentEvent.objects.create(
            event_type=IncidentEvent.EventType.ASSIGNMENT,
            severity=IncidentEvent.Severity.INFO,
            title=f"Unit '{unit.name}' claimed",
            description=f"Claimed by {request.user.username} at [{unit.location_lat}, {unit.location_lng}].",
            created_by=request.user.username,
            actor_id=request.user.id,
        )
        _broadcast_realtime({
            "type": "user_action",
            "action": "unit_claimed",
            **_actor_fields(request.user),
            "unit_id": unit.id,
            "unit_name": unit.name,
            # The unit's ACTUAL (possibly-kept-from-before) position, never the
            # raw device coords — otherwise a rejected mock fix would still
            # snap the war-room's marker to it via this broadcast.
            "location_lat": unit.location_lat,
            "location_lng": unit.location_lng,
            # So the field war-room showing this unit's post refreshes the
            # assigned-forces status live on reconnect (not just on refresh).
            "field_command_id": _unit_field_key(unit),
        })

        return Response(self.get_serializer(unit).data, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"], permission_classes=[IsAuthenticated])
    def disconnect(self, request):
        """Mobile logout / app-initiated release. Marks the unit offline AND
        freezes it where it is: the vehicle's last position before the
        disconnect (its interpolated spot if it was mid-drive) is snapshotted
        so reconnecting resumes from there, not from the phone's real GPS. A
        drive that hadn't arrived yet is rolled back to PENDING so the crew
        gets the "On My Way" button again on reconnect."""
        unit = getattr(request.user, "unit", None)
        if not unit:
            return Response({"detail": "No unit linked to user."}, status=status.HTTP_400_BAD_REQUEST)

        task = _active_task_for_unit(unit)
        reverted_task = None
        if task is not None:
            if task.arrived_at is not None:
                # Parked on scene — freeze at the event.
                if task.incident and task.incident.location_lat is not None:
                    unit.location_lat = task.incident.location_lat
                    unit.location_lng = task.incident.location_lng
            elif task.status == Task.Status.IN_PROGRESS:
                pos = _trip_position(task.id)
                if pos is not None:
                    unit.location_lat, unit.location_lng = pos[0], pos[1]
                _end_trip(task.id)
                # Roll back so the crew re-accepts on reconnect (and so the
                # trip endpoint won't silently resurrect the drive).
                task.status = Task.Status.PENDING
                task.save(update_fields=["status"])
                reverted_task = task

        unit.is_online = False
        unit.last_seen = timezone.now()
        unit.save(update_fields=["is_online", "last_seen", "location_lat", "location_lng"])

        if reverted_task is not None:
            _broadcast_realtime({
                "type": "user_action",
                "action": "task_status_update",
                **_actor_fields(request.user),
                "task_id": reverted_task.id,
                "task_title": reverted_task.title,
                "old_status": Task.Status.IN_PROGRESS,
                "new_status": Task.Status.PENDING,
                "unit_id": unit.id,
                "unit_name": unit.name,
                "incident_id": reverted_task.incident_id,
                "incident_lat": getattr(reverted_task.incident, "location_lat", None),
                "incident_lng": getattr(reverted_task.incident, "location_lng", None),
            })

        _broadcast_realtime({
            "type": "user_action",
            "action": "unit_disconnected",
            **_actor_fields(request.user),
            "unit_id": unit.id,
            "unit_name": unit.name,
            "location_lat": unit.location_lat,
            "location_lng": unit.location_lng,
            "field_command_id": _unit_field_key(unit),
        })
        return Response({"status": "disconnected"})


class FieldCommandViewSet(viewsets.ModelViewSet):
    """
    Real, DB-backed Field Command Post feature — replaces
    MockDataService.field_commands / the mock_field_*/field_* endpoints
    below. NOT the Field Incident Command Dashboard training simulation
    (see simulated/field_incident_data.py), which this does not touch.
    """
    queryset = FieldCommand.objects.all().order_by("-created_at")
    serializer_class = FieldCommandSerializer
    permission_classes = [ReadOnlyOrAdminDispatcher]
    lookup_field = "field_key"
    lookup_value_regex = "[^/]+"

    def perform_create(self, serializer):
        instance = serializer.save()
        actor = self.request.user
        _broadcast_realtime({
            "type": "user_action",
            "action": "field_command_created",
            **_actor_fields(actor),
            "field_command_id": instance.field_key,
            "status": instance.status,
            # Full FieldCommandSerializer shape (note field_key IS the
            # serializer's "id" — same identifier the frontend already keys
            # on everywhere, never the internal numeric pk) so a client can
            # insert this directly with no re-fetch, same as incident_created
            # (Stage 1).
            **FieldCommandSerializer(instance).data,
        })

    @action(detail=True, methods=["post"], url_path="assign-unit")
    def assign_unit(self, request, field_key=None):
        field_command = self.get_object()
        unit_id = request.data.get("unit_id")
        if not unit_id:
            return Response({"detail": "unit_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            unit = Unit.objects.get(pk=unit_id)
        except (Unit.DoesNotExist, ValueError, TypeError):
            return Response({"detail": "Unit not found."}, status=status.HTTP_404_NOT_FOUND)
        already_here = unit.field_command_id == field_command.id
        unit.field_command = field_command
        unit.save(update_fields=["field_command"])
        actor = request.user
        if not already_here:
            _log_field_command_note(
                field_command, FieldCommandNote.Kind.FORCE_ASSIGNED,
                f"Force attached by command center: {unit.name} ({unit.type}).",
            )
        _broadcast_realtime({
            "type": "user_action",
            "action": "field_command_unit_assigned",
            **_actor_fields(actor),
            "field_command_id": field_command.field_key,
            "unit_id": unit.id,
            "status": field_command.status,
            **FieldCommandSerializer(field_command).data,
        })
        return Response(self.get_serializer(field_command).data)

    @action(detail=True, methods=["post"], url_path="assign-incident")
    def assign_incident(self, request, field_key=None):
        """Link a regular Incident to this Field Command Post (operator-initiated)."""
        field_command = self.get_object()
        # A post opened by escalating a specific incident ("Go Live") belongs to
        # that incident alone — it can never take on additional incidents.
        if field_command.major_incident_id is not None:
            return Response(
                {"detail": "This field command was opened from a single incident and cannot take on others."},
                status=status.HTTP_409_CONFLICT,
            )
        incident_id = request.data.get("incident_id")
        if not incident_id:
            return Response({"detail": "incident_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            incident = Incident.objects.get(pk=incident_id)
        except (Incident.DoesNotExist, ValueError, TypeError):
            return Response({"detail": "Incident not found."}, status=status.HTTP_404_NOT_FOUND)

        if incident.field_command_id is not None and incident.field_command_id != field_command.id:
            return Response(
                {"detail": "This incident is already linked to an active field command."},
                status=status.HTTP_409_CONFLICT,
            )

        already_here = incident.field_command_id == field_command.id
        incident.field_command = field_command
        incident.save(update_fields=["field_command"])
        actor = request.user
        if not already_here:
            _log_field_command_note(
                field_command, FieldCommandNote.Kind.INCIDENT_LINKED,
                f"Incident assigned by command center: {incident.title}.",
            )
        _broadcast_realtime({
            "type": "user_action",
            "action": "field_command_incident_assigned",
            **_actor_fields(actor),
            "field_command_id": field_command.field_key,
            "incident_id": incident.id,
            "status": field_command.status,
            **FieldCommandSerializer(field_command).data,
        })
        return Response(self.get_serializer(field_command).data)

    @action(detail=True, methods=["post"], url_path="unassign-incident")
    def unassign_incident(self, request, field_key=None):
        """Remove an Incident's link to this Field Command Post so it can be
        linked to a different one (operator-initiated re-assignment)."""
        field_command = self.get_object()
        incident_id = request.data.get("incident_id")
        if not incident_id:
            return Response({"detail": "incident_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            incident = Incident.objects.get(pk=incident_id)
        except (Incident.DoesNotExist, ValueError, TypeError):
            return Response({"detail": "Incident not found."}, status=status.HTTP_404_NOT_FOUND)

        if incident.field_command_id != field_command.id:
            return Response(
                {"detail": "This incident is not linked to this field command."},
                status=status.HTTP_409_CONFLICT,
            )

        incident.field_command = None
        incident.save(update_fields=["field_command"])
        actor = request.user
        _log_field_command_note(
            field_command, FieldCommandNote.Kind.STATUS,
            f"Incident unlinked by command center: {incident.title}.",
        )
        _broadcast_realtime({
            "type": "user_action",
            "action": "field_command_incident_unassigned",
            **_actor_fields(actor),
            "field_command_id": field_command.field_key,
            "incident_id": incident.id,
            "status": field_command.status,
            **FieldCommandSerializer(field_command).data,
        })
        return Response(self.get_serializer(field_command).data)

    def _broadcast_mission(self, action, field_command, mission, actor):
        _broadcast_realtime({
            "type": "user_action",
            "action": action,
            **_actor_fields(actor),
            "field_command_id": field_command.field_key,
            "mission_id": mission.id,
            "status": field_command.status,
            **FieldCommandSerializer(field_command).data,
        })

    @action(detail=True, methods=["get", "post"], url_path="missions")
    def missions(self, request, field_key=None):
        """List (GET) or create (POST) missions for this field command post.
        A mission is a titled tasking, optionally handed to one of the post's
        attached forces — see FieldCommandMission."""
        field_command = self.get_object()
        if request.method == "GET":
            qs = field_command.missions.select_related("incident", "assigned_unit").all()
            incident_id = request.query_params.get("incident")
            if incident_id:
                qs = qs.filter(incident_id=incident_id)
            force_type = request.query_params.get("force_type")
            if force_type:
                qs = qs.filter(force_type=force_type.upper())
            return Response(FieldCommandMissionSerializer(qs, many=True).data)

        if field_command.status == FieldCommand.Status.CLOSED:
            return Response(
                {"detail": "This field command is closed."},
                status=status.HTTP_409_CONFLICT)

        # Accept `incident_id` as an alias for `incident` (this codebase's
        # convention elsewhere). A task created from an incident panel must
        # name the incident it's for and the force responsible.
        payload = {k: v for k, v in request.data.items()}
        incident_id = payload.pop("incident_id", None) or payload.get("incident")
        if incident_id:
            if not Incident.objects.filter(pk=incident_id).exists():
                return Response({"detail": "Incident not found."}, status=status.HTTP_404_NOT_FOUND)
            payload["incident"] = incident_id

        serializer = FieldCommandMissionSerializer(
            data=payload, context={"field_command": field_command})
        serializer.is_valid(raise_exception=True)
        mission = serializer.save(field_command=field_command)
        actor = request.user
        assignee = (
            f" → {mission.assigned_unit.name}" if mission.assigned_unit_id
            else (f" ({mission.get_force_type_display()})" if mission.force_type else "")
        )
        scope = f" for '{mission.incident.title}'" if mission.incident_id else ""
        _log_field_command_note(
            field_command, FieldCommandNote.Kind.MISSION,
            f"Task assigned by command center: {mission.title}{scope}{assignee}.",
        )
        force = mission.get_force_type_display() if mission.force_type else "the field"
        _log_task_to_incident_feed(
            mission, actor,
            title=f"Task assigned to {force}: {mission.title}",
            description="Assigned from the war room.",
        )
        self._broadcast_mission("field_command_mission_created", field_command, mission, actor)
        return Response(
            self.get_serializer(field_command).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["patch"], url_path=r"missions/(?P<mission_id>[^/]+)")
    def mission_detail(self, request, field_key=None, mission_id=None):
        """Update a mission (status, assignee, title, details)."""
        field_command = self.get_object()
        if field_command.status == FieldCommand.Status.CLOSED:
            return Response(
                {"detail": "This field command is closed."},
                status=status.HTTP_409_CONFLICT)
        try:
            mission = field_command.missions.get(pk=mission_id)
        except (FieldCommandMission.DoesNotExist, ValueError, TypeError):
            return Response({"detail": "Mission not found."}, status=status.HTTP_404_NOT_FOUND)

        old_status = mission.status
        serializer = FieldCommandMissionSerializer(
            mission, data=request.data, partial=True,
            context={"field_command": field_command})
        serializer.is_valid(raise_exception=True)
        mission = serializer.save()
        actor = request.user
        if mission.status != old_status:
            who = _mission_actor_label(actor, mission)
            _log_field_command_note(
                field_command, FieldCommandNote.Kind.MISSION,
                f"{who} — {mission.title}: {mission.get_status_display()}.",
            )
            _log_task_to_incident_feed(
                mission, actor,
                title=f"Task {mission.get_status_display().lower()}: {mission.title} — {who}",
                description=f"{who} marked it {mission.get_status_display().lower()}.",
            )
        self._broadcast_mission("field_command_mission_updated", field_command, mission, actor)
        return Response(self.get_serializer(field_command).data)

    @action(detail=True, methods=["patch"], url_path="metrics")
    def metrics(self, request, field_key=None):
        field_command = self.get_object()
        serializer = self.get_serializer(field_command, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request, field_key=None):
        field_command = self.get_object()
        data = {**request.data, "status": FieldCommand.Status.CLOSED}
        serializer = self.get_serializer(field_command, data=data, partial=True)
        serializer.is_valid(raise_exception=True)
        instance = serializer.save()
        actor = request.user
        _broadcast_realtime({
            "type": "user_action",
            "action": "field_command_closed",
            **_actor_fields(actor),
            "field_command_id": instance.field_key,
            "status": instance.status,
            **FieldCommandSerializer(instance).data,
        })
        return Response(serializer.data)


_SEVERITY_TO_LEVEL = {"INFO": "info", "WARNING": "warn", "CRITICAL": "error"}


@api_view(["GET"])
def incident_events(request):
    """
    Real event feed for the regional dashboard — replaces mock_events.
    Backed by IncidentEvent rows already written by IncidentViewSet/UnitViewSet
    for real incidents. Deliberately excludes rows with incident=None, which is
    how the field-incident training simulation's add-event endpoint persists
    its own timeline entries (see field_incident_add_event) — this keeps the
    two systems' event streams from mixing.
    """
    limit = request.query_params.get("limit", 50)
    incident_id_param = request.query_params.get("incident_id")
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 50

    qs = (
        IncidentEvent.objects.filter(incident__isnull=False)
        .prefetch_related("media")
        .order_by("-created_at")
    )
    if incident_id_param:
        qs = qs.filter(incident_id=incident_id_param)

    events = []
    for e in qs[:limit]:
        media = [
            {
                "id": m.id,
                "media_type": m.media_type,
                "file_url": (
                    request.build_absolute_uri(m.file.url) if m.file else None
                ),
            }
            for m in e.media.all()
        ]
        events.append({
            "id": e.id,
            "timestamp": e.created_at.isoformat(),
            "entity_type": "incident",
            "entity_id": e.incident_id,
            "message": e.title,
            # The regional Event Log renders these so a field report shows its
            # actual content — the written note and/or "photo/video attached" —
            # instead of just an opaque "Task Update: ..." headline.
            "description": e.description or "",
            "source": e.source or "",
            "media": media,
            "level": _SEVERITY_TO_LEVEL.get(e.severity, "info"),
        })
    return Response(events)


def _send_expo_push(tokens, title, body, data=None):
    """Send push notifications via Expo Push API (fire-and-forget)."""
    if not tokens:
        return
    import urllib.request
    import json as _json
    messages = [
        {"to": t, "title": title, "body": body, "sound": "default", "data": data or {}}
        for t in tokens
    ]
    payload = _json.dumps(messages).encode("utf-8")
    req = urllib.request.Request(
        "https://exp.host/--/api/v2/push/send",
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        urllib.request.urlopen(req, timeout=8)
    except Exception:
        pass


def _get_or_create_db_unit_for_routine_unit(unit_payload: dict):
    """Create or reuse a DB Unit record for a web/mobile routine unit to keep assignments aligned."""
    if not unit_payload:
        return None

    unit_name = str(unit_payload.get("name") or unit_payload.get("unit_name") or "").strip()
    if not unit_name:
        unit_id = unit_payload.get("id") or unit_payload.get("mock_unit_num")
        unit_name = f"Unit {unit_id}" if unit_id not in {None, ""} else "Routine Unit"

    normalized_type = normalize_unit_type(unit_payload.get("type"))
    db_unit_type = _ROUTINE_TYPE_TO_DB.get(normalized_type)
    if not db_unit_type:
        return None

    db_unit, _ = Unit.objects.get_or_create(
        name=unit_name,
        defaults={
            "type": db_unit_type,
            "location_lat": 0.0,
            "location_lng": 0.0,
            "availability_status": "AVAILABLE",
        },
    )
    if db_unit.type != db_unit_type:
        db_unit.type = db_unit_type
        db_unit.save(update_fields=["type"])
    return db_unit


@api_view(["POST"])
def register_push_token(request):
    """Register an Expo push token for a specific mock unit."""
    mock_unit_id = request.data.get("mock_unit_id")
    token = request.data.get("token", "").strip()
    if not mock_unit_id or not token:
        return Response({"detail": "mock_unit_id and token required."}, status=status.HTTP_400_BAD_REQUEST)
    PushToken.objects.update_or_create(
        token=token,
        defaults={"mock_unit_id": int(mock_unit_id)},
    )
    return Response({"status": "registered"})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def unit_heartbeat(request):
    """
    Update the linked `Unit` last-seen timestamp, mark it online, and — if
    the mobile app included them — update its live GPS coordinates.
    Called periodically (~every 20-30s) while the mobile app is active; see
    mobile-app/utils/heartbeat.js and final changes/05_....md.
    """
    user = request.user
    unit = getattr(user, "unit", None)
    if not unit:
        return Response({"detail": "No unit linked to user."}, status=status.HTTP_400_BAD_REQUEST)

    update_fields = ["last_seen", "is_online", "availability_status"]
    unit.last_seen = timezone.now()
    unit.is_online = True
    # Keep existing availability field in sync
    unit.availability_status = "AVAILABLE"

    location_lat = request.data.get("location_lat")
    location_lng = request.data.get("location_lng")
    is_mock_location = str(request.data.get("is_mock_location", "")).strip().lower() in ("1", "true", "yes")
    has_location = False
    if location_lat is not None and location_lng is not None:
        try:
            location_lat = float(location_lat)
            location_lng = float(location_lng)
            # Same rule as claim(): only take the GPS for a unit that's free to
            # roam. Once a unit is dispatched, its map position is entirely
            # server-managed (claim spot → trip interpolation → arrival →
            # disconnect snapshot) so a stationary demo phone's beats can't
            # drag the marker off the route.
            accept_gps = (
                not _has_real_position(unit)
                or (not is_mock_location and _active_task_for_unit(unit) is None)
            )
            if accept_gps:
                unit.location_lat = location_lat
                unit.location_lng = location_lng
                update_fields += ["location_lat", "location_lng"]
            has_location = True
        except (TypeError, ValueError):
            pass  # heartbeat is still valid without a usable location

    unit.save(update_fields=update_fields)

    _broadcast_realtime({
        "type": "user_action",
        "action": "unit_location_update" if has_location else "unit_heartbeat",
        **_actor_fields(user),
        "unit_id": unit.id,
        "unit_name": unit.name,
        "is_online": unit.is_online,
        "location_lat": unit.location_lat if has_location else None,
        "location_lng": unit.location_lng if has_location else None,
    })
    return Response({"ok": True, "location_updated": has_location})


# Server-Sent Events endpoint for real-time updates. NOT mock-specific
# despite its old name/URL — relays get_realtime_service() broadcasts, which
# every real viewset (Incident/Unit/Task) already pushes to via
# _broadcast_realtime(). Kept (and moved out from under /mock/) even though
# the rest of the mock endpoints were removed.
def updates_stream(request):
    """Stream real-time updates using Server-Sent Events."""
    realtime_service = get_realtime_service()

    def event_generator():
        # Send initial connection message
        yield f"data: {json.dumps({'type': 'connected', 'timestamp': time.time()})}\n\n"

        # Queue for events
        events_queue = []

        def on_event(event):
            events_queue.append(event)

        # Subscribe to updates
        unsubscribe = realtime_service.subscribe(on_event)

        # Keep connection alive and send events. The heartbeat is what makes a
        # DEAD connection get noticed: a browser that navigated away / reloaded
        # / dropped stays subscribed here until the next write fails, so a slow
        # heartbeat means stale subscribers pile up and every broadcast is
        # delivered to the (now reconnected) tab several times over. 2s keeps
        # that window tight.
        try:
            last_heartbeat = time.time()
            while True:
                # Send queued events
                while events_queue:
                    event = events_queue.pop(0)
                    yield f"data: {json.dumps(event)}\n\n"

                if time.time() - last_heartbeat > 2:
                    yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
                    last_heartbeat = time.time()

                time.sleep(0.1)
        except GeneratorExit:
            # Client disconnected and the server closed the generator — fall
            # through to `finally` so we unsubscribe immediately.
            pass
        finally:
            unsubscribe()

    response = StreamingHttpResponse(
        event_generator(),
        content_type="text/event-stream"
    )
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response


# ============================================
# FIELD INCIDENT COMMAND DASHBOARD ENDPOINTS
# ============================================

# Global field incident instances (mock data)
_field_incident_data = {}


def _get_field_incident_data(field_id=None):
    key = field_id or "default"
    data = _field_incident_data.get(key)
    if data is None and _field_incident_data:
        # Fall back to first active field incident
        data = next(iter(_field_incident_data.values()))
    return data


def _set_field_incident_data(field_id, data):
    key = field_id or "default"
    _field_incident_data[key] = data


@api_view(["GET"])
def field_incident_detail(request):
    """Get current major incident with all sectors and task groups."""
    field_id = request.query_params.get("fieldId")
    data = _get_field_incident_data(field_id)

    if data is None:
        seed = int(os.getenv("DEMO_SEED", "42"))
        field_service = get_field_incident_service(seed=seed)
        location_lat = None
        location_lng = None

        if field_id:
            mock_service = get_mock_service()
            field_summary = mock_service.get_field_summary(field_id)
            if field_summary:
                location_lat = field_summary.get("location_lat")
                location_lng = field_summary.get("location_lng")

        data = field_service.generate_major_incident(
            incident_type="EARTHQUAKE",
            location_lat=location_lat or 32.0853,
            location_lng=location_lng or 34.7818,
        )
        data["field_id"] = field_id
        _set_field_incident_data(field_id, data)

    return Response(data)


# NOTE: the old read/patch endpoints for the training-sim's fabricated
# sectors / task-groups / casualty numbers (field_incident_sectors,
# field_incident_task_groups, field_incident_events, field_incident_sector_update,
# field_incident_task_group_update, field_incident_casualty_update) were removed
# — nothing called them anymore. The field dashboard reads real data via the
# major-incident endpoints and advances the drill through /field/simulate/.


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def field_incident_add_event(request):
    """Add event to operational timeline with optional image/video attachments.

    Accepts multipart/form-data (for file uploads) or application/json (text-only).
    Files must be sent under the field name 'files' (multiple allowed).
    """
    field_id = request.query_params.get("fieldId")
    data = _get_field_incident_data(field_id)

    # `source` identifies which of the three timeline contributors logged
    # this event. Read directly off the declared X-Actor-Role header rather
    # than effective_role() — that helper collapses FIELD_OPERATOR and UNIT
    # onto the same underlying "fieldunit" User.Roles value (see
    # permissions.py), which would make the two indistinguishable here.
    declared_source = request.META.get(ACTOR_ROLE_HEADER, "")
    if declared_source not in IncidentEvent.Source.values:
        return Response(
            {"detail": (
                f"X-Actor-Role header is required and must be one of "
                f"{IncidentEvent.Source.values}."
            )},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # A real field report from the mobile app carries the incident it belongs
    # to. Linking the event to that incident makes it visible in the regional
    # event feed too (incident_events filters incident__isnull=False) and lets
    # it surface in a linked Field Command Post's timeline below. Text-only
    # training-sim entries still send no incident_id and stay unlinked.
    incident_obj = None
    incident_id_raw = request.data.get("incident_id")
    if incident_id_raw:
        try:
            incident_obj = Incident.objects.filter(pk=int(incident_id_raw)).first()
        except (TypeError, ValueError):
            incident_obj = None

    # A mobile field report also carries the dispatched task it belongs to.
    # Linking the event to that Task is what powers the per-task "previously
    # sent" history the mobile report screen shows (GET /api/tasks/<id>/reports/).
    task_obj = None
    task_id_raw = request.data.get("task_id")
    if task_id_raw:
        try:
            task_obj = Task.objects.filter(pk=int(task_id_raw)).first()
        except (TypeError, ValueError):
            task_obj = None
    if task_obj is not None and incident_obj is None:
        incident_obj = task_obj.incident

    # Persist the event to the database. created_by/actor_id follow
    # _log_status_change's pattern (views.py) — the resolved real actor, not
    # a client-supplied "created_by" string from the request body.
    actor = request.user
    event_obj = IncidentEvent.objects.create(
        incident=incident_obj,
        task=task_obj,
        event_type=request.data.get("event_type", "UPDATE"),
        severity=request.data.get("severity", "INFO"),
        title=request.data.get("title", "Event"),
        description=request.data.get("description", ""),
        source=declared_source,
        created_by=getattr(actor, "username", "") or "system",
        actor_id=getattr(actor, "id", None),
    )

    # Persist any uploaded files as ReportMedia records
    for uploaded_file in request.FILES.getlist("files"):
        content_type = uploaded_file.content_type or ""
        media_type = (
            ReportMedia.MediaType.VIDEO
            if content_type.startswith("video/")
            else ReportMedia.MediaType.IMAGE
        )
        ReportMedia.objects.create(event=event_obj, file=uploaded_file, media_type=media_type)

    serializer = IncidentEventSerializer(event_obj, context={"request": request})
    response_data = serializer.data

    # Surface the report on a linked Field Command Post's Operational Timeline.
    # The report itself (reporter, incident, notes, photos/videos) is carried by
    # FieldCommandSerializer.get_operational_notes, which folds in this
    # incident's UNIT-sourced IncidentEvents directly — so there's no flat
    # FieldCommandNote to log here, just a nudge for open dashboards to re-pull.
    if incident_obj is not None and incident_obj.field_command_id:
        fc = incident_obj.field_command
        _broadcast_realtime({
            "type": "user_action",
            "action": "field_command_note_added",
            "field_command_id": fc.field_key,
            "incident_id": incident_obj.id,
            **FieldCommandSerializer(fc, context={"request": request}).data,
        })

    # Nudge the regional dashboard's event log to re-pull so a field report
    # shows there live, not just after a page reload — for every linked
    # incident, field command or not.
    if incident_obj is not None:
        _broadcast_realtime({
            "type": "user_action",
            "action": "incident_event_added",
            "incident_id": incident_obj.id,
            "title": event_obj.title,
        })

    # Mirror into the in-memory event list so SSE streaming stays consistent
    in_memory_event = {
        "id": event_obj.id,
        "event_type": event_obj.event_type,
        "severity": event_obj.severity,
        "title": event_obj.title,
        "description": event_obj.description,
        "source": event_obj.source,
        "created_by": event_obj.created_by,
        "created_at": event_obj.created_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "media": response_data["media"],
    }
    if data is not None:
        data.setdefault("events", []).insert(0, in_memory_event)
        _push_field_sse({"type": "incident_update", "data": {"new_event": in_memory_event}})

    return Response(response_data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
def field_incident_simulate(request):
    """Simulate realistic updates to the field incident."""
    field_id = request.query_params.get("fieldId")
    data = _get_field_incident_data(field_id)

    if data is None:
        import os
        seed = int(os.getenv("DEMO_SEED", "42"))
        field_service = get_field_incident_service(seed=seed)
        data = field_service.generate_major_incident(
            incident_type="EARTHQUAKE")
        data["field_id"] = field_id
        _set_field_incident_data(field_id, data)

    # Get service and simulate update
    field_service = get_field_incident_service()
    update = field_service.simulate_update(data)

    # Apply updates to data
    if "estimated_casualties" in update:
        data["major_incident"]["estimated_casualties"] = update["estimated_casualties"]

    if "sector_updates" in update:
        for idx, sector_update in update["sector_updates"].items():
            data["sectors"][idx].update(sector_update)

    if "task_updates" in update:
        for idx, task_update in update["task_updates"].items():
            data["task_groups"][idx].update(task_update)

    if "new_event" in update:
        update["new_event"]["created_at"] = time.time()
        data["events"].insert(0, update["new_event"])

    return Response(update if update else {"status": "no_change"})


def field_incident_updates_stream(request):
    """Stream real-time field incident updates using Server-Sent Events."""
    def event_generator():
        q = queue.Queue()
        with _field_sse_lock:
            _field_sse_queues.append(q)
        try:
            yield f"data: {json.dumps({'type': 'connected', 'timestamp': time.time()})}\n\n"

            last_heartbeat = time.time()
            while True:
                # Drain any events pushed by add-event/ (e.g. mobile reports)
                while True:
                    try:
                        pushed = q.get_nowait()
                        yield f"data: {json.dumps(pushed)}\n\n"
                    except queue.Empty:
                        break

                # Auto-simulation disabled — this used to call simulate_update()
                # on a timer and could silently advance task/sector status
                # (e.g. to COMPLETED) with no incoming API request. Task and
                # incident state now only change via explicit calls to
                # /api/field/simulate/, /api/tasks/<id>/, etc.
                # See "final changes/01_disable_simulation_engine.md".
                # if random.random() < 0.3:
                #     field_service = get_field_incident_service()
                #     data = _get_field_incident_data(None) or {}
                #     update = field_service.simulate_update(data)
                #     if update.get("status") != "no_change":
                #         yield f"data: {json.dumps({'type': 'incident_update', 'data': update})}\n\n"

                # Heartbeat every 3s — see updates_stream: a slow heartbeat
                # lets a dead (navigated-away / reloaded) client stay
                # subscribed, so its events pile up and reach the reconnected
                # tab multiple times.
                if time.time() - last_heartbeat > 3:
                    yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
                    last_heartbeat = time.time()

                time.sleep(0.5)
        except GeneratorExit:
            pass
        finally:
            with _field_sse_lock:
                if q in _field_sse_queues:
                    _field_sse_queues.remove(q)

    response = StreamingHttpResponse(
        event_generator(),
        content_type="text/event-stream"
    )
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response


# ============================================
# MOBILE APP BRIDGE ENDPOINTS
# ============================================

# In-memory registry of routine units populated by the dashboard on load
_routine_units_registry: dict = {}

_VALID_MOBILE_STATUSES = {"Available", "Dispatched", "OnScene", "Offline"}


def _set_registry_status(mock_unit_id, mobile_status):
    """Mirror a unit's live status into the mobile registry, if it's registered."""
    entry = _routine_units_registry.get(mock_unit_id)
    if entry is not None and mobile_status in _VALID_MOBILE_STATUSES:
        entry["status"] = mobile_status


def _notify_unit_dispatched(unit_pk, incident_title, incident_key=None):
    """Push notification + mobile-registry side effects for a unit that was just
    dispatched to an incident. Shared by IncidentViewSet.assign_unit (real
    incident, panel/map dispatch) and mobile_dispatch (the SIMULATION drill's
    mock-incident bridge). PushToken rows for app-claimed units are keyed on the
    real Unit pk (see mobile-app UnitSelectScreen.registerPushToken)."""
    try:
        _set_registry_status(int(unit_pk), "Dispatched")
    except (TypeError, ValueError):
        pass
    tokens = list(
        PushToken.objects.filter(mock_unit_id=unit_pk).values_list("token", flat=True)
    )
    _send_expo_push(
        tokens,
        title="New Dispatch",
        body=f"{incident_title} — respond immediately",
        data={"incident_key": incident_key} if incident_key is not None else {},
    )


@api_view(["POST"])
def mobile_register_units(request):
    """Dashboard calls this on init to register its routine unit list for the mobile app."""
    for unit in request.data.get("units", []):
        raw_id = unit.get("id", "")
        try:
            num = int(str(raw_id).replace("routine-", ""))
        except (ValueError, TypeError):
            continue
        normalized_type = normalize_unit_type(unit.get("type"))
        _get_or_create_db_unit_for_routine_unit({
            "id": num,
            "name": unit.get("name", f"Unit {num}"),
            "type": normalized_type,
        })
        _routine_units_registry[num] = {
            "id":     num,
            "name":   unit.get("name", f"Unit {num}"),
            "type":   normalized_type,
            "status": "Available",
        }
    return Response({"status": "ok", "count": len(_routine_units_registry)})


@api_view(["GET"])
def mobile_units(request):
    """Returns registered routine units for mobile app unit selection, filtered by type."""
    unit_type = normalize_unit_type(request.query_params.get("type", ""))
    units = [u for u in _routine_units_registry.values()
             if not unit_type or u["type"] == unit_type]
    return Response(sorted(units, key=lambda u: u["id"]))


def _parse_incident_key(raw):
    """Convert any frontend incident ID (int or string like 'live-5') to a stable int."""
    if isinstance(raw, int):
        return raw
    s = str(raw)
    try:
        return int(s)
    except ValueError:
        pass
    for prefix in ("live-", "sim-", "routine-", "incident-"):
        if s.startswith(prefix):
            try:
                return int(s[len(prefix):])
            except ValueError:
                pass
    import hashlib
    return int(hashlib.md5(s.encode()).hexdigest()[:8], 16)


_ROUTINE_TYPE_TO_DB = {
    "POLICE":  "Police",
    "FIRE":    "Fire",
    "MEDICAL": "EMS",
}


@api_view(["POST"])
def mobile_dispatch(request):
    """Mirror a frontend dispatch into DB Tasks so mobile-app units see their assignments."""
    incident_id_raw = request.data.get("incident_id", "")
    incident_title  = request.data.get("incident_title", "Incident")
    location_lat    = request.data.get("location_lat")
    location_lng    = request.data.get("location_lng")
    priority        = request.data.get("priority", "HIGH")
    units           = request.data.get("units", [])

    if location_lat is None or location_lng is None:
        return Response({"detail": "location_lat and location_lng required."},
                        status=status.HTTP_400_BAD_REQUEST)

    inc_key = _parse_incident_key(incident_id_raw)

    try:
        # If the caller passed a real Incident pk, dispatch onto THAT incident —
        # never spin up a parallel mock_incident_id mirror row. Those mirrors
        # showed up as a duplicate "Theft"/"POLICE Dispatch" in the war-room
        # list (same title, empty channel, its own separate task) that only a
        # DB cleanup could remove. Only genuinely external/mock incident keys
        # (no matching pk) still get a bridge row.
        db_incident = Incident.objects.filter(pk=inc_key).first()
        if db_incident is None:
            db_incident, _ = Incident.objects.update_or_create(
                mock_incident_id=inc_key,
                defaults={
                    "title":        incident_title,
                    "description":  "",
                    "location_lat": float(location_lat),
                    "location_lng": float(location_lng),
                    "priority":     str(priority)[:16],
                    "status":       "IN_PROGRESS",
                },
            )
    except Exception:
        return Response({"detail": "DB error."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    tasks_created = 0
    for unit in units:
        mock_unit_num = unit.get("mock_unit_num")
        unit_type_str = unit.get("type", "")
        if not mock_unit_num:
            continue

        db_unit = _get_or_create_db_unit_for_routine_unit({
            "id": mock_unit_num,
            "name": unit.get("name") or f"Unit {mock_unit_num}",
            "type": unit_type_str,
        })
        _set_registry_status(int(mock_unit_num), "Dispatched")

        _, created = Task.objects.get_or_create(
            incident=db_incident,
            mock_unit_id=int(mock_unit_num),
            defaults={
                "assigned_unit": db_unit,
                "title":         f"Respond: {incident_title}",
                "status":        "PENDING",
            },
        )

        if created:
            tasks_created += 1
            tokens = list(
                PushToken.objects.filter(mock_unit_id=int(mock_unit_num))
                .values_list("token", flat=True)
            )
            _send_expo_push(
                tokens,
                title="New Dispatch",
                body=f"{incident_title} — respond immediately",
                data={"incident_key": inc_key},
            )

    _broadcast_realtime({
        "type": "user_action",
        "action": "unit_dispatched",
        **_actor_fields(request.user),
        "incident_key": inc_key,
        "incident_title": incident_title,
        "tasks_created": tasks_created,
        "unit_count": len(units),
    })

    return Response({"status": "ok", "tasks_created": tasks_created})


@api_view(["POST"])
def mobile_cancel_dispatch(request):
    """Cancel a dispatched unit's pending/in-progress task and notify the field device."""
    mock_unit_id = request.data.get("mock_unit_id")
    incident_id_raw = request.data.get("incident_id")

    if not mock_unit_id:
        return Response({"detail": "mock_unit_id required."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        mock_unit_id = int(mock_unit_id)
    except (ValueError, TypeError):
        return Response({"detail": "Invalid mock_unit_id."}, status=status.HTTP_400_BAD_REQUEST)

    tasks = Task.objects.filter(mock_unit_id=mock_unit_id, status__in=["PENDING", "IN_PROGRESS"])

    if incident_id_raw is not None:
        inc_key = _parse_incident_key(incident_id_raw)
        if inc_key is not None:
            tasks = tasks.filter(incident__mock_incident_id=inc_key)

    cancelled_count = tasks.update(status="CANCELLED")
    _set_registry_status(mock_unit_id, "Available")

    tokens = list(PushToken.objects.filter(mock_unit_id=mock_unit_id).values_list("token", flat=True))
    _send_expo_push(
        tokens,
        title="Dispatch Cancelled",
        body="Your dispatch has been cancelled. Return to patrol.",
        data={"cancelled": True, "mock_unit_id": mock_unit_id},
    )

    if cancelled_count > 0:
        _broadcast_realtime({
            "type": "user_action",
            "action": "dispatch_cancelled",
            **_actor_fields(request.user),
            "mock_unit_id": mock_unit_id,
            "tasks_cancelled": cancelled_count,
        })

    return Response({"status": "cancelled", "tasks_cancelled": cancelled_count})


@api_view(["POST"])
def mobile_unit_status(request):
    """Web dashboard calls this to mirror a routine unit's live status (OnScene/Available)
    into the mobile registry, so the mobile app's unit list matches what's on the map."""
    mock_unit_id = request.data.get("mock_unit_id")
    new_status = request.data.get("status")

    if not mock_unit_id or new_status not in _VALID_MOBILE_STATUSES:
        return Response({"detail": "mock_unit_id and a valid status are required."},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        mock_unit_id = int(mock_unit_id)
    except (ValueError, TypeError):
        return Response({"detail": "Invalid mock_unit_id."}, status=status.HTTP_400_BAD_REQUEST)

    _set_registry_status(mock_unit_id, new_status)
    _broadcast_realtime({
        "type": "user_action",
        "action": "unit_status_update",
        **_actor_fields(request.user),
        "mock_unit_id": mock_unit_id,
        "new_status": new_status,
    })
    return Response({"status": "ok"})


@api_view(["POST"])
def mobile_unit_heartbeat(request):
    """Receive heartbeat from mobile app to update unit status."""
    user = request.user
    if not user.is_authenticated:
        return Response({"detail": "Authentication required."}, status=status.HTTP_401_UNAUTHORIZED)

    try:
        unit = Unit.objects.get(app_user=user)
        unit.is_online = True
        unit.last_seen = timezone.now()
        unit.save(update_fields=["is_online", "last_seen"])
        return Response({"status": "ok", "unit_id": unit.id})
    except Unit.DoesNotExist:
        return Response({"detail": "Unit not found for user."}, status=status.HTTP_404_NOT_FOUND)


# ============================================
# REAL MAJOR INCIDENT / SECTOR / TASK GROUP / PERIMETER ENDPOINTS
# ============================================
# These back the real "go live" flow and are entirely separate from the
# FIELD INCIDENT COMMAND DASHBOARD ENDPOINTS section above (the
# _field_incident_data mock dict, /field/... routes, simulated/
# field_incident_data.py) — that section is untouched and stays the
# training-simulation backend. Role gating here follows IncidentSerializer's
# pattern: permission_classes stays permissive (ReadOnlyOrAdminDispatcher,
# effectively a no-op — see permissions.py), and the actual role check
# happens in the serializer's validate(), using effective_role(), returning
# a 400 on mismatch — not a 403 from permission_classes.

def _get_major_incident_or_404(major_incident_id):
    try:
        return MajorIncident.objects.get(pk=major_incident_id)
    except (MajorIncident.DoesNotExist, ValueError, TypeError):
        return None


@api_view(["POST"])
def major_incident_go_live(request):
    """Declare a MajorIncident from an existing (real) Incident. COMMAND_CENTER only."""
    serializer = MajorIncidentGoLiveSerializer(data=request.data, context={"request": request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    major_incident = serializer.save()
    return Response(MajorIncidentSerializer(major_incident).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "POST"])
def major_incident_perimeter(request, major_incident_id):
    """GET the latest submitted Perimeter (or null); POST a new one. FIELD_OPERATOR only for POST."""
    major_incident = _get_major_incident_or_404(major_incident_id)
    if major_incident is None:
        return Response({"detail": "MajorIncident not found."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        latest = major_incident.perimeters.first()  # Meta.ordering = ["-created_at"]
        return Response(PerimeterSerializer(latest).data if latest else None)

    serializer = PerimeterSerializer(data=request.data, context={"request": request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    perimeter = serializer.save(major_incident=major_incident)
    return Response(PerimeterSerializer(perimeter).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "POST"])
def major_incident_sectors(request, major_incident_id):
    """GET all Sectors for a MajorIncident; POST creates one (name + hazard_level). COMMAND_CENTER only for POST."""
    major_incident = _get_major_incident_or_404(major_incident_id)
    if major_incident is None:
        return Response({"detail": "MajorIncident not found."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        sectors = major_incident.sectors.all()
        return Response(SectorSerializer(sectors, many=True).data)

    serializer = SectorSerializer(data=request.data, context={"request": request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    sector = serializer.save(major_incident=major_incident)
    actor = request.user
    _broadcast_realtime({
        "type": "user_action",
        "action": "major_incident_sector_created",
        **_actor_fields(actor),
        "major_incident_id": major_incident.id,
        "sector_id": sector.id,
        "sector_name": sector.name,
        "sector": SectorSerializer(sector).data,
    })
    return Response(SectorSerializer(sector).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "POST"])
def major_incident_task_groups(request, major_incident_id):
    """GET all TaskGroups for a MajorIncident; POST creates one, optionally linking existing Sectors."""
    major_incident = _get_major_incident_or_404(major_incident_id)
    if major_incident is None:
        return Response({"detail": "MajorIncident not found."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        task_groups = major_incident.task_groups.all()
        return Response(TaskGroupSerializer(task_groups, many=True).data)

    serializer = TaskGroupSerializer(
        data=request.data,
        context={"request": request, "major_incident": major_incident},
    )
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    task_group = serializer.save(major_incident=major_incident)
    actor = request.user
    _broadcast_realtime({
        "type": "user_action",
        "action": "major_incident_task_group_created",
        **_actor_fields(actor),
        "major_incident_id": major_incident.id,
        "task_group_id": task_group.id,
        "task_group_title": task_group.title,
        "task_group": TaskGroupSerializer(task_group).data,
    })
    return Response(TaskGroupSerializer(task_group).data, status=status.HTTP_201_CREATED)
