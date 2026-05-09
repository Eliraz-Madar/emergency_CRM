"""
Mock Data Service for Dashboard Demo
Provides realistic simulation data with WebSocket real-time updates.
Supports seeded random generation for reproducible demos.
"""
import random
import json
from datetime import datetime, timedelta
from typing import List, Dict, Any
from faker import Faker
import os


class MockDataService:
    """Generates and manages mock operational data for the dashboard."""

    INCIDENT_TYPES = [
        "Traffic Accident", "Medical Emergency", "Fire", "Structure Collapse",
        "Hazmat Spill", "Shooting", "Assault", "Robbery", "Vehicle Pursuit",
        "Drowning", "Heart Attack", "Stroke", "Choking", "Fall"
    ]

    LOCATIONS = [
        {"name": "Downtown Center", "lat": 31.7683, "lng": 35.2137},
        {"name": "Port Authority", "lat": 31.7680, "lng": 35.2250},
        {"name": "Central Station", "lat": 31.7750, "lng": 35.2100},
        {"name": "Shopping District", "lat": 31.7600, "lng": 35.2200},
        {"name": "Industrial Zone", "lat": 31.7550, "lng": 35.2300},
        {"name": "Hospital Complex", "lat": 31.7700, "lng": 35.1950},
        {"name": "Government Center", "lat": 31.7650, "lng": 35.2050},
        {"name": "University Campus", "lat": 31.7800, "lng": 35.2400},
    ]

    CHANNELS = ["Police", "Fire", "EMS", "Civil Defense"]

    FIELD_COMMANDS = [
        {"id": "field-1", "name": "Field Command Alpha", "lat": 32.0853, "lng": 34.7818},
        {"id": "field-2", "name": "Field Command Bravo", "lat": 31.7683, "lng": 35.2137},
        {"id": "north", "name": "Northern Command", "lat": 32.7940, "lng": 34.9896},
        {"id": "south", "name": "Southern Command", "lat": 31.2518, "lng": 34.7913},
    ]

    def __init__(self, seed: int = None):
        """Initialize with optional seed for reproducible data."""
        if seed is not None:
            random.seed(seed)
            Faker.seed(seed)
        self.faker = Faker()
        self.incidents = {}
        self.units = {}
        self.events = []
        self.event_counter = 0
        self.field_commands = list(self.FIELD_COMMANDS)
        self.field_commands = [self._normalize_field_command(cmd) for cmd in self.field_commands]
        self._init_data()

    def _init_data(self):
        """Initialize with sample data."""
        # Create initial incidents
        for i in range(8):
            incident = self._generate_incident(i + 1)
            self.incidents[incident["id"]] = incident

        # Create initial units
        for i in range(12):
            unit = self._generate_unit(i + 1)
            self.units[unit["id"]] = unit

        # Create initial events
        for incident in self.incidents.values():
            self._add_event(
                "incident", incident["id"], f"Incident created: {incident['title']}", "info")

    def _generate_incident(self, incident_id: int = None) -> Dict[str, Any]:
        """Generate a single mock incident."""
        incident_id = incident_id or len(self.incidents) + 1
        location = random.choice(self.LOCATIONS)
        priority = random.choice(["LOW", "MED", "HIGH"])
        field_id = self._random_field_id(allow_unassigned=True)

        return {
            "id": incident_id,
            "title": random.choice(self.INCIDENT_TYPES),
            "description": self.faker.sentence(),
            "priority": priority,
            "status": "OPEN",
            "location_lat": location["lat"] + random.uniform(-0.005, 0.005),
            "location_lng": location["lng"] + random.uniform(-0.005, 0.005),
            "location_name": location["name"],
            "created_at": (datetime.now() - timedelta(hours=random.randint(0, 24))).isoformat(),
            "updated_at": datetime.now().isoformat(),
            "channel": random.choice(self.CHANNELS),
            "assigned_unit_ids": [],
            "field_id": field_id,
            "reporter": self.faker.name(),
            "tags": random.sample(["priority", "high-visibility", "multi-agency"], k=random.randint(1, 2)),
        }

    def _generate_unit(self, unit_id: int = None) -> Dict[str, Any]:
        """Generate a single mock unit."""
        unit_id = unit_id or len(self.units) + 1
        unit_type = random.choice(["Ambulance", "Police", "Fire", "Rescue"])
        location = random.choice(self.LOCATIONS)
        field_id = self._random_field_id(allow_unassigned=True)

        return {
            "id": unit_id,
            "name": f"{unit_type}-{unit_id}",
            "type": unit_type,
            "status": random.choice(["Available", "Dispatched", "OnScene", "Offline"]),
            "location_lat": location["lat"] + random.uniform(-0.01, 0.01),
            "location_lng": location["lng"] + random.uniform(-0.01, 0.01),
            "last_update": datetime.now().isoformat(),
            "crew_size": random.randint(1, 5),
            "field_id": field_id,
        }

    def _random_field_id(self, allow_unassigned: bool = True) -> str:
        if allow_unassigned and random.random() < 0.5:
            return None
        return random.choice(self.FIELD_COMMANDS)["id"]

    def _get_field(self, field_id: str) -> Dict[str, Any]:
        for field in self.field_commands:
            if field.get("id") == field_id:
                return field
        return None

    def _normalize_field_command(self, command: Dict[str, Any]) -> Dict[str, Any]:
        defaults = {
            "status": "ACTIVE",
            "casualty_count": 0,
            "evacuated_count": 0,
            "incident_phase": "Containment",
            "unit_name": command.get("name") if command.get("name") else "Field Unit",
            "incident_type": "General Incident",
            "operational_notes": [],
        }
        normalized = {**defaults, **command}
        if normalized.get("operational_notes") is None:
            normalized["operational_notes"] = []
        return normalized

    def _next_field_command_id(self) -> str:
        existing = {field.get("id") for field in self.field_commands}
        index = 1
        while True:
            candidate = f"field-{index}"
            if candidate not in existing:
                return candidate
            index += 1

    def _add_event(self, entity_type: str, entity_id: int, message: str, level: str = "info"):
        """Add an event to the log."""
        self.event_counter += 1
        event = {
            "id": self.event_counter,
            "timestamp": datetime.now().isoformat(),
            "entity_type": entity_type,
            "entity_id": entity_id,
            "message": message,
            "level": level,
        }
        self.events.append(event)
        # Keep only last 100 events
        if len(self.events) > 100:
            self.events.pop(0)
        return event

    def get_incidents(self, field_id: str = None) -> List[Dict[str, Any]]:
        """Get all incidents, optionally filtered by field_id."""
        incidents = list(self.incidents.values())
        if field_id:
            incidents = [inc for inc in incidents if inc.get("field_id") == field_id]
        return incidents

    def get_units(self, field_id: str = None) -> List[Dict[str, Any]]:
        """Get all units, optionally filtered by field_id."""
        units = list(self.units.values())
        if field_id:
            units = [unit for unit in units if unit.get("field_id") == field_id]
        return units

    def get_fields(self) -> List[Dict[str, Any]]:
        """Get all field command metadata with assignment counts."""
        fields = []
        for field in self.field_commands:
            field_id = field.get("id")
            incidents = self.get_incidents(field_id=field_id)
            units = self.get_units(field_id=field_id)
            fields.append({
                "id": field_id,
                "name": field.get("name"),
                "location_lat": field.get("lat"),
                "location_lng": field.get("lng"),
                "status": field.get("status"),
                "incident_phase": field.get("incident_phase"),
                "casualty_count": field.get("casualty_count", 0),
                "evacuated_count": field.get("evacuated_count", 0),
                "unit_name": field.get("unit_name"),
                "incident_type": field.get("incident_type"),
                "incidents_count": len(incidents),
                "units_count": len(units),
            })
        return fields

    def get_field_summary(self, field_id: str) -> Dict[str, Any]:
        """Get field metadata, incidents, and units for a specific field command."""
        field = self._get_field(field_id)
        if not field:
            return None
        incidents = self.get_incidents(field_id=field_id)
        units = self.get_units(field_id=field_id)
        return {
            "id": field.get("id"),
            "name": field.get("name"),
            "location_lat": field.get("lat"),
            "location_lng": field.get("lng"),
            "status": field.get("status"),
            "incident_phase": field.get("incident_phase"),
            "casualty_count": field.get("casualty_count", 0),
            "evacuated_count": field.get("evacuated_count", 0),
            "unit_name": field.get("unit_name"),
            "incident_type": field.get("incident_type"),
            "operational_notes": field.get("operational_notes", []),
            "incidents": incidents,
            "units": units,
        }

    def create_field_command(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new field command entry (war-room initiated)."""
        field_id = payload.get("id") or self._next_field_command_id()
        command = {
            "id": field_id,
            "name": payload.get("name") or f"Field Command {field_id}",
            "lat": payload.get("location_lat"),
            "lng": payload.get("location_lng"),
            "status": payload.get("status") or "ACTIVE",
            "incident_phase": payload.get("incident_phase") or "Containment",
            "casualty_count": int(payload.get("casualty_count", 0) or 0),
            "evacuated_count": int(payload.get("evacuated_count", 0) or 0),
            "unit_name": payload.get("unit_name") or payload.get("name") or "Field Unit",
            "incident_type": payload.get("incident_type") or "General Incident",
            "operational_notes": [],
        }

        initial_note = payload.get("initial_report") or payload.get("notes")
        if initial_note:
            command["operational_notes"].append({
                "timestamp": datetime.now().isoformat(),
                "message": initial_note,
            })

        command = self._normalize_field_command(command)
        self.field_commands.append(command)
        return command

    def update_field_metrics(self, field_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        """Update field command operational metrics."""
        field = self._get_field(field_id)
        if not field:
            return None

        for key in ["status", "incident_phase", "casualty_count", "evacuated_count", "unit_name", "incident_type"]:
            if key in updates and updates[key] is not None:
                field[key] = updates[key]

        note = updates.get("operational_note") or updates.get("note")
        if note:
            notes = field.get("operational_notes") or []
            notes.append({
                "timestamp": datetime.now().isoformat(),
                "message": note,
            })
            field["operational_notes"] = notes

        return field

    def get_events(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get recent events."""
        return self.events[-limit:]

    def get_incident(self, incident_id: int) -> Dict[str, Any]:
        """Get specific incident."""
        return self.incidents.get(incident_id)

    def update_incident_status(self, incident_id: int, new_status: str) -> Dict[str, Any]:
        """Update incident status."""
        if incident_id not in self.incidents:
            return None

        incident = self.incidents[incident_id]
        old_status = incident["status"]
        incident["status"] = new_status
        incident["updated_at"] = datetime.now().isoformat()

        self._add_event("incident", incident_id,
                        f"Status changed: {old_status} → {new_status}", "info")
        return incident

    def update_incident_priority(self, incident_id: int, new_priority: str) -> Dict[str, Any]:
        """Update incident priority."""
        if incident_id not in self.incidents:
            return None

        incident = self.incidents[incident_id]
        old_priority = incident.get("priority", "UNKNOWN")
        incident["priority"] = new_priority
        incident["updated_at"] = datetime.now().isoformat()

        self._add_event("incident", incident_id,
                        f"Priority changed: {old_priority} → {new_priority}", "warn")
        return incident

    def assign_unit(self, incident_id: int, unit_id: int) -> Dict[str, Any]:
        """Assign a unit to an incident."""
        if incident_id not in self.incidents or unit_id not in self.units:
            return None

        incident = self.incidents[incident_id]
        unit = self.units[unit_id]

        if incident.get("field_id"):
            unit["field_id"] = incident.get("field_id")

        if unit_id not in incident["assigned_unit_ids"]:
            incident["assigned_unit_ids"].append(unit_id)
            incident["updated_at"] = datetime.now().isoformat()

            self._add_event("incident", incident_id,
                            f"Unit {unit['name']} assigned", "info")
            self._add_event("unit", unit_id,
                            f"Assigned to incident {incident_id}", "info")

        return incident

    def assign_unit_to_field(self, unit_id: int, field_id: str) -> Dict[str, Any]:
        """Assign a unit to a field command."""
        if unit_id not in self.units:
            return None
        field = self._get_field(field_id)
        if not field:
            return None

        unit = self.units[unit_id]
        unit["field_id"] = field_id
        unit["last_update"] = datetime.now().isoformat()
        self._add_event("unit", unit_id, f"Assigned to field {field_id}", "info")
        return unit

    def add_incident_note(self, incident_id: int, note: str) -> Dict[str, Any]:
        """Add a note to an incident."""
        if incident_id not in self.incidents:
            return None

        incident = self.incidents[incident_id]
        self._add_event("incident", incident_id, f"Note added: {note}", "info")
        return incident

    def simulate_update(self) -> Dict[str, Any]:
        """Simulate a random update event."""
        action = random.choice(
            ["new_incident", "update_status", "update_priority", "assign_unit", "move_unit"])

        if action == "new_incident":
            incident = self._generate_incident()
            self.incidents[incident["id"]] = incident
            self._add_event(
                "incident", incident["id"], f"New incident: {incident['title']}", "warn")
            return {"type": "incident_created", "data": incident}

        elif action == "update_status":
            incident = random.choice(list(self.incidents.values()))
            statuses = ["OPEN", "IN_PROGRESS", "CLOSED"]
            new_status = random.choice(
                [s for s in statuses if s != incident["status"]])
            self.update_incident_status(incident["id"], new_status)
            return {"type": "incident_updated", "data": self.incidents[incident["id"]]}

        elif action == "update_priority":
            incident = random.choice(list(self.incidents.values()))
            priorities = ["LOW", "MED", "HIGH"]
            old_priority = incident.get("priority", "MED")
            new_priority = random.choice(
                [p for p in priorities if p != old_priority])
            self.update_incident_priority(incident["id"], new_priority)
            return {"type": "incident_updated", "data": self.incidents[incident["id"]]}

        elif action == "assign_unit":
            incident = random.choice(list(self.incidents.values()))
            unit = random.choice(list(self.units.values()))
            self.assign_unit(incident["id"], unit["id"])
            return {"type": "incident_updated", "data": self.incidents[incident["id"]]}

        elif action == "move_unit":
            unit = random.choice(list(self.units.values()))
            unit["location_lat"] += random.uniform(-0.002, 0.002)
            unit["location_lng"] += random.uniform(-0.002, 0.002)
            unit["last_update"] = datetime.now().isoformat()
            self._add_event("unit", unit["id"], f"Location updated", "info")
            return {"type": "unit_updated", "data": unit}

        return None


# Global instance
_mock_service = None


def get_mock_service(seed: int = None) -> MockDataService:
    """Get or create mock data service."""
    global _mock_service
    if _mock_service is None:
        seed_env = os.environ.get("DEMO_SEED", "0")
        try:
            seed = seed or (int(seed_env) if seed_env.strip() else None)
        except (ValueError, AttributeError):
            seed = None
        _mock_service = MockDataService(seed=seed)
    return _mock_service
