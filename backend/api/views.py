from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.decorators import action, api_view
from django.http import JsonResponse, StreamingHttpResponse
import json
import time
import random
import os

from .models import Incident, Task, Unit
from .serializers import IncidentSerializer, TaskSerializer, UnitSerializer
from .permissions import ReadOnlyOrAdminDispatcher, TaskPermission
from simulated.mock_data import get_mock_service
from simulated.realtime import get_realtime_service
from simulated.field_incident_data import get_field_incident_service


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
        incident_id = self.request.query_params.get("incident")
        qs = super().get_queryset()
        if incident_id:
            qs = qs.filter(incident_id=incident_id)
        return qs

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
    """Get mock event log for dashboard."""
    limit = request.query_params.get("limit", 50)
    try:
        limit = int(limit)
    except ValueError:
        limit = 50
    mock_service = get_mock_service()
    return Response(mock_service.get_events(limit=limit))


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
    """Assign unit to incident."""
    unit_id = request.data.get("unit_id")
    if not unit_id:
        return Response({"detail": "unit_id is required."}, status=status.HTTP_400_BAD_REQUEST)

    mock_service = get_mock_service()
    incident = mock_service.assign_unit(int(incident_id), int(unit_id))
    if not incident:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response(incident)


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
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
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
    return _field_incident_data.get(key)


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
def field_incident_add_event(request):
    """Add event to operational timeline."""
    field_id = request.query_params.get("fieldId")
    data = _get_field_incident_data(field_id)

    if data is None:
        return Response({"detail": "No major incident active"}, status=status.HTTP_404_NOT_FOUND)

    events = data.get("events", [])

    event = {
        "event_type": request.data.get("event_type", "UPDATE"),
        "severity": request.data.get("severity", "INFO"),
        "title": request.data.get("title", "Event"),
        "description": request.data.get("description", ""),
        "created_by": request.data.get("created_by", "User"),
        "created_at": time.time(),
    }

    events.insert(0, event)  # Add to beginning of list
    return Response(event)


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
        yield f"data: {json.dumps({'type': 'connected', 'timestamp': time.time()})}\n\n"

        try:
            last_heartbeat = time.time()
            while True:
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

    response = StreamingHttpResponse(
        event_generator(),
        content_type="text/event-stream"
    )
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response
