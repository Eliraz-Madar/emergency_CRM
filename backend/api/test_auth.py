"""
Authentication-flow tests: JWT issuance with custom claims, token refresh, and
the units/heartbeat endpoint gated behind IsAuthenticated.
"""
from rest_framework.test import APITestCase
from rest_framework import status

from api.models import User, Unit


class TokenObtainTests(APITestCase):
    def setUp(self):
        self.unit = Unit.objects.create(
            name="Engine 9", type="Fire", location_lat=1.0, location_lng=1.0)
        self.user = User.objects.create_user(
            username="field9", password="pass1234", role=User.Roles.FIELD, unit=self.unit)

    def test_valid_login_returns_access_refresh_and_custom_claims(self):
        response = self.client.post(
            "/api/token/", {"username": "field9", "password": "pass1234"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        for key in ("access", "refresh", "user_id", "username", "role", "unit_id", "unit_type"):
            self.assertIn(key, body)
        self.assertEqual(body["role"], "fieldunit")
        self.assertEqual(body["unit_type"], "Fire")

    def test_invalid_password_is_rejected(self):
        response = self.client.post(
            "/api/token/", {"username": "field9", "password": "wrong-password"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_refresh_token_issues_new_access_token(self):
        login = self.client.post(
            "/api/token/", {"username": "field9", "password": "pass1234"}, format="json").json()
        response = self.client.post(
            "/api/token/refresh/", {"refresh": login["refresh"]}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.json())


class UnitHeartbeatRoutingTests(APITestCase):
    """
    Previously a documented bug: urls.py had `path("", include(router.urls))`
    BEFORE `path("units/heartbeat/", unit_heartbeat, ...)`, so DefaultRouter's
    detail route (`units/<pk>/`, regex `[^/.]+`) matched the literal string
    "heartbeat" first and every request to /api/units/heartbeat/ was routed
    to UnitViewSet's detail dispatcher (pk="heartbeat") instead of the
    `unit_heartbeat` view, always returning 405.

    Fixed in final changes/05_user_unit_claiming_and_live_sync.md by moving
    the `units/heartbeat/` path before the router include. This test now
    pins the CORRECT behavior: the endpoint is reachable, authenticated, and
    updates the linked Unit's liveness (and optionally GPS).
    """

    def setUp(self):
        self.unit = Unit.objects.create(
            name="Engine 9", type="Fire", location_lat=1.0, location_lng=1.0, is_online=False)
        self.linked_user = User.objects.create_user(
            username="field_linked", password="pass1234", role=User.Roles.FIELD, unit=self.unit)

    def test_heartbeat_endpoint_is_reachable_and_updates_liveness(self):
        self.client.force_authenticate(self.linked_user)
        response = self.client.post("/api/units/heartbeat/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.unit.refresh_from_db()
        self.assertTrue(self.unit.is_online)
        self.assertIsNotNone(self.unit.last_seen)

    def test_heartbeat_updates_location_when_provided(self):
        self.client.force_authenticate(self.linked_user)
        response = self.client.post(
            "/api/units/heartbeat/",
            {"location_lat": 32.5, "location_lng": 34.9},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.json()["location_updated"])
        self.unit.refresh_from_db()
        self.assertEqual(self.unit.location_lat, 32.5)
        self.assertEqual(self.unit.location_lng, 34.9)

    def test_heartbeat_without_location_still_succeeds(self):
        self.client.force_authenticate(self.linked_user)
        response = self.client.post("/api/units/heartbeat/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.json()["location_updated"])

    def test_heartbeat_requires_authentication(self):
        response = self.client.post("/api/units/heartbeat/")
        self.assertIn(response.status_code,
                       (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))
