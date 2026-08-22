from rest_framework.routers import DefaultRouter
from django.urls import path, include

from .views import (
    IncidentViewSet, TaskViewSet, UnitViewSet, FieldCommandViewSet,
    incident_events, updates_stream,
     unit_heartbeat,
    field_incident_detail, field_incident_sectors, field_incident_task_groups,
    field_incident_events, field_incident_sector_update, field_incident_task_group_update,
    field_incident_casualty_update, field_incident_add_event, field_incident_simulate,
    field_incident_updates_stream,
    register_push_token,
    mobile_register_units, mobile_units, mobile_dispatch, mobile_cancel_dispatch,
    mobile_unit_status,
    major_incident_go_live, major_incident_perimeter, major_incident_sectors,
    major_incident_task_groups,
)

router = DefaultRouter()
router.register(r"incidents", IncidentViewSet)
router.register(r"tasks", TaskViewSet)
router.register(r"units", UnitViewSet)
router.register(r"field-commands", FieldCommandViewSet)

urlpatterns = [
    # Must precede the router include: DefaultRouter's detail route
    # (units/<pk>/) uses the regex [^/.]+ for pk, which also matches the
    # literal string "heartbeat" — if the router is included first it wins
    # the match and this view becomes unreachable (405 on every request).
    # See final changes/05_user_unit_claiming_and_live_sync.md.
    path("units/heartbeat/", unit_heartbeat, name="unit_heartbeat"),
    path("events/", incident_events, name="incident_events"),
    path("updates/stream/", updates_stream, name="updates_stream"),
    path("", include(router.urls)),
    path("push-token/", register_push_token, name="register_push_token"),
    path("mobile/register-units/", mobile_register_units, name="mobile_register_units"),
    path("mobile/units/", mobile_units, name="mobile_units"),
    path("mobile/dispatch/", mobile_dispatch, name="mobile_dispatch"),
    path("mobile/cancel-dispatch/", mobile_cancel_dispatch, name="mobile_cancel_dispatch"),
    path("mobile/unit-status/", mobile_unit_status, name="mobile_unit_status"),

    # Field Incident Command Dashboard endpoints
    path("field/incident/", field_incident_detail, name="field_incident_detail"),
    path("field/sectors/", field_incident_sectors,
         name="field_incident_sectors"),
    path("field/task-groups/", field_incident_task_groups,
         name="field_incident_task_groups"),
    path("field/events/", field_incident_events, name="field_incident_events"),
    path("field/sectors/<int:sector_id>/", field_incident_sector_update,
         name="field_incident_sector_update"),
    path("field/task-groups/<int:task_group_id>/",
         field_incident_task_group_update, name="field_incident_task_group_update"),
    path("field/casualty-update/", field_incident_casualty_update,
         name="field_incident_casualty_update"),
    path("field/add-event/", field_incident_add_event,
         name="field_incident_add_event"),
    path("field/simulate/", field_incident_simulate,
         name="field_incident_simulate"),
    path("field/updates/stream/", field_incident_updates_stream,
         name="field_incident_updates_stream"),

    # Real Major Incident / Sector / TaskGroup / Perimeter endpoints (the
    # "go live" flow). Deliberately under a different prefix than field/...
    # above, which stays the mock/training-simulation backend.
    path("major-incidents/go-live/", major_incident_go_live,
         name="major_incident_go_live"),
    path("major-incidents/<int:major_incident_id>/perimeter/",
         major_incident_perimeter, name="major_incident_perimeter"),
    path("major-incidents/<int:major_incident_id>/sectors/",
         major_incident_sectors, name="major_incident_sectors"),
    path("major-incidents/<int:major_incident_id>/task-groups/",
         major_incident_task_groups, name="major_incident_task_groups"),
]
