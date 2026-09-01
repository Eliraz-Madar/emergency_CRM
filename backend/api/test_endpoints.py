"""
Endpoint-level tests: request/response JSON shape for the core
Incident/Task/Unit REST resources, and the mobile-bridge endpoints that mirror
dashboard/mobile dispatches into the database as Tasks.
"""
from rest_framework.test import APITestCase
from rest_framework import status

from api.models import (
    User, Incident, Unit, Task, FieldCommand, FieldCommandNote,
    IncidentEvent, MajorIncident, IncidentFigureReport,
)


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

    def test_unit_tasks_action_strict_fk_no_auth(self):
        # Regional dashboard's selected-vehicle panel — anonymous read, and
        # ONLY the assigned_unit FK (never the mock_unit_id=7 that also
        # happens to equal some other unit's pk).
        response = self.client.get(f"/api/units/{self.unit.id}/tasks/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([r["id"] for r in response.json()], [self.task.id])

        empty = Unit.objects.create(
            name="Fresh", type="Police", location_lat=1.0, location_lng=1.0)
        response = self.client.get(f"/api/units/{empty.id}/tasks/")
        self.assertEqual(response.json(), [])


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

    def test_dispatch_onto_a_real_incident_pk_reuses_it_no_mirror(self):
        """When incident_id is a real Incident's pk, the bridge dispatches onto
        that row instead of creating a duplicate mock_incident_id mirror."""
        real = Incident.objects.create(
            title="Theft", location_lat=32.08, location_lng=34.78,
            priority="HIGH", channel="POLICE")
        before = Incident.objects.count()

        response = self.client.post("/api/mobile/dispatch/", {
            "incident_id": real.id,
            "incident_title": "Theft",
            "location_lat": 32.08, "location_lng": 34.78,
            "units": [{"mock_unit_num": 55, "name": "Car 55", "type": "Police"}],
        }, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Incident.objects.count(), before)  # no mirror row
        real.refresh_from_db()
        self.assertEqual(real.channel, "POLICE")  # real row left untouched
        self.assertTrue(Task.objects.filter(incident=real, mock_unit_id=55).exists())

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

    def test_claimable_allows_reclaiming_own_and_stale_units(self):
        from django.utils import timezone as _tz
        stale = _tz.now() - Unit.HEARTBEAT_STALE_AFTER * 2

        mine = Unit.objects.create(
            name="Mine", type="Police", location_lat=1.0, location_lng=1.0, is_online=True)
        User.objects.get(username="field_claim").unit = mine
        User.objects.get(username="field_claim").save()

        stale_other = Unit.objects.create(
            name="Stale", type="Police", location_lat=1.0, location_lng=1.0,
            is_online=True, last_seen=stale)
        User.objects.create_user(
            username="dead_app", password="x", role=User.Roles.FIELD, unit=stale_other)

        self.client.force_authenticate(User.objects.get(username="field_claim"))
        ids = [u["id"] for u in self.client.get("/api/units/?claimable=true").json()]
        self.assertIn(mine.id, ids)          # can always re-claim my own
        self.assertIn(stale_other.id, ids)   # dead-app holder -> claimable again

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

    def test_reclaim_with_mock_location_keeps_last_real_position(self):
        """A reconnecting device without a GPS fix yet reports the app's fixed
        fallback (mobile-app/utils/location.js MOCK_LOCATION) flagged
        is_mock_location=true — that must never overwrite a unit's last real
        position (the "teleports back to its initial location" bug)."""
        unit = Unit.objects.create(
            name="Engine 11", type="Fire", location_lat=32.05, location_lng=34.78)
        self.client.force_authenticate(self.field_user)
        response = self.client.post(
            "/api/units/claim/",
            {"id": unit.id, "location_lat": 32.0853, "location_lng": 34.7818,
             "is_mock_location": True},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        unit.refresh_from_db()
        self.assertEqual(unit.location_lat, 32.05)
        self.assertEqual(unit.location_lng, 34.78)
        # The claim response / broadcast must reflect the KEPT position too,
        # not the rejected mock reading.
        self.assertEqual(response.json()["location_lat"], 32.05)

    def test_claim_with_mock_location_accepted_for_brand_new_unit(self):
        """A unit with no real position yet (the routine-dispatch seed default
        of 0,0) should still get SOME position from a mock-location claim
        rather than staying at 0,0."""
        unit = Unit.objects.create(name="Engine 12", type="Fire", location_lat=0.0, location_lng=0.0)
        self.client.force_authenticate(self.field_user)
        self.client.post(
            "/api/units/claim/",
            {"id": unit.id, "location_lat": 32.0853, "location_lng": 34.7818,
             "is_mock_location": True},
            format="json",
        )
        unit.refresh_from_db()
        self.assertEqual(unit.location_lat, 32.0853)
        self.assertEqual(unit.location_lng, 34.7818)

    def test_heartbeat_with_mock_location_keeps_last_real_position(self):
        unit = Unit.objects.create(
            name="Engine 13", type="Fire", location_lat=32.05, location_lng=34.78,
            is_online=True)
        self.field_user.unit = unit
        self.field_user.save()
        self.client.force_authenticate(self.field_user)
        response = self.client.post(
            "/api/units/heartbeat/",
            {"location_lat": 32.0853, "location_lng": 34.7818, "is_mock_location": True},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        unit.refresh_from_db()
        self.assertEqual(unit.location_lat, 32.05)
        self.assertEqual(unit.location_lng, 34.78)

    def test_heartbeat_without_mock_flag_updates_position_normally(self):
        """Guard against over-fixing: a REAL GPS reading must still update the
        position of a unit that is FREE TO ROAM (no active task)."""
        unit = Unit.objects.create(
            name="Engine 14", type="Fire", location_lat=32.05, location_lng=34.78,
            is_online=True)
        self.field_user.unit = unit
        self.field_user.save()
        self.client.force_authenticate(self.field_user)
        self.client.post(
            "/api/units/heartbeat/",
            {"location_lat": 32.20, "location_lng": 34.90},
            format="json",
        )
        unit.refresh_from_db()
        self.assertEqual(unit.location_lat, 32.20)
        self.assertEqual(unit.location_lng, 34.90)

    def test_dispatched_unit_position_is_server_managed(self):
        """A unit with an active task ignores incoming GPS on both heartbeat
        and re-claim — its map position is server-managed so a stationary demo
        phone can't drag the marker around."""
        unit = Unit.objects.create(
            name="Medic 5", type="EMS", location_lat=32.05, location_lng=34.78, is_online=True)
        incident = Incident.objects.create(
            title="Collision", location_lat=32.10, location_lng=34.85, priority="HIGH")
        Task.objects.create(incident=incident, assigned_unit=unit,
                            title="Respond", status=Task.Status.IN_PROGRESS)
        self.field_user.unit = unit
        self.field_user.save()
        self.client.force_authenticate(self.field_user)

        self.client.post("/api/units/heartbeat/",
                         {"location_lat": 33.0, "location_lng": 35.5}, format="json")
        unit.refresh_from_db()
        self.assertEqual((unit.location_lat, unit.location_lng), (32.05, 34.78))

        self.client.post("/api/units/claim/",
                         {"id": unit.id, "location_lat": 33.0, "location_lng": 35.5},
                         format="json")
        unit.refresh_from_db()
        self.assertEqual((unit.location_lat, unit.location_lng), (32.05, 34.78))

    def test_disconnect_mid_drive_rolls_task_back_to_pending(self):
        """A crew that disconnects before arriving gets its task rolled back so
        the "On My Way" button reappears on reconnect."""
        unit = Unit.objects.create(
            name="Engine 15", type="Fire", location_lat=32.05, location_lng=34.78, is_online=True)
        incident = Incident.objects.create(
            title="Blaze", location_lat=32.10, location_lng=34.85, priority="HIGH")
        task = Task.objects.create(incident=incident, assigned_unit=unit,
                                   title="Respond", status=Task.Status.IN_PROGRESS)
        self.field_user.unit = unit
        self.field_user.save()
        self.client.force_authenticate(self.field_user)

        res = self.client.post("/api/units/disconnect/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        task.refresh_from_db()
        unit.refresh_from_db()
        self.assertEqual(task.status, Task.Status.PENDING)
        self.assertFalse(unit.is_online)

    def test_disconnect_after_arrival_keeps_task_and_parks_at_scene(self):
        from django.utils import timezone as _tz
        unit = Unit.objects.create(
            name="Engine 16", type="Fire", location_lat=32.05, location_lng=34.78, is_online=True)
        incident = Incident.objects.create(
            title="Fire 2", location_lat=32.10, location_lng=34.85, priority="HIGH")
        task = Task.objects.create(
            incident=incident, assigned_unit=unit, title="Respond",
            status=Task.Status.IN_PROGRESS, arrived_at=_tz.now())
        self.field_user.unit = unit
        self.field_user.save()
        self.client.force_authenticate(self.field_user)

        self.client.post("/api/units/disconnect/")
        task.refresh_from_db()
        unit.refresh_from_db()
        self.assertEqual(task.status, Task.Status.IN_PROGRESS)  # not rolled back
        self.assertEqual((unit.location_lat, unit.location_lng), (32.10, 34.85))  # parked on scene


class FieldCommandLinkLifecycleTests(APITestCase):
    def setUp(self):
        self.dispatcher = User.objects.create_user(
            username="fieldops_dispatcher", password="pass1234", role=User.Roles.DISPATCHER)
        self.major_incident = MajorIncident.objects.create(
            title="Field command link lifecycle",
            incident_type=MajorIncident.IncidentType.FLOOD,
            description="Lifecycle test incident",
            location_lat=32.0,
            location_lng=34.0,
        )

    def test_prevent_duplicate_active_link_on_create(self):
        self.client.force_authenticate(self.dispatcher)
        first = self.client.post(
            "/api/field-commands/",
            {
                "name": "North Field Post",
                "location_lat": 31.9,
                "location_lng": 34.1,
                "major_incident_id": self.major_incident.id,
            },
            format="json",
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        second = self.client.post(
            "/api/field-commands/",
            {
                "name": "South Field Post",
                "location_lat": 32.1,
                "location_lng": 34.2,
                "major_incident_id": self.major_incident.id,
            },
            format="json",
        )
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("major_incident", second.json())

    def test_prevent_duplicate_active_link_on_update(self):
        first = FieldCommand.objects.create(
            name="North Field Post",
            location_lat=31.9,
            location_lng=34.1,
            major_incident=self.major_incident,
        )
        second = FieldCommand.objects.create(
            name="South Field Post",
            location_lat=32.1,
            location_lng=34.2,
        )

        self.client.force_authenticate(self.dispatcher)
        response = self.client.patch(
            f"/api/field-commands/{second.field_key}/",
            {"major_incident_id": self.major_incident.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("major_incident", response.json())
        self.assertEqual(
            FieldCommand.objects.filter(major_incident=self.major_incident, status=FieldCommand.Status.ACTIVE).count(),
            1,
        )

    def test_cascade_close_incident_when_field_command_closed(self):
        field_command = FieldCommand.objects.create(
            name="North Field Post",
            location_lat=31.9,
            location_lng=34.1,
            major_incident=self.major_incident,
        )
        incident = Incident.objects.create(
            title="Linked incident",
            description="Should close with field-post closure",
            location_lat=31.9,
            location_lng=34.1,
            field_command=field_command,
        )

        self.client.force_authenticate(self.dispatcher)
        response = self.client.post(
            f"/api/field-commands/{field_command.field_key}/close/",
            {
                "closed_reason": "Field post shutdown complete",
                "closed_by_role": FieldCommand.ClosedByRole.COMMAND_CENTER,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        incident.refresh_from_db()
        field_command.refresh_from_db()
        self.assertEqual(incident.status, Incident.Status.CLOSED)
        self.assertEqual(field_command.status, FieldCommand.Status.CLOSED)
        self.assertIsNone(incident.field_command_id)


class FieldCommandMissionTests(APITestCase):
    def setUp(self):
        self.dispatcher = User.objects.create_user(
            username="mission_dispatcher", password="pass1234", role=User.Roles.DISPATCHER)
        self.client.force_authenticate(self.dispatcher)
        self.fc = FieldCommand.objects.create(
            name="Mission Test Post", location_lat=32.0, location_lng=34.0)
        self.attached = Unit.objects.create(
            name="Attached Unit", type=Unit.UnitType.FIRE,
            location_lat=32.0, location_lng=34.0, field_command=self.fc)
        self.other = Unit.objects.create(
            name="Other Unit", type=Unit.UnitType.EMS,
            location_lat=32.0, location_lng=34.0)

    def test_create_mission_logs_typed_note(self):
        res = self.client.post(
            f"/api/field-commands/{self.fc.field_key}/missions/",
            {"title": "Evacuate block C", "assigned_unit": self.attached.id},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        body = res.json()
        self.assertEqual(len(body["missions"]), 1)
        self.assertEqual(body["missions"][0]["assigned_unit_name"], "Attached Unit")
        # The mission is logged to the operational timeline as a typed note.
        kinds = [n["kind"] for n in body["operational_notes"]]
        self.assertIn("MISSION", kinds)

    def test_mission_force_must_be_attached_to_post(self):
        res = self.client.post(
            f"/api/field-commands/{self.fc.field_key}/missions/",
            {"title": "Bad assignee", "assigned_unit": self.other.id},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("assigned_unit", res.json())

    def test_update_mission_status(self):
        mission = self.fc.missions.create(title="Hold the line")
        res = self.client.patch(
            f"/api/field-commands/{self.fc.field_key}/missions/{mission.id}/",
            {"status": "DONE"},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        mission.refresh_from_db()
        self.assertEqual(mission.status, "DONE")

    def test_mission_status_change_names_force_and_unit(self):
        """A crew marking a mission on it / finished must be logged by force
        AND by the specific mobile unit — in the field timeline and the
        incident's own event log."""
        incident = Incident.objects.create(
            title="Depot blaze", location_lat=32.0, location_lng=34.0, priority="HIGH")
        incident.field_command = self.fc
        incident.save(update_fields=["field_command"])
        crew_user = User.objects.create_user(
            username="engine7_driver", password="pass1234",
            role=User.Roles.FIELD, unit=self.attached)

        res = self.client.post(
            f"/api/field-commands/{self.fc.field_key}/missions/",
            {"title": "Knock down the fire", "force_type": "FIRE", "incident_id": incident.id},
            format="json",
        )
        mid = res.json()["missions"][0]["id"]

        self.client.force_authenticate(crew_user)
        res = self.client.patch(
            f"/api/field-commands/{self.fc.field_key}/missions/{mid}/",
            {"status": "IN_PROGRESS"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        note = next(n for n in res.json()["operational_notes"]
                    if n["kind"] == "MISSION" and "In Progress" in n["message"])
        self.assertIn("Fire", note["message"])
        self.assertIn("Attached Unit", note["message"])

        feed = self.client.get(f"/api/events/?incident_id={incident.id}").json()
        hit = next(e for e in feed if "in progress" in e["message"].lower()
                   and "Knock down the fire" in e["message"])
        self.assertIn("Fire", hit["message"])
        self.assertIn("Attached Unit", hit["message"])

    def test_event_scoped_field_command_refuses_more_incidents(self):
        """A post opened by escalating one incident ("Go Live") is bound to it
        and rejects assign-incident for any other."""
        origin = Incident.objects.create(
            title="Origin quake", location_lat=32.0, location_lng=34.0, priority="HIGH")
        mi = MajorIncident.objects.create(
            incident=origin, title="Origin quake",
            incident_type=MajorIncident.IncidentType.EARTHQUAKE,
            location_lat=32.0, location_lng=34.0)
        bound_fc = FieldCommand.objects.create(
            name="Bound Post", location_lat=32.0, location_lng=34.0, major_incident=mi)
        other = Incident.objects.create(
            title="Unrelated call", location_lat=32.1, location_lng=34.1, priority="MED")

        res = self.client.post(
            f"/api/field-commands/{bound_fc.field_key}/assign-incident/",
            {"incident_id": other.id}, format="json")
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)

    def test_missions_blocked_on_closed_post(self):
        self.client.post(
            f"/api/field-commands/{self.fc.field_key}/close/",
            {"closed_reason": "done", "closed_by_role": FieldCommand.ClosedByRole.COMMAND_CENTER},
            format="json",
        )
        res = self.client.post(
            f"/api/field-commands/{self.fc.field_key}/missions/",
            {"title": "Too late"}, format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)

    def test_create_incident_and_force_scoped_task(self):
        incident = Incident.objects.create(
            title="Warehouse fire", location_lat=32.0, location_lng=34.0, priority="HIGH")
        res = self.client.post(
            f"/api/field-commands/{self.fc.field_key}/missions/",
            {"title": "Ventilate the roof", "force_type": "FIRE", "incident_id": incident.id},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        m = res.json()["missions"][0]
        self.assertEqual(m["force_type"], "FIRE")
        self.assertEqual(m["incident"], incident.id)
        self.assertEqual(m["incident_title"], "Warehouse fire")
        # timeline note names the incident + force
        note = next(n for n in res.json()["operational_notes"] if n["kind"] == "MISSION")
        self.assertIn("Warehouse fire", note["message"])
        # and it lands in the INCIDENT's own event log too
        feed = self.client.get(f"/api/events/?incident_id={incident.id}").json()
        titles = [e["message"] for e in feed]
        self.assertTrue(any("Ventilate the roof" in t and "Fire" in t for t in titles), titles)

        # advancing the task status also shows on the incident feed
        mid = m["id"]
        self.client.patch(
            f"/api/field-commands/{self.fc.field_key}/missions/{mid}/",
            {"status": "DONE"}, format="json")
        feed = self.client.get(f"/api/events/?incident_id={incident.id}").json()
        self.assertTrue(any("done" in e["message"].lower() and "Ventilate the roof" in e["message"]
                            for e in feed))

    def test_task_rejects_unknown_incident(self):
        res = self.client.post(
            f"/api/field-commands/{self.fc.field_key}/missions/",
            {"title": "x", "force_type": "FIRE", "incident_id": 999999},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_task_rejects_bad_force_type(self):
        res = self.client.post(
            f"/api/field-commands/{self.fc.field_key}/missions/",
            {"title": "x", "force_type": "MARINES"}, format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)


class AssignUnitAndEnRouteTests(APITestCase):
    """assign-unit hits the real incident (never a mock_incident_id mirror) and
    a unit accepting its task ("On My Way") flows through to the incident state
    and any linked Field Command Post."""

    def setUp(self):
        from django.utils import timezone as _tz
        self.dispatcher = _make_dispatcher()
        self.field_unit = User.objects.create_user(
            username="en_route_unit", password="pass1234", role=User.Roles.FIELD)
        # Actively online — assigned_unit_ids only lists connected vehicles.
        self.unit = Unit.objects.create(
            name="Medic 3", type=Unit.UnitType.EMS, location_lat=32.05, location_lng=34.75,
            is_online=True, last_seen=_tz.now())
        self.incident = Incident.objects.create(
            title="Collapse", location_lat=32.08, location_lng=34.78, priority="HIGH")

    def test_assign_unit_uses_real_incident_and_advances_to_pending(self):
        self.client.force_authenticate(self.dispatcher)
        res = self.client.post(
            f"/api/incidents/{self.incident.id}/assign-unit/",
            {"unit_id": self.unit.id}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        task = Task.objects.get(assigned_unit=self.unit)
        self.assertEqual(task.incident_id, self.incident.id)
        # No mirror Incident keyed on mock_incident_id was created.
        self.assertEqual(Incident.objects.count(), 1)

        self.incident.refresh_from_db()
        self.assertEqual(self.incident.status, Incident.Status.PENDING)

    def test_redispatch_after_unassign_creates_a_fresh_pending_task(self):
        """Dispatch → unassign (cancels the task) → dispatch the SAME unit to
        the SAME incident again must hand the crew a LIVE PENDING task, not
        silently reuse the cancelled one (which the mobile app filters out, so
        the crew would never see the incident)."""
        self.client.force_authenticate(self.dispatcher)
        url = f"/api/incidents/{self.incident.id}/assign-unit/"

        self.client.post(url, {"unit_id": self.unit.id}, format="json")
        self.client.post(
            f"/api/incidents/{self.incident.id}/unassign-unit/",
            {"unit_id": self.unit.id}, format="json")
        self.assertEqual(
            Task.objects.get(assigned_unit=self.unit).status, Task.Status.CANCELLED)

        res = self.client.post(url, {"unit_id": self.unit.id}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        live = Task.objects.filter(
            assigned_unit=self.unit, incident=self.incident
        ).exclude(status__in=Task.TERMINAL_STATUSES)
        self.assertEqual(live.count(), 1)
        self.assertEqual(live.first().status, Task.Status.PENDING)

        # And it is visible on the mobile task feed.
        feed = self.client.get(f"/api/tasks/?mock_unit={self.unit.id}").json()
        self.assertTrue(any(t["incident"] == self.incident.id and t["status"] == "PENDING"
                            for t in feed), feed)

    def test_field_unit_accept_advances_incident_and_logs_field_command_note(self):
        fc = FieldCommand.objects.create(
            name="North Post", location_lat=32.08, location_lng=34.78)
        self.incident.field_command = fc
        self.incident.status = Incident.Status.PENDING
        self.incident.save(update_fields=["field_command", "status"])
        task = Task.objects.create(
            incident=self.incident, assigned_unit=self.unit,
            title="Respond", status=Task.Status.PENDING)

        self.client.force_authenticate(self.field_unit)
        res = self.client.patch(
            f"/api/tasks/{task.id}/", {"status": "IN_PROGRESS"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        self.incident.refresh_from_db()
        self.assertEqual(self.incident.status, Incident.Status.EN_ROUTE)
        self.assertTrue(
            FieldCommandNote.objects.filter(
                field_command=fc, kind=FieldCommandNote.Kind.STATUS).exists())

    def test_incident_on_scene_logs_field_command_arrival_note(self):
        """A crew tapping "Arrived" PATCHes the incident to ON_SCENE directly
        (not the task) — the linked Field Command Post's Operational Timeline
        must still get an arrival entry naming the vehicle."""
        fc = FieldCommand.objects.create(
            name="South Post", location_lat=32.08, location_lng=34.78)
        self.incident.field_command = fc
        self.incident.status = Incident.Status.EN_ROUTE
        self.incident.save(update_fields=["field_command", "status"])
        Task.objects.create(
            incident=self.incident, assigned_unit=self.unit,
            title="Respond", status=Task.Status.IN_PROGRESS)

        self.client.force_authenticate(self.field_unit)
        res = self.client.patch(
            f"/api/incidents/{self.incident.id}/",
            {"status": "ON_SCENE"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        note = FieldCommandNote.objects.filter(
            field_command=fc, kind=FieldCommandNote.Kind.STATUS).order_by("-created_at").first()
        self.assertIsNotNone(note)
        self.assertIn(self.unit.name, note.message)
        self.assertIn("arrived on scene", note.message.lower())

    def test_unassign_incident_frees_it_to_relink(self):
        fc_a = FieldCommand.objects.create(
            name="Post A", location_lat=32.0, location_lng=34.0)
        fc_b = FieldCommand.objects.create(
            name="Post B", location_lat=32.1, location_lng=34.1)
        self.incident.field_command = fc_a
        self.incident.save(update_fields=["field_command"])

        self.client.force_authenticate(self.dispatcher)
        # Can't link straight to B while linked to A.
        res = self.client.post(
            f"/api/field-commands/{fc_b.field_key}/assign-incident/",
            {"incident_id": self.incident.id}, format="json")
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)

        # Unlink from A...
        res = self.client.post(
            f"/api/field-commands/{fc_a.field_key}/unassign-incident/",
            {"incident_id": self.incident.id}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.incident.refresh_from_db()
        self.assertIsNone(self.incident.field_command_id)

        # ...now B accepts it.
        res = self.client.post(
            f"/api/field-commands/{fc_b.field_key}/assign-incident/",
            {"incident_id": self.incident.id}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.incident.refresh_from_db()
        self.assertEqual(self.incident.field_command_id, fc_b.id)

    def test_task_arrive_action_marks_arrival_and_advances_incident(self):
        fc = FieldCommand.objects.create(
            name="Arrive Post", location_lat=32.08, location_lng=34.78)
        self.incident.field_command = fc
        self.incident.status = Incident.Status.EN_ROUTE
        self.incident.save(update_fields=["field_command", "status"])
        task = Task.objects.create(
            incident=self.incident, assigned_unit=self.unit,
            title="Respond", status=Task.Status.IN_PROGRESS)

        self.client.force_authenticate(self.field_unit)
        res = self.client.post(f"/api/tasks/{task.id}/arrive/", {}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIsNotNone(res.json()["arrived_at"])

        task.refresh_from_db()
        self.incident.refresh_from_db()
        self.assertIsNotNone(task.arrived_at)
        self.assertEqual(self.incident.status, Incident.Status.ON_SCENE)

        note = FieldCommandNote.objects.filter(
            field_command=fc, kind=FieldCommandNote.Kind.STATUS).order_by("-created_at").first()
        self.assertIsNotNone(note)
        self.assertIn(self.unit.name, note.message)
        self.assertIn("arrived on scene", note.message.lower())

        # Idempotent — a second tap doesn't move anything or re-log.
        note_count = FieldCommandNote.objects.filter(field_command=fc).count()
        res2 = self.client.post(f"/api/tasks/{task.id}/arrive/", {}, format="json")
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        self.assertEqual(
            FieldCommandNote.objects.filter(field_command=fc).count(), note_count)

    def test_assigned_units_reports_crew_confirmed_arrival(self):
        self.client.force_authenticate(self.dispatcher)
        task = Task.objects.create(
            incident=self.incident, assigned_unit=self.unit,
            title="Respond", status=Task.Status.IN_PROGRESS)
        self.incident.status = Incident.Status.EN_ROUTE
        self.incident.save(update_fields=["status"])

        body = self.client.get(f"/api/incidents/{self.incident.id}/").json()
        self.assertFalse(body["assigned_units"][0]["arrived"])

        self.client.force_authenticate(self.field_unit)
        self.client.post(f"/api/tasks/{task.id}/arrive/", {}, format="json")

        self.client.force_authenticate(self.dispatcher)
        body = self.client.get(f"/api/incidents/{self.incident.id}/").json()
        self.assertTrue(body["assigned_units"][0]["arrived"])

    def test_field_report_operational_note_names_the_reporting_vehicle(self):
        """A task-scoped field report is attributed to the vehicle (from the
        dispatched Task), not the operator's login name."""
        fc = FieldCommand.objects.create(
            name="East Post", location_lat=32.08, location_lng=34.78)
        self.incident.field_command = fc
        self.incident.save(update_fields=["field_command"])
        task = Task.objects.create(
            incident=self.incident, assigned_unit=self.unit,
            title="Respond", status=Task.Status.IN_PROGRESS)

        self.client.force_authenticate(self.field_unit)
        self.client.post(
            "/api/field/add-event/?fieldId=default",
            {"event_type": "STATUS_CHANGE", "title": "Task Update: Respond",
             "description": "Notes: perimeter secure", "task_id": task.id},
            format="multipart", HTTP_X_ACTOR_ROLE="UNIT")

        fc_body = self.client.get(f"/api/field-commands/{fc.field_key}/").json()
        reports = [n for n in fc_body["operational_notes"] if n.get("kind") == "REPORT"]
        self.assertEqual(len(reports), 1)
        self.assertEqual(reports[0]["created_by"], self.unit.name)
        self.assertEqual(reports[0]["unit_name"], self.unit.name)
        self.assertIn(self.unit.name, reports[0]["message"])

    def test_add_event_surfaces_on_field_command_operational_timeline(self):
        fc = FieldCommand.objects.create(
            name="West Post", location_lat=32.08, location_lng=34.78)
        self.incident.field_command = fc
        self.incident.save(update_fields=["field_command"])

        self.client.force_authenticate(self.field_unit)
        res = self.client.post(
            "/api/field/add-event/?fieldId=default",
            {
                "event_type": "STATUS_CHANGE",
                "title": "Task Update: Respond",
                "description": "Notes: heavy smoke on arrival",
                "incident_id": self.incident.id,
            },
            format="multipart",
            HTTP_X_ACTOR_ROLE="UNIT",
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

        event = IncidentEvent.objects.get(title="Task Update: Respond")
        self.assertEqual(event.incident_id, self.incident.id)

        # The report shows on the field command's Operational Timeline as a
        # REPORT entry carrying the reporter and the incident name (media too,
        # when attached) — not a flat FieldCommandNote string.
        fc_body = self.client.get(f"/api/field-commands/{fc.field_key}/").json()
        reports = [n for n in fc_body["operational_notes"] if n.get("kind") == "REPORT"]
        self.assertEqual(len(reports), 1)
        self.assertEqual(reports[0]["created_by"], self.field_unit.username)
        self.assertIn(self.incident.title, reports[0]["message"])
        self.assertIn("heavy smoke on arrival", reports[0]["message"])

    def test_assigned_unit_ids_excludes_terminal_tasks_and_closed_incident(self):
        self.client.force_authenticate(self.dispatcher)
        Task.objects.create(
            incident=self.incident, assigned_unit=self.unit,
            title="Respond", status=Task.Status.PENDING)

        body = self.client.get(f"/api/incidents/{self.incident.id}/").json()
        self.assertEqual(body["assigned_unit_ids"], [self.unit.id])

        # Cancel the task -> no longer "assigned".
        Task.objects.filter(incident=self.incident).update(status=Task.Status.CANCELLED)
        body = self.client.get(f"/api/incidents/{self.incident.id}/").json()
        self.assertEqual(body["assigned_unit_ids"], [])

    def test_assigned_unit_ids_drops_a_disconnected_vehicle(self):
        self.client.force_authenticate(self.dispatcher)
        Task.objects.create(
            incident=self.incident, assigned_unit=self.unit,
            title="Respond", status=Task.Status.PENDING)
        self.assertEqual(
            self.client.get(f"/api/incidents/{self.incident.id}/").json()["assigned_unit_ids"],
            [self.unit.id])

        # Vehicle's app disconnects — it's no longer on the map, so it can't be
        # shown as assigned to the event.
        self.unit.is_online = False
        self.unit.save(update_fields=["is_online"])
        self.assertEqual(
            self.client.get(f"/api/incidents/{self.incident.id}/").json()["assigned_unit_ids"],
            [])

    def test_assigned_units_keeps_a_disconnected_vehicle(self):
        """Unlike assigned_unit_ids, the assigned_units list KEEPS a crew whose
        device dropped — the dispatch survives the disconnect, flagged offline."""
        self.client.force_authenticate(self.dispatcher)
        Task.objects.create(
            incident=self.incident, assigned_unit=self.unit,
            title="Respond", status=Task.Status.PENDING)

        self.unit.is_online = False
        self.unit.save(update_fields=["is_online"])
        body = self.client.get(f"/api/incidents/{self.incident.id}/").json()
        self.assertEqual(body["assigned_unit_ids"], [])
        self.assertEqual(
            body["assigned_units"],
            [{"id": self.unit.id, "name": self.unit.name, "type": self.unit.type,
              "is_online": False, "task_status": Task.Status.PENDING, "arrived": False}])

    def test_task_reports_action_returns_field_report_history(self):
        task = Task.objects.create(
            incident=self.incident, assigned_unit=self.unit,
            title="Respond", status=Task.Status.PENDING)
        self.client.force_authenticate(self.field_unit)
        self.client.post(
            "/api/field/add-event/?fieldId=default",
            {"event_type": "STATUS_CHANGE", "title": "Task Update: Respond",
             "description": "Notes: on scene", "task_id": task.id},
            format="multipart", HTTP_X_ACTOR_ROLE="UNIT")

        event = IncidentEvent.objects.get(title="Task Update: Respond")
        self.assertEqual(event.task_id, task.id)
        self.assertEqual(event.incident_id, self.incident.id)  # inferred from task

        res = self.client.get(f"/api/tasks/{task.id}/reports/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        rows = res.json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["title"], "Task Update: Respond")
        self.assertIn("media", rows[0])

    def test_unit_active_assignment_is_opt_in(self):
        Task.objects.create(
            incident=self.incident, assigned_unit=self.unit,
            title="Respond", status=Task.Status.PENDING)
        self.client.force_authenticate(self.dispatcher)

        plain = self.client.get(f"/api/units/{self.unit.id}/").json()
        self.assertIsNone(plain["active_assignment"])

        detailed = self.client.get(
            f"/api/units/{self.unit.id}/?with_assignment=true").json()
        self.assertEqual(detailed["active_assignment"]["incident_id"], self.incident.id)
        self.assertEqual(detailed["active_assignment"]["task_status"], Task.Status.PENDING)

    def test_closing_incident_cancels_open_tasks(self):
        task = Task.objects.create(
            incident=self.incident, assigned_unit=self.unit,
            title="Respond", status=Task.Status.IN_PROGRESS)
        self.incident.status = Incident.Status.RESOLVED
        self.incident.save(update_fields=["status"])

        self.client.force_authenticate(self.dispatcher)
        res = self.client.patch(
            f"/api/incidents/{self.incident.id}/",
            {"status": "CLOSED", "closed_reason": "resolved on site",
             "closed_by_role": "COMMAND_CENTER"},
            format="json", HTTP_X_ACTOR_ROLE="COMMAND_CENTER")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        task.refresh_from_db()
        self.assertEqual(task.status, Task.Status.CANCELLED)

    def test_accepting_task_logs_exactly_one_en_route_event(self):
        """Tapping "On My Way" writes ONE "<unit> en route" line to the regional
        event log — not that line plus a separate "Incident status changed:
        PENDING -> EN_ROUTE" record for the same move."""
        self.incident.status = Incident.Status.PENDING
        self.incident.save(update_fields=["status"])
        task = Task.objects.create(
            incident=self.incident, assigned_unit=self.unit,
            title="Respond", status=Task.Status.PENDING)

        self.client.force_authenticate(self.field_unit)
        res = self.client.patch(
            f"/api/tasks/{task.id}/", {"status": "IN_PROGRESS"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        en_route = IncidentEvent.objects.filter(
            incident=self.incident,
            title__icontains="en route",
        )
        self.assertEqual(en_route.count(), 1, list(en_route.values_list("title", flat=True)))
        # And no duplicate "Incident status changed" row for the same transition.
        self.assertFalse(
            IncidentEvent.objects.filter(
                incident=self.incident, title__icontains="EN_ROUTE").exists())

    def test_repeated_status_patch_does_not_relog(self):
        """A second identical PATCH (e.g. the crew re-submits "On the Way" from
        the report screen) is a no-op — no second en-route line."""
        self.incident.status = Incident.Status.PENDING
        self.incident.save(update_fields=["status"])
        task = Task.objects.create(
            incident=self.incident, assigned_unit=self.unit,
            title="Respond", status=Task.Status.PENDING)

        self.client.force_authenticate(self.field_unit)
        self.client.patch(
            f"/api/tasks/{task.id}/", {"status": "IN_PROGRESS"}, format="json")
        self.client.patch(
            f"/api/tasks/{task.id}/", {"status": "IN_PROGRESS"}, format="json")

        self.assertEqual(
            IncidentEvent.objects.filter(
                incident=self.incident, title__icontains="en route").count(),
            1)

    def test_arrive_twice_logs_one_arrival(self):
        """The arrive endpoint claims the arrival atomically — a second call
        (crew taps "Arrived" then files an on-scene report) never writes a
        second "arrived on scene" line."""
        self.incident.status = Incident.Status.EN_ROUTE
        self.incident.save(update_fields=["status"])
        task = Task.objects.create(
            incident=self.incident, assigned_unit=self.unit,
            title="Respond", status=Task.Status.IN_PROGRESS)

        self.client.force_authenticate(self.field_unit)
        self.client.post(f"/api/tasks/{task.id}/arrive/", {}, format="json")
        self.client.post(f"/api/tasks/{task.id}/arrive/", {}, format="json")

        self.assertEqual(
            IncidentEvent.objects.filter(
                incident=self.incident, title__icontains="arrived on scene").count(),
            1)

    def test_regional_event_feed_exposes_report_note_and_media(self):
        """A field report shows its written note and an attachment flag in the
        regional Event Log payload, not just an opaque headline."""
        task = Task.objects.create(
            incident=self.incident, assigned_unit=self.unit,
            title="Respond", status=Task.Status.IN_PROGRESS)
        self.client.force_authenticate(self.field_unit)
        self.client.post(
            "/api/field/add-event/?fieldId=default",
            {"event_type": "UPDATE", "title": "Field report - Collapse",
             "description": "Notes: two casualties, need backup", "task_id": task.id},
            format="multipart", HTTP_X_ACTOR_ROLE="UNIT")

        self.client.force_authenticate(self.dispatcher)
        rows = self.client.get(
            f"/api/events/?incident_id={self.incident.id}").json()
        report = next(r for r in rows if r["message"] == "Field report - Collapse")
        self.assertIn("two casualties", report["description"])
        self.assertIn("media", report)
        self.assertEqual(report["media"], [])


class IncidentFigureReportTests(APITestCase):
    """Field crews submit casualty headcounts per incident; the linked Field
    Command Post's totals are the live sum across its incidents."""

    def setUp(self):
        self.dispatcher = _make_dispatcher()
        self.fc = FieldCommand.objects.create(
            name="Figures Post", location_lat=32.0, location_lng=34.0)
        self.unit_a = Unit.objects.create(
            name="Medic A", type=Unit.UnitType.EMS, location_lat=32.0, location_lng=34.0)
        self.unit_b = Unit.objects.create(
            name="Engine B", type=Unit.UnitType.FIRE, location_lat=32.0, location_lng=34.0)
        self.crew_a = User.objects.create_user(
            username="figs_crew_a", password="pass1234", role=User.Roles.FIELD, unit=self.unit_a)
        self.crew_b = User.objects.create_user(
            username="figs_crew_b", password="pass1234", role=User.Roles.FIELD, unit=self.unit_b)
        self.inc1 = Incident.objects.create(
            title="Mall collapse", location_lat=32.0, location_lng=34.0, priority="HIGH",
            field_command=self.fc)
        self.inc2 = Incident.objects.create(
            title="Road pileup", location_lat=32.1, location_lng=34.1, priority="MED",
            field_command=self.fc)

    def test_submit_upserts_and_aggregates_to_the_post(self):
        self.client.force_authenticate(self.crew_a)
        res = self.client.post(
            f"/api/incidents/{self.inc1.id}/figures/",
            {"injured": 4, "dead": 1, "trapped": 2, "treated": 3, "evacuated": 5},
            format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Same crew resubmits with corrected numbers → the row is REPLACED,
        # not added to.
        self.client.post(
            f"/api/incidents/{self.inc1.id}/figures/",
            {"injured": 6, "dead": 1, "trapped": 0, "treated": 5, "evacuated": 8},
            format="json")
        self.assertEqual(
            IncidentFigureReport.objects.filter(incident=self.inc1, unit=self.unit_a).count(), 1)

        # A second crew reports on the OTHER incident.
        self.client.force_authenticate(self.crew_b)
        self.client.post(
            f"/api/incidents/{self.inc2.id}/figures/",
            {"injured": 2, "dead": 0, "trapped": 1, "treated": 1, "evacuated": 4},
            format="json")

        # The post's figure_totals = sum across both incidents.
        self.client.force_authenticate(self.dispatcher)
        fc = self.client.get(f"/api/field-commands/{self.fc.field_key}/").json()
        self.assertEqual(fc["figure_totals"], {
            "injured": 8, "dead": 1, "trapped": 1, "treated": 6, "evacuated": 12,
        })
        # ...and each linked incident carries its own subtotal.
        inc1_row = next(i for i in fc["incidents"] if i["id"] == self.inc1.id)
        self.assertEqual(inc1_row["figure_report"]["injured"], 6)

    def test_negatives_are_clamped_to_zero(self):
        self.client.force_authenticate(self.crew_a)
        res = self.client.post(
            f"/api/incidents/{self.inc1.id}/figures/",
            {"injured": -5, "dead": "x", "trapped": 3},
            format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        row = IncidentFigureReport.objects.get(incident=self.inc1, unit=self.unit_a)
        self.assertEqual((row.injured, row.dead, row.trapped), (0, 0, 3))

    def test_submitting_figures_logs_a_casualty_event_on_the_incident(self):
        self.client.force_authenticate(self.crew_a)
        self.client.post(
            f"/api/incidents/{self.inc1.id}/figures/",
            {"injured": 4, "trapped": 2}, format="json")
        feed = self.client.get(f"/api/events/?incident_id={self.inc1.id}").json()
        hit = next(e for e in feed if "Casualty figures" in e["message"])
        self.assertIn("Medic A", hit["message"])
        self.assertIn("Injured 4", hit["description"])
        # And the field command's Operational Timeline gets it too.
        fc = self.client.get(f"/api/field-commands/{self.fc.field_key}/").json()
        self.assertTrue(any("reported figures" in n["message"] for n in fc["operational_notes"]))

    def test_get_returns_every_crews_latest_row(self):
        self.client.force_authenticate(self.crew_a)
        self.client.post(f"/api/incidents/{self.inc1.id}/figures/", {"injured": 3}, format="json")
        self.client.force_authenticate(self.crew_b)
        self.client.post(f"/api/incidents/{self.inc1.id}/figures/", {"injured": 1}, format="json")
        rows = self.client.get(f"/api/incidents/{self.inc1.id}/figures/").json()
        self.assertEqual(len(rows), 2)
        self.assertEqual({r["unit_name"] for r in rows}, {"Medic A", "Engine B"})
