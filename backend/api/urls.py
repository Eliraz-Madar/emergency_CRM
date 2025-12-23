from rest_framework.routers import DefaultRouter
from django.urls import path, include

from .views import (
    IncidentViewSet, TaskViewSet, UnitViewSet,
    mock_incidents, mock_units, mock_events, mock_incident_detail,
    mock_incident_status, mock_incident_severity, mock_incident_assign,
    mock_incident_note, mock_simulate_update, mock_updates_stream,
    field_incident_detail, field_incident_sectors, field_incident_task_groups,
    field_incident_events, field_incident_sector_update, field_incident_task_group_update,
    field_incident_casualty_update, field_incident_add_event, field_incident_simulate,
    field_incident_updates_stream
)

router = DefaultRouter()
router.register(r"incidents", IncidentViewSet)
router.register(r"tasks", TaskViewSet)
router.register(r"units", UnitViewSet)

urlpatterns = [
    path("", include(router.urls)),
    # Mock data API endpoints for regional dashboard demo
    path("mock/incidents/", mock_incidents, name="mock_incidents"),
    path("mock/units/", mock_units, name="mock_units"),
    path("mock/events/", mock_events, name="mock_events"),
    path("mock/incidents/<int:incident_id>/", mock_incident_detail, name="mock_incident_detail"),
    path("mock/incidents/<int:incident_id>/status/", mock_incident_status, name="mock_incident_status"),
    path("mock/incidents/<int:incident_id>/severity/", mock_incident_severity, name="mock_incident_severity"),
    path("mock/incidents/<int:incident_id>/assign/", mock_incident_assign, name="mock_incident_assign"),
    path("mock/incidents/<int:incident_id>/note/", mock_incident_note, name="mock_incident_note"),
    path("mock/simulate/", mock_simulate_update, name="mock_simulate_update"),
    path("mock/updates/stream/", mock_updates_stream, name="mock_updates_stream"),
    
    # Field Incident Command Dashboard endpoints
    path("field/incident/", field_incident_detail, name="field_incident_detail"),
    path("field/sectors/", field_incident_sectors, name="field_incident_sectors"),
    path("field/task-groups/", field_incident_task_groups, name="field_incident_task_groups"),
    path("field/events/", field_incident_events, name="field_incident_events"),
    path("field/sectors/<int:sector_id>/", field_incident_sector_update, name="field_incident_sector_update"),
    path("field/task-groups/<int:task_group_id>/", field_incident_task_group_update, name="field_incident_task_group_update"),
    path("field/casualty-update/", field_incident_casualty_update, name="field_incident_casualty_update"),
    path("field/add-event/", field_incident_add_event, name="field_incident_add_event"),
    path("field/simulate/", field_incident_simulate, name="field_incident_simulate"),
    path("field/updates/stream/", field_incident_updates_stream, name="field_incident_updates_stream"),
]
