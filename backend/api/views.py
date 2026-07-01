from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.decorators import action, api_view, parser_classes, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django.http import JsonResponse, StreamingHttpResponse
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

from .models import Incident, Task, Unit, IncidentEvent, ReportMedia, PushToken
from .serializers import IncidentSerializer, TaskSerializer, UnitSerializer, IncidentEventSerializer
from .permissions import ReadOnlyOrAdminDispatcher, TaskPermission
from simulated.mock_data import get_mock_service
from simulated.realtime import get_realtime_service
from simulated.field_incident_data import get_field_incident_service
import time as _time


class IncidentViewSet(viewsets.ModelViewSet):
    queryset = Incident.objects.all().order_by("-created_at")
    serializer_class = IncidentSerializer
    permission_classes = [ReadOnlyOrAdminDispatcher]


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

    def partial_update(self, request, *args, **kwargs):
        user_role = getattr(request.user, "role", "")
        user_id = getattr(request.user, "id", None)
        username = getattr(request.user, "username", "unknown")

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

            get_realtime_service().broadcast({
                "type": "user_action",
                "action": "task_status_update",
                "user_id": user_id,
                "username": username,
                "role": user_role,
                "task_id": instance.id,
                "task_title": instance.title,
                "new_status": status_value,
                "timestamp": _time.time(),
            })

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


# Mock Data API Endpoints (for dashboard demo)
@api_view(["GET"])
def mock_incidents(request):
    """Get mock incidents for dashboard."""
    field_id = request.query_params.get("fieldId")
    mock_service = get_mock_service()
    return Response(mock_service.get_incidents(field_id=field_id))


@api_view(["GET"])
def mock_units(request):
    """Get mock units for dashboard."""
    field_id = request.query_params.get("fieldId")
    mock_service = get_mock_service()
    return Response(mock_service.get_units(field_id=field_id))


@api_view(["GET"])
def mock_events(request):
    """Get mock event log for dashboard. Supports ?incident_id=<id> filtering."""
    limit = request.query_params.get("limit", 50)
    incident_id_param = request.query_params.get("incident_id", None)
    try:
        limit = int(limit)
    except ValueError:
        limit = 50
    mock_service = get_mock_service()
    events = mock_service.get_events(limit=limit)
    if incident_id_param:
        try:
            incident_id_int = int(incident_id_param)
            events = [
                e for e in events
                if e.get("entity_type") == "incident"
                and e.get("entity_id") == incident_id_int
            ]
        except (ValueError, TypeError):
            pass
    return Response(events)


@api_view(["GET"])
def mock_incident_detail(request, incident_id):
    """Get specific mock incident."""
    mock_service = get_mock_service()
    incident = mock_service.get_incident(int(incident_id))
    if not incident:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response(incident)


@api_view(["PATCH"])
def mock_incident_status(request, incident_id):
    """Update mock incident status."""
    new_status = request.data.get("status")
    if not new_status:
        return Response({"detail": "status is required."}, status=status.HTTP_400_BAD_REQUEST)

    mock_service = get_mock_service()
    incident = mock_service.update_incident_status(
        int(incident_id), new_status)
    if not incident:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response(incident)


@api_view(["PATCH"])
def mock_incident_priority(request, incident_id):
    """Update mock incident priority."""
    new_priority = request.data.get("priority")
    if not new_priority:
        return Response({"detail": "priority is required."}, status=status.HTTP_400_BAD_REQUEST)

    mock_service = get_mock_service()
    incident = mock_service.update_incident_priority(
        int(incident_id), new_priority)
    if not incident:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response(incident)


@api_view(["POST"])
def mock_incident_assign(request, incident_id):
    """Assign unit to incident and mirror to real DB for the mobile app."""
    unit_id = request.data.get("unit_id")
    if not unit_id:
        return Response({"detail": "unit_id is required."}, status=status.HTTP_400_BAD_REQUEST)

    mock_service = get_mock_service()
    incident = mock_service.assign_unit(int(incident_id), int(unit_id))
    if not incident:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    mock_unit = mock_service.units.get(int(unit_id))
    _sync_dispatch_to_db(incident, mock_unit)

    return Response(incident)


