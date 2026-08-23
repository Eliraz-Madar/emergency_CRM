from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.decorators import action, api_view, parser_classes, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django.http import JsonResponse, StreamingHttpResponse
from django.db.models import Q
from django.utils import timezone
import json
import time
import random
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
    FieldCommand,
    MajorIncident, Sector, TaskGroup, Perimeter,
)
from .serializers import (
    IncidentSerializer, TaskSerializer, UnitSerializer, IncidentEventSerializer,
    FieldCommandSerializer,
    MajorIncidentSerializer, MajorIncidentGoLiveSerializer,
    PerimeterSerializer, SectorSerializer, TaskGroupSerializer,
)
from .permissions import ReadOnlyOrAdminDispatcher, TaskPermission, effective_role, ACTOR_ROLE_HEADER
# Kept solely because field_incident_detail() below (part of the training
# simulation, out of scope for the mock->real migration) still uses it for an
# optional cosmetic location lookup. Every dashboard-facing mock_* endpoint
# that used to depend on this service has been removed.
from simulated.mock_data import get_mock_service
from simulated.realtime import get_realtime_service
from simulated.field_incident_data import get_field_incident_service
import time as _time


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


def _log_status_change(*, incident=None, actor, title, description, severity=None):
    """Record a manual status transition into IncidentEvent, attributed to the acting user."""
    IncidentEvent.objects.create(
        incident=incident,
        event_type=IncidentEvent.EventType.STATUS_CHANGE,
        severity=severity or IncidentEvent.Severity.INFO,
        title=title,
        description=description,
        created_by=getattr(actor, "username", "") or "system",
        actor_id=getattr(actor, "id", None),
    )


def _broadcast_realtime(event: dict):
    """
    Push a real-time event to every client connected to /api/mock/updates/stream/.
    Only ever called from request handlers reacting to a genuine, explicit
    write — never from a timer or simulator (see "final changes/01_..." for
    the background tickers that were removed for exactly that reason).
    """
    event.setdefault("timestamp", _time.time())
    get_realtime_service().broadcast(event)


