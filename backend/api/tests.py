from django.test import SimpleTestCase

from api.views import normalize_unit_type


class NormalizeUnitTypeTests(SimpleTestCase):
    def test_medical_aliases_are_normalized_to_medical(self):
        self.assertEqual(normalize_unit_type("Ambulance"), "MEDICAL")
        self.assertEqual(normalize_unit_type("EMS"), "MEDICAL")
        self.assertEqual(normalize_unit_type("medical"), "MEDICAL")

    def test_fire_aliases_are_normalized_to_fire(self):
        self.assertEqual(normalize_unit_type("Fire"), "FIRE")
        self.assertEqual(normalize_unit_type("fire_truck"), "FIRE")

    def test_police_aliases_are_normalized_to_police(self):
        self.assertEqual(normalize_unit_type("Police"), "POLICE")
        self.assertEqual(normalize_unit_type("patrol"), "POLICE")
