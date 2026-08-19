"""
Object-level authorization tests for TaskPermission and ReadOnlyOrAdminDispatcher.

These go through the real DRF view + permission stack (APIClient hitting actual
URLs) rather than instantiating the permission classes directly, so a regression
anywhere in the request path (viewset, serializer, permission class) is caught.
"""
from rest_framework.test import APITestCase
from rest_framework import status

from api.models import User, Incident, Unit, Task


def _make_user(username, role, unit=None):
    return User.objects.create_user(
        username=username, password="pass1234", role=role, unit=unit,
    )


class TaskPermissionAuthenticationTests(APITestCase):
    """Every /api/tasks/ endpoint must require authentication, including reads."""

    def setUp(self):
        incident = Incident.objects.create(
            title="Fire", location_lat=1.0, location_lng=1.0)
        self.task = Task.objects.create(incident=incident, title="Respond")

    def test_anonymous_list_is_rejected(self):
        response = self.client.get("/api/tasks/")
        self.assertIn(response.status_code,
                       (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))

    def test_anonymous_patch_is_rejected(self):
        response = self.client.patch(
            f"/api/tasks/{self.task.id}/", {"status": "DONE"}, format="json")
        self.assertIn(response.status_code,
                       (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))


class TaskPermissionRoleTests(APITestCase):
    def setUp(self):
        self.unit_a = Unit.objects.create(
            name="Unit A", type="Police", location_lat=1.0, location_lng=1.0)
        self.unit_b = Unit.objects.create(
            name="Unit B", type="Fire", location_lat=1.0, location_lng=1.0)
        self.incident = Incident.objects.create(
            title="Fire", location_lat=1.0, location_lng=1.0)
        self.task_for_a = Task.objects.create(
            incident=self.incident, assigned_unit=self.unit_a, title="Respond A")
        self.task_for_b = Task.objects.create(
            incident=self.incident, assigned_unit=self.unit_b, title="Respond B")

        self.field_user_a = _make_user("field_a", User.Roles.FIELD, unit=self.unit_a)
        self.dispatcher = _make_user("dispatcher1", User.Roles.DISPATCHER)

    def test_fieldunit_can_update_status_of_task(self):
        self.client.force_authenticate(self.field_user_a)
        response = self.client.patch(
            f"/api/tasks/{self.task_for_a.id}/", {"status": "IN_PROGRESS"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.task_for_a.refresh_from_db()
        self.assertEqual(self.task_for_a.status, "IN_PROGRESS")

    def test_fieldunit_status_patch_ignores_other_fields(self):
        self.client.force_authenticate(self.field_user_a)
        response = self.client.patch(
            f"/api/tasks/{self.task_for_a.id}/",
            {"status": "DONE", "title": "Hijacked title"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.task_for_a.refresh_from_db()
        self.assertEqual(self.task_for_a.title, "Respond A")

    def test_fieldunit_patch_without_status_is_rejected(self):
        self.client.force_authenticate(self.field_user_a)
        response = self.client.patch(
            f"/api/tasks/{self.task_for_a.id}/", {"title": "New title"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_fieldunit_cannot_create_tasks(self):
        self.client.force_authenticate(self.field_user_a)
        response = self.client.post(
            "/api/tasks/", {"incident": self.incident.id, "title": "New task"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_dispatcher_can_create_tasks(self):
        self.client.force_authenticate(self.dispatcher)
        response = self.client.post(
            "/api/tasks/", {"incident": self.incident.id, "title": "New task"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_KNOWN_GAP_fieldunit_can_patch_status_of_a_task_not_assigned_to_them(self):
        """
        SECURITY GAP (documented, not fixed under Phase 1 scope):
        TaskPermission.has_object_permission only checks request.user.role for
        PATCH; it never compares obj.assigned_unit to request.user.unit. A field
        unit can therefore change the status of ANY task, not just their own
        assignment. This pins the CURRENT behavior so accidental tightening is
        visible in a future diff; replace with assertEqual(403) once ownership
        is enforced.
        """
        self.client.force_authenticate(self.field_user_a)
        response = self.client.patch(
            f"/api/tasks/{self.task_for_b.id}/", {"status": "DONE"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class ReadOnlyOrAdminDispatcherGapTests(APITestCase):
    """
    SECURITY GAP (documented, not fixed under Phase 1 scope):
    ReadOnlyOrAdminDispatcher.has_permission always returns True ("auth
    temporarily bypassed for MVP" per its own source comment), so
    IncidentViewSet/UnitViewSet accept writes from fully unauthenticated
    clients. These tests pin the current behavior as a visible risk marker.
    """

    def test_anonymous_can_currently_create_incident(self):
        response = self.client.post("/api/incidents/", {
            "title": "Unauthenticated incident",
            "location_lat": 1.0,
            "location_lng": 1.0,
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_anonymous_can_currently_delete_unit(self):
        unit = Unit.objects.create(
            name="Temp", type="Police", location_lat=1.0, location_lng=1.0)
        response = self.client.delete(f"/api/units/{unit.id}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