# Maps mock unit types → canonical DB unit types
_MOCK_TYPE_TO_DB_TYPE = {
    "Police":    "Police",
    "Fire":      "Fire",
    "Ambulance": "EMS",
}


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


def _sync_dispatch_to_db(mock_incident: dict, mock_unit: dict) -> None:
    """Mirror a dashboard dispatch as a Task in the real DB and notify the field device."""
    if not mock_unit:
        return
    db_unit_type = _MOCK_TYPE_TO_DB_TYPE.get(mock_unit.get("type"))
    if not db_unit_type:
        return

    try:
        db_unit = Unit.objects.filter(type=db_unit_type, app_user__isnull=False).first()
        if not db_unit:
            return

        db_incident, _ = Incident.objects.update_or_create(
            mock_incident_id=mock_incident["id"],
            defaults={
                "title":        mock_incident.get("title", "Incident"),
                "description":  mock_incident.get("description", ""),
                "location_lat": mock_incident["location_lat"],
                "location_lng": mock_incident["location_lng"],
                "priority":     mock_incident.get("priority", "LOW"),
                "status":       "IN_PROGRESS",
            },
        )

        _, created = Task.objects.get_or_create(
            incident=db_incident,
            mock_unit_id=mock_unit["id"],
            defaults={
                "assigned_unit": db_unit,
                "title":         f"Respond: {mock_incident.get('title', 'Incident')}",
                "status":        "PENDING",
            },
        )

        if created:
            tokens = list(
                PushToken.objects.filter(mock_unit_id=mock_unit["id"])
                .values_list("token", flat=True)
            )
            _send_expo_push(
                tokens,
                title="New Dispatch",
                body=f"{mock_incident.get('title', 'Incident')} — respond immediately",
                data={"mock_incident_id": mock_incident["id"]},
            )

    except Exception:
        pass  # never crash the dispatch response over a sync failure


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
    """Update the linked `Unit` last-seen timestamp and mark it online."""
    user = request.user
    unit = getattr(user, "unit", None)
    if not unit:
        return Response({"detail": "No unit linked to user."}, status=status.HTTP_400_BAD_REQUEST)

    unit.last_seen = timezone.now()
    unit.is_online = True
    # Keep existing availability field in sync
    unit.availability_status = "AVAILABLE"
    unit.save(update_fields=["last_seen", "is_online", "availability_status"])
    return Response({"ok": True})


@api_view(["POST"])
def mock_incident_note(request, incident_id):
    """Add note to incident."""
    note = request.data.get("note")
    if not note:
        return Response({"detail": "note is required."}, status=status.HTTP_400_BAD_REQUEST)

    mock_service = get_mock_service()
    incident = mock_service.add_incident_note(int(incident_id), note)
    if not incident:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response(incident)


@api_view(["GET"])
def mock_simulate_update(request):
    """Simulate a random update (for demo)."""
    mock_service = get_mock_service()
    update = mock_service.simulate_update()
    return Response(update or {})


@api_view(["GET"])
def mock_fields(request):
    """Get all field command metadata."""
    mock_service = get_mock_service()
    return Response(mock_service.get_fields())


@api_view(["GET"])
def mock_field_detail(request, field_id):
    """Get field command metadata including assigned incidents and units."""
    mock_service = get_mock_service()
    summary = mock_service.get_field_summary(field_id)
    if not summary:
        # Field was created in a previous server session (persisted in the browser).
        # Reconstruct it in memory using any available field-incident location data.
        field_incident = _get_field_incident_data(field_id)
        lat = lng = None
        if field_incident:
            mi = field_incident.get("major_incident", {})
            lat = mi.get("location_lat")
            lng = mi.get("location_lng")
        mock_service.create_field_command({
            "id": field_id,
            "name": f"Field Command {field_id}",
            "location_lat": lat,
            "location_lng": lng,
        })
        summary = mock_service.get_field_summary(field_id)
    return Response(summary)


