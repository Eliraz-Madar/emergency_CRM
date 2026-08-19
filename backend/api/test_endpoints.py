"""
Endpoint-level tests: request/response JSON shape for the core
Incident/Task/Unit REST resources, and the mobile-bridge endpoints that mirror
dashboard/mobile dispatches into the database as Tasks.
"""
from rest_framework.test import APITestCase
from rest_framework import status

from api.models import User, Incident, Unit, Task


def _make_dispatcher():
    return User.objects.create_user(
        username="dispatcher_e2e", password="pass1234", role=User.Roles.DISPATCHER)


class IncidentEndpointSchemaTests(APITestCase):
    def setUp(self):
        self.dispatcher = _make_dispatcher()
        self.incident = Incident.objects.create(
            title="Structure fire", description="2-story residential",
            location_lat=32.08, location_lng=34.78, priority="HIGH",
        )

    def test_list_returns_expected_incident_shape(self):
        self.client.force_authenticate(self.dispatcher)
        response = self.client.get("/api/incidents/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        results = body["results"] if isinstance(body, dict) and "results" in body else body
        incident_json = next(r for r in results if r["id"] == self.incident.id)
        for field in ("id", "title", "description", "location_lat", "location_lng",
                      "priority", "status", "created_at", "tasks"):
            self.assertIn(field, incident_json)

    def test_create_incident_requires_location(self):
        self.client.force_authenticate(self.dispatcher)
        response = self.client.post(
            "/api/incidents/", {"title": "Missing coords"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("location_lat", response.json())
        self.assertIn("location_lng", response.json())


class TaskEndpointSchemaAndFilterTests(APITestCase):
    def setUp(self):
        self.dispatcher = _make_dispatcher()
        self.unit = Unit.objects.create(
            name="Engine 1", type="Fire", location_lat=1.0, location_lng=1.0)
        self.incident = Incident.objects.create(
            title="Fire", location_lat=1.0, location_lng=1.0)
        self.other_incident = Incident.objects.create(
            title="Other", location_lat=2.0, location_lng=2.0)
        self.task = Task.objects.create(
            incident=self.incident, assigned_unit=self.unit, mock_unit_id=7, title="Respond")
        Task.objects.create(incident=self.other_incident, title="Unrelated")

    def test_task_json_includes_denormalized_incident_fields(self):
        self.client.force_authenticate(self.dispatcher)
        response = self.client.get(f"/api/tasks/{self.task.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(body["incident_title"], "Fire")
        self.assertEqual(body["incident_lat"], 1.0)
        self.assertEqual(body["incident_priority"], "LOW")

    def test_task_list_filters_by_incident_query_param(self):
        self.client.force_authenticate(self.dispatcher)
        response = self.client.get(f"/api/tasks/?incident={self.incident.id}")
        body = response.json()
        results = body["results"] if isinstance(body, dict) and "results" in body else body
        self.assertEqual([r["id"] for r in results], [self.task.id])

    def test_task_list_filters_by_mock_unit_query_param(self):
        self.client.force_authenticate(self.dispatcher)
        response = self.client.get("/api/tasks/?mock_unit=7")
        body = response.json()
        results = body["results"] if isinstance(body, dict) and "results" in body else body
        self.assertEqual([r["id"] for r in results], [self.task.id])

    def test_task_list_with_invalid_mock_unit_returns_empty(self):
        self.client.force_authenticate(self.dispatcher)
        response = self.client.get("/api/tasks/?mock_unit=not-a-number")
        body = response.json()
        results = body["results"] if isinstance(body, dict) and "results" in body else body
        self.assertEqual(results, [])

    def test_by_incident_custom_action(self):
        self.client.force_authenticate(self.dispatcher)
        response = self.client.get(f"/api/tasks/by-incident/{self.incident.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual([r["id"] for r in body], [self.task.id])


class MobileDispatchBridgeTests(APITestCase):
    """
    Covers the field-report -> dispatch mirror path used by the mobile app
    bridge, i.e. the "Unit dispatch" leg of the report -> incident -> dispatch
    -> closure emergency scenario.
    """

    def test_dispatch_creates_incident_and_task_and_is_idempotent(self):
        payload = {
            "incident_id": "live-42",
            "incident_title": "Apartment fire",
            "location_lat": 32.1,
            "location_lng": 34.8,
            "priority": "CRITICAL",
            "units": [{"mock_unit_num": 101, "name": "Engine 5", "type": "Fire"}],
        }
        response = self.client.post("/api/mobile/dispatch/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["tasks_created"], 1)

        incident = Incident.objects.get(mock_incident_id=42)
        self.assertEqual(incident.title, "Apartment fire")
        self.assertEqual(incident.status, "IN_PROGRESS")
        task = Task.objects.get(incident=incident, mock_unit_id=101)
        self.assertEqual(task.status, "PENDING")
        self.assertEqual(task.assigned_unit.type, "Fire")

        # Re-dispatching the same unit to the same incident must not duplicate the task.
        response2 = self.client.post("/api/mobile/dispatch/", payload, format="json")
        self.assertEqual(response2.json()["tasks_created"], 0)
        self.assertEqual(
            Task.objects.filter(incident=incident, mock_unit_id=101).count(), 1)

    def test_dispatch_requires_location(self):
        response = self.client.post(
            "/api/mobile/dispatch/", {"incident_id": "live-1"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cancel_dispatch_marks_task_cancelled(self):
        unit = Unit.objects.create(
            name="Engine 5", type="Fire", location_lat=1.0, location_lng=1.0)
        incident = Incident.objects.create(
            title="Fire", location_lat=1.0, location_lng=1.0, mock_incident_id=99)
        Task.objects.create(incident=incident, assigned_unit=unit,
                             mock_unit_id=101, title="Respond", status="PENDING")

        response = self.client.post("/api/mobile/cancel-dispatch/", {
            "mock_unit_id": 101, "incident_id": "live-99",
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["tasks_cancelled"], 1)
        task = Task.objects.get(incident=incident, mock_unit_id=101)
        self.assertEqual(task.status, "CANCELLED")

    def test_mobile_units_filters_by_normalized_type(self):
        register_response = self.client.post("/api/mobile/register-units/", {
            "units": [
                {"id": "routine-9001", "name": "Ambulance 1", "type": "Ambulance"},
                {"id": "routine-9002", "name": "Patrol 2", "type": "Police"},
            ]
        }, format="json")
        self.assertEqual(register_response.status_code, status.HTTP_200_OK)

        response = self.client.get("/api/mobile/units/?type=MEDICAL")
        ids = [u["id"] for u in response.json()]
        self.assertIn(9001, ids)
        self.assertNotIn(9002, ids)


class MobileUnitStatusEndpointTests(APITestCase):
    def test_missing_fields_returns_400(self):
        response = self.client.post("/api/mobile/unit-status/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_status_value_returns_400(self):
        response = self.client.post("/api/mobile/unit-status/", {
            "mock_unit_id": 9005, "status": "NotARealStatus",
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_valid_status_update_is_accepted(self):
        self.client.post("/api/mobile/register-units/", {
            "units": [{"id": "routine-9005", "name": "Unit 9005", "type": "Police"}]
        }, format="json")
        response = self.client.post("/api/mobile/unit-status/", {
            "mock_unit_id": 9005, "status": "OnScene",
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class UnitClaimingTests(APITestCase):
    """
    The user-unit claiming flow: a unit must never appear online/available
    until a real authenticated user claims it with a live GPS fix, and must
    stop appearing online once that user disconnects.
    """

    def setUp(self):
        self.field_user = User.objects.create_user(
            username="field_claim", password="pass1234", role=User.Roles.FIELD)
        self.other_field_user = User.objects.create_user(
            username="field_other", password="pass1234", role=User.Roles.FIELD)

    def test_fresh_unit_defaults_to_offline(self):
        unit = Unit.objects.create(name="Engine 1", type="Fire", location_lat=1.0, location_lng=1.0)
        self.assertFalse(unit.is_online)

    def test_claimable_filter_excludes_units_already_claimed_and_online(self):
        claimed_online = Unit.objects.create(
            name="Engine 2", type="Fire", location_lat=1.0, location_lng=1.0, is_online=True)
        User.objects.create_user(
            username="owner", password="x", role=User.Roles.FIELD, unit=claimed_online)
        unclaimed = Unit.objects.create(name="Engine 3", type="Fire", location_lat=1.0, location_lng=1.0)
        offline_but_claimed = Unit.objects.create(
            name="Engine 4", type="Fire", location_lat=1.0, location_lng=1.0, is_online=False)

        response = self.client.get("/api/units/?claimable=true")
        ids = [u["id"] for u in response.json()]
        self.assertNotIn(claimed_online.id, ids)
        self.assertIn(unclaimed.id, ids)
        self.assertIn(offline_but_claimed.id, ids)

    def test_claim_requires_authentication(self):
        unit = Unit.objects.create(name="Engine 5", type="Fire", location_lat=1.0, location_lng=1.0)
        response = self.client.post(
            "/api/units/claim/",
            {"id": unit.id, "location_lat": 32.0, "location_lng": 34.0},
            format="json",
        )
        self.assertIn(response.status_code,
                       (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))

    def test_claim_by_id_sets_online_links_user_and_sets_gps(self):
        unit = Unit.objects.create(name="Engine 6", type="Fire", location_lat=0.0, location_lng=0.0)
        self.client.force_authenticate(self.field_user)
        response = self.client.post(
            "/api/units/claim/",
            {"id": unit.id, "location_lat": 32.08, "location_lng": 34.78},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        unit.refresh_from_db()
        self.field_user.refresh_from_db()
        self.assertTrue(unit.is_online)
        self.assertEqual(unit.location_lat, 32.08)
        self.assertEqual(unit.location_lng, 34.78)
        self.assertEqual(self.field_user.unit_id, unit.id)

    def test_claim_by_name_finds_or_creates_matching_the_dispatch_bridge(self):
        """Claiming by name must resolve to the exact same row mobile_dispatch's
        name-matching would find, so a claimed unit and a later dashboard
        dispatch-by-name refer to the same DB row."""
        self.client.force_authenticate(self.field_user)
        response = self.client.post(
            "/api/units/claim/",
            {"name": "Patrol 7", "type": "Police", "location_lat": 32.0, "location_lng": 34.0},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        unit = Unit.objects.get(name="Patrol 7")
        self.assertTrue(unit.is_online)

        response2 = self.client.post("/api/mobile/dispatch/", {
            "incident_id": "live-501", "incident_title": "Test",
            "location_lat": 32.1, "location_lng": 34.1,
            "units": [{"mock_unit_num": 999, "name": "Patrol 7", "type": "Police"}],
        }, format="json")
        self.assertEqual(response2.status_code, status.HTTP_200_OK)
        task = Task.objects.get(mock_unit_id=999)
        self.assertEqual(task.assigned_unit_id, unit.id)

    def test_cannot_claim_a_unit_someone_else_is_actively_using(self):
        unit = Unit.objects.create(name="Engine 8", type="Fire", location_lat=1.0, location_lng=1.0)
        self.client.force_authenticate(self.field_user)
        self.client.post(
            "/api/units/claim/",
            {"id": unit.id, "location_lat": 1.0, "location_lng": 1.0},
            format="json",
        )
        self.client.force_authenticate(self.other_field_user)
        response = self.client.post(
            "/api/units/claim/",
            {"id": unit.id, "location_lat": 2.0, "location_lng": 2.0},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_claiming_a_new_unit_releases_the_previous_one(self):
        unit_a = Unit.objects.create(name="Engine A", type="Fire", location_lat=1.0, location_lng=1.0)
        unit_b = Unit.objects.create(name="Engine B", type="Fire", location_lat=1.0, location_lng=1.0)
        self.client.force_authenticate(self.field_user)
        self.client.post("/api/units/claim/",
                          {"id": unit_a.id, "location_lat": 1.0, "location_lng": 1.0}, format="json")
        self.client.post("/api/units/claim/",
                          {"id": unit_b.id, "location_lat": 1.0, "location_lng": 1.0}, format="json")
        unit_a.refresh_from_db()
        unit_b.refresh_from_db()
        self.assertFalse(unit_a.is_online)
        self.assertTrue(unit_b.is_online)

    def test_disconnect_marks_unit_offline(self):
        unit = Unit.objects.create(name="Engine 9", type="Fire", location_lat=1.0, location_lng=1.0)
        self.client.force_authenticate(self.field_user)
        self.client.post("/api/units/claim/",
                          {"id": unit.id, "location_lat": 1.0, "location_lng": 1.0}, format="json")
        response = self.client.post("/api/units/disconnect/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        unit.refresh_from_db()
        self.assertFalse(unit.is_online)

    def test_disconnect_without_a_claimed_unit_returns_400(self):
        self.client.force_authenticate(self.field_user)
        response = self.client.post("/api/units/disconnect/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_serializer_reports_offline_once_heartbeat_is_stale(self):
        from datetime import timedelta
        from django.utils import timezone as dj_timezone

        unit = Unit.objects.create(
            name="Engine 10", type="Fire", location_lat=1.0, location_lng=1.0,
            is_online=True, last_seen=dj_timezone.now() - timedelta(minutes=5),
        )
        self.client.force_authenticate(self.field_user)
        response = self.client.get(f"/api/units/{unit.id}/")
        # Stored is_online is True, but the serializer must report False once
        # the last heartbeat is older than Unit.HEARTBEAT_STALE_AFTER.
        self.assertFalse(response.json()["is_online"])