def _actor_fields(actor):
    return {
        "user_id": getattr(actor, "id", None),
        "username": getattr(actor, "username", "") or "system",
        "role": getattr(actor, "role", "") or "",
    }


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

        task, created = Task.objects.get_or_create(
            incident=incident, assigned_unit=unit,
            defaults={"title": f"Respond: {incident.title}", "status": Task.Status.PENDING},
        )
        actor = self.request.user
        if created:
            _log_status_change(
                incident=incident, actor=actor,
                title=f"Unit '{unit.name}' assigned",
                description=f"Assigned by {getattr(actor, 'username', '') or 'command center'}.",
            )
            _broadcast_realtime({
                "type": "user_action",
                "action": "incident_unit_assigned",
                **_actor_fields(actor),
                "incident_id": incident.id,
                "unit_id": unit.id,
            })
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

        # Mobile app passes ?mock_unit=<id> to filter by the specific dispatched unit
        if params.get("mock_unit"):
            try:
                qs = qs.filter(mock_unit_id=int(params["mock_unit"]))
            except (ValueError, TypeError):
                qs = qs.none()

        return qs

    def perform_update(self, serializer):
        old_status = serializer.instance.status
        instance = serializer.save()
        if instance.status != old_status:
            actor = self.request.user
            _log_status_change(
                incident=instance.incident,
                actor=actor,
                title=f"Task '{instance.title}' status changed",
                description=(
                    f"{old_status} → {instance.status} by "
                    f"{getattr(actor, 'username', 'unknown')} "
                    f"(role={getattr(actor, 'role', '') or 'unknown'})."
                ),
            )
            # Fires for every caller (field unit accepting/arriving/completing,
            # or a dispatcher/admin editing status directly) since both paths
            # below funnel through perform_update().
            _broadcast_realtime({
                "type": "user_action",
                "action": "task_status_update",
                **_actor_fields(actor),
                "task_id": instance.id,
                "task_title": instance.title,
                "old_status": old_status,
                "new_status": instance.status,
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

    @action(detail=False, methods=["get"], url_path="by-incident/(?P<incident_id>[^/.]+)")
    def by_incident(self, request, incident_id=None):
        tasks = self.get_queryset().filter(incident_id=incident_id)
        serializer = self.get_serializer(tasks, many=True)
        return Response(serializer.data)


class UnitViewSet(viewsets.ModelViewSet):
    queryset = Unit.objects.all()
    serializer_class = UnitSerializer
    permission_classes = [ReadOnlyOrAdminDispatcher]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        # Mobile unit-selection: only units nobody currently holds, or that
        # are offline (never claimed, or a previous holder disconnected).
        if params.get("claimable") == "true":
            qs = qs.filter(Q(app_user__isnull=True) | Q(is_online=False))
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

        unit.location_lat = lat
        unit.location_lng = lng
        unit.is_online = True
        unit.last_seen = timezone.now()
        unit.availability_status = "AVAILABLE"
        unit.save(update_fields=[
            "location_lat", "location_lng", "is_online", "last_seen", "availability_status",
        ])

        IncidentEvent.objects.create(
            event_type=IncidentEvent.EventType.ASSIGNMENT,
            severity=IncidentEvent.Severity.INFO,
            title=f"Unit '{unit.name}' claimed",
            description=f"Claimed by {request.user.username} at [{lat}, {lng}].",
            created_by=request.user.username,
            actor_id=request.user.id,
        )
        _broadcast_realtime({
            "type": "user_action",
            "action": "unit_claimed",
            **_actor_fields(request.user),
            "unit_id": unit.id,
            "unit_name": unit.name,
            "location_lat": lat,
            "location_lng": lng,
        })

        return Response(self.get_serializer(unit).data, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"], permission_classes=[IsAuthenticated])
    def disconnect(self, request):
        """Mobile logout (or app-initiated release): mark the caller's claimed unit offline."""
        unit = getattr(request.user, "unit", None)
        if not unit:
            return Response({"detail": "No unit linked to user."}, status=status.HTTP_400_BAD_REQUEST)

        unit.is_online = False
        unit.last_seen = timezone.now()
        unit.save(update_fields=["is_online", "last_seen"])

        _broadcast_realtime({
            "type": "user_action",
            "action": "unit_disconnected",
            **_actor_fields(request.user),
            "unit_id": unit.id,
            "unit_name": unit.name,
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
        unit.field_command = field_command
        unit.save(update_fields=["field_command"])
        actor = request.user
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
        incident_id = request.data.get("incident_id")
        if not incident_id:
            return Response({"detail": "incident_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            incident = Incident.objects.get(pk=incident_id)
        except (Incident.DoesNotExist, ValueError, TypeError):
            return Response({"detail": "Incident not found."}, status=status.HTTP_404_NOT_FOUND)
        incident.field_command = field_command
        incident.save(update_fields=["field_command"])
        actor = request.user
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

    qs = IncidentEvent.objects.filter(
        incident__isnull=False).order_by("-created_at")
    if incident_id_param:
        qs = qs.filter(incident_id=incident_id_param)

    events = [
        {
            "id": e.id,
            "timestamp": e.created_at.isoformat(),
            "entity_type": "incident",
            "entity_id": e.incident_id,
            "message": e.title,
            "level": _SEVERITY_TO_LEVEL.get(e.severity, "info"),
        }
        for e in qs[:limit]
    ]
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
    has_location = False
    if location_lat is not None and location_lng is not None:
        try:
            location_lat = float(location_lat)
            location_lng = float(location_lng)
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

        # Keep connection alive and send events
        try:
            last_heartbeat = time.time()
            while True:
                # Send queued events
                while events_queue:
                    event = events_queue.pop(0)
                    yield f"data: {json.dumps(event)}\n\n"

                # Send heartbeat every 10 seconds
                if time.time() - last_heartbeat > 10:
                    yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
                    last_heartbeat = time.time()

                time.sleep(0.1)
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


@api_view(["GET"])
def field_incident_sectors(request):
    """Get all sectors for current major incident."""
    field_id = request.query_params.get("fieldId")
    data = _get_field_incident_data(field_id)

    if data is None:
        return Response({"detail": "No major incident active"}, status=status.HTTP_404_NOT_FOUND)

    return Response({
        "sectors": data.get("sectors", []),
        "major_incident": data.get("major_incident", {})
    })


@api_view(["GET"])
def field_incident_task_groups(request):
    """Get all task groups for current major incident."""
    field_id = request.query_params.get("fieldId")
    data = _get_field_incident_data(field_id)

    if data is None:
        return Response({"detail": "No major incident active"}, status=status.HTTP_404_NOT_FOUND)

    return Response({
        "task_groups": data.get("task_groups", []),
    })


@api_view(["GET"])
def field_incident_events(request):
    """Get operational timeline events."""
    field_id = request.query_params.get("fieldId")
    data = _get_field_incident_data(field_id)

    if data is None:
        return Response({"detail": "No major incident active"}, status=status.HTTP_404_NOT_FOUND)

    return Response({
        "events": data.get("events", []),
    })


@api_view(["PATCH"])
def field_incident_sector_update(request, sector_id):
    """Update sector hazard level and status."""
    field_id = request.query_params.get("fieldId")
    data = _get_field_incident_data(field_id)

    if data is None:
        return Response({"detail": "No major incident active"}, status=status.HTTP_404_NOT_FOUND)

    sectors = data.get("sectors", [])
    if sector_id >= len(sectors):
        return Response({"detail": "Sector not found"}, status=status.HTTP_404_NOT_FOUND)

    sector = sectors[sector_id]

    # Update fields if provided
    if "hazard_level" in request.data:
        sector["hazard_level"] = request.data["hazard_level"]
    if "status" in request.data:
        sector["status"] = request.data["status"]
    if "estimated_survivors" in request.data:
        sector["estimated_survivors"] = request.data["estimated_survivors"]

    _push_field_sse({"type": "incident_update", "data": {"sector_update": {"index": sector_id, "sector": sector}}})

    return Response(sector)


@api_view(["PATCH"])
def field_incident_task_group_update(request, task_group_id):
    """Update task group progress and status."""
    field_id = request.query_params.get("fieldId")
    data = _get_field_incident_data(field_id)

    if data is None:
        return Response({"detail": "No major incident active"}, status=status.HTTP_404_NOT_FOUND)

    task_groups = data.get("task_groups", [])
    if task_group_id >= len(task_groups):
        return Response({"detail": "Task group not found"}, status=status.HTTP_404_NOT_FOUND)

    task_group = task_groups[task_group_id]

    # Update fields if provided
    if "progress_percent" in request.data:
        task_group["progress_percent"] = request.data["progress_percent"]
    if "status" in request.data:
        task_group["status"] = request.data["status"]
    if "completed_subtasks" in request.data:
        task_group["completed_subtasks"] = request.data["completed_subtasks"]
    if "notes" in request.data:
        task_group["notes"] = request.data["notes"]

    _push_field_sse({"type": "incident_update", "data": {"task_group_update": {"index": task_group_id, "task_group": task_group}}})

    return Response(task_group)


@api_view(["PATCH"])
def field_incident_casualty_update(request):
    """Update casualty estimates for major incident."""
    field_id = request.query_params.get("fieldId")
    data = _get_field_incident_data(field_id)

    if data is None:
        return Response({"detail": "No major incident active"}, status=status.HTTP_404_NOT_FOUND)

    major_incident = data.get("major_incident", {})

    if "estimated_casualties" in request.data:
        major_incident["estimated_casualties"] = request.data["estimated_casualties"]
    if "confirmed_deaths" in request.data:
        major_incident["confirmed_deaths"] = request.data["confirmed_deaths"]
    if "displaced_persons" in request.data:
        major_incident["displaced_persons"] = request.data["displaced_persons"]

    _push_field_sse({"type": "incident_update", "data": {"casualty_update": major_incident}})

    return Response(major_incident)


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def field_incident_add_event(request):
    """Add event to operational timeline with optional image/video attachments.

    Accepts multipart/form-data (for file uploads) or application/json (text-only).
    Files must be sent under the field name 'files' (multiple allowed).
    """
    field_id = request.query_params.get("fieldId")
    data = _get_field_incident_data(field_id)

    if data is None:
        return Response({"detail": "No major incident active"}, status=status.HTTP_404_NOT_FOUND)

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

    # Persist the event to the database. created_by/actor_id follow
    # _log_status_change's pattern (views.py) — the resolved real actor, not
    # a client-supplied "created_by" string from the request body.
    actor = request.user
    event_obj = IncidentEvent.objects.create(
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

                # Heartbeat every 10 seconds
                if time.time() - last_heartbeat > 10:
                    yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
                    last_heartbeat = time.time()

                time.sleep(1)
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
    return Response(TaskGroupSerializer(task_group).data, status=status.HTTP_201_CREATED)