@api_view(["PATCH", "POST"])
def mock_field_assign_unit(request, field_id):
    """Assign a unit to a field command."""
    unit_id = request.data.get("unit_id")
    if not unit_id:
        return Response({"detail": "unit_id is required."}, status=status.HTTP_400_BAD_REQUEST)

    mock_service = get_mock_service()
    unit = mock_service.assign_unit_to_field(int(unit_id), field_id)
    if not unit:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response(unit)


@api_view(["POST"])
def field_create(request):
    """Create a new field command from war-room map."""
    payload = request.data or {}
    location_lat = payload.get("location_lat")
    location_lng = payload.get("location_lng")
    if location_lat is None or location_lng is None:
        return Response({"detail": "location_lat and location_lng are required."}, status=status.HTTP_400_BAD_REQUEST)

    mock_service = get_mock_service()
    created = mock_service.create_field_command(payload)
    return Response(created, status=status.HTTP_201_CREATED)


@api_view(["PATCH"])
def field_update_metrics(request):
    """Update field command operational metrics from field side."""
    payload = request.data or {}
    field_id = payload.get("field_id") or request.query_params.get("fieldId")
    if not field_id:
        return Response({"detail": "field_id is required."}, status=status.HTTP_400_BAD_REQUEST)

    mock_service = get_mock_service()
    updated = mock_service.update_field_metrics(field_id, payload)
    if not updated:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response(updated)


@api_view(["POST"])
def field_close(request):
    """Close an active field command and release assigned resources."""
    payload = request.data or {}
    field_id = payload.get("field_id") or request.query_params.get("fieldId")
    if not field_id:
        return Response({"detail": "field_id is required."}, status=status.HTTP_400_BAD_REQUEST)

    mock_service = get_mock_service()
    result = mock_service.close_field_command(field_id)
    if not result:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    return Response({"status": "closed", "field_id": field_id})


# Server-Sent Events endpoint for real-time updates
def mock_updates_stream(request):
    """Stream real-time updates using Server-Sent Events."""
    mock_service = get_mock_service()
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

    # Persist the event to the database
    event_obj = IncidentEvent.objects.create(
        event_type=request.data.get("event_type", "UPDATE"),
        severity=request.data.get("severity", "INFO"),
        title=request.data.get("title", "Event"),
        description=request.data.get("description", ""),
        created_by=request.data.get("created_by", "User"),
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

                # Simulate update every 2-4 seconds
                if random.random() < 0.3:
                    field_service = get_field_incident_service()
                    data = _get_field_incident_data(None) or {}
                    update = field_service.simulate_update(data)
                    if update.get("status") != "no_change":
                        yield f"data: {json.dumps({'type': 'incident_update', 'data': update})}\n\n"

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


@api_view(["POST"])
def mobile_register_units(request):
    """Dashboard calls this on init to register its routine unit list for the mobile app."""
    for unit in request.data.get("units", []):
        raw_id = unit.get("id", "")
        try:
            num = int(str(raw_id).replace("routine-", ""))
        except (ValueError, TypeError):
            continue
        _routine_units_registry[num] = {
            "id":     num,
            "name":   unit.get("name", f"Unit {num}"),
            "type":   unit.get("type", "POLICE"),
            "status": "Available",
        }
    return Response({"status": "ok", "count": len(_routine_units_registry)})


@api_view(["GET"])
def mobile_units(request):
    """Returns registered routine units for mobile app unit selection, filtered by type."""
    unit_type = request.query_params.get("type", "").upper()
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

        db_unit_type = _ROUTINE_TYPE_TO_DB.get(str(unit_type_str).upper())
        db_unit = (Unit.objects.filter(type=db_unit_type, app_user__isnull=False).first()
                   if db_unit_type else None)

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

    tokens = list(PushToken.objects.filter(mock_unit_id=mock_unit_id).values_list("token", flat=True))
    _send_expo_push(
        tokens,
        title="Dispatch Cancelled",
        body="Your dispatch has been cancelled. Return to patrol.",
        data={"cancelled": True, "mock_unit_id": mock_unit_id},
    )

    return Response({"status": "cancelled", "tasks_cancelled": cancelled_count})


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