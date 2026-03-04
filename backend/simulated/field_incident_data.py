"""
Field Incident Command Dashboard Mock Data Generator

Generates realistic major incident data for large-scale, multi-sector events
(earthquakes, missile strikes, building collapses, etc.).

Simulates:
- Sector hazard assessment updates
- Casualty estimate changes
- Task group progress
- Real-time operational timeline events
"""

import random
from datetime import datetime, timedelta
from faker import Faker


class FieldIncidentDataService:
    """Generates and manages mock data for major incidents with sectors and task groups."""

    INCIDENT_TYPES = {
        "EARTHQUAKE": {
            "title": "Major Earthquake - Tel Aviv Metropolitan Area",
            "description": "7.2 magnitude earthquake struck the Tel Aviv region at 2:45 AM local time.",
            "radius": 8000,
            "casualty_base": 250,
        },
        "MISSILE_STRIKE": {
            "title": "Missile Strike - Tel Aviv Residential Area",
            "description": "Multiple missiles impacted residential and commercial zones in North Tel Aviv.",
            "radius": 3000,
            "casualty_base": 150,
        },
        "BUILDING_COLLAPSE": {
            "title": "Building Collapse - Central Tel Aviv",
            "description": "Multi-story residential building collapsed, trapping residents under rubble.",
            "radius": 2000,
            "casualty_base": 80,
        },
    }

    SECTORS = [
        {"name": "North Zone", "offset": (0.02, 0.01), "hazard": "HIGH"},
        {"name": "East Sector", "offset": (
            0.015, -0.015), "hazard": "CRITICAL"},
        {"name": "South Area", "offset": (-0.015, -0.01), "hazard": "MEDIUM"},
        {"name": "West Perimeter",
            "offset": (-0.01, 0.02), "hazard": "MEDIUM"},
        {"name": "Central Command", "offset": (0, 0), "hazard": "LOW"},
    ]

    TASK_CATEGORIES = [
        "SEARCH_RESCUE",
        "EVACUATION",
        "MEDICAL",
        "UTILITIES",
        "SECURITY",
        "LOGISTICS",
        "DAMAGE_ASSESSMENT",
        "COMMUNICATIONS",
    ]

    TASK_TEMPLATES = {
        "SEARCH_RESCUE": [
            {
                "title": "Primary Search & Rescue Operations",
                "priority": "CRITICAL",
                "subtasks": 15,
            },
            {"title": "Rubble Clearance - North Zone",
                "priority": "HIGH", "subtasks": 8},
            {
                "title": "Secondary Rescue Operations",
                "priority": "HIGH",
                "subtasks": 10,
            },
        ],
        "EVACUATION": [
            {"title": "Mandatory Evacuation - East Sector",
                "priority": "CRITICAL", "subtasks": 12},
            {"title": "Vulnerable Population Transport",
                "priority": "HIGH", "subtasks": 6},
            {"title": "Temporary Shelter Setup",
                "priority": "MEDIUM", "subtasks": 8},
        ],
        "MEDICAL": [
            {"title": "Triage & Emergency Care",
                "priority": "CRITICAL", "subtasks": 20},
            {"title": "Field Hospital Operations",
                "priority": "HIGH", "subtasks": 10},
            {"title": "Medical Supply Distribution",
                "priority": "HIGH", "subtasks": 5},
        ],
        "UTILITIES": [
            {"title": "Gas Leak Detection & Isolation",
                "priority": "CRITICAL", "subtasks": 7},
            {"title": "Power Grid Assessment", "priority": "HIGH", "subtasks": 5},
            {"title": "Water System Restoration",
                "priority": "MEDIUM", "subtasks": 6},
        ],
        "SECURITY": [
            {"title": "Perimeter Security Setup",
                "priority": "HIGH", "subtasks": 8},
            {"title": "Looting Prevention Patrols",
                "priority": "HIGH", "subtasks": 6},
            {"title": "Access Control Points", "priority": "MEDIUM", "subtasks": 4},
        ],
        "LOGISTICS": [
            {"title": "Food & Water Distribution",
                "priority": "HIGH", "subtasks": 8},
            {"title": "Medical Supply Management",
                "priority": "HIGH", "subtasks": 5},
            {"title": "Fuel & Equipment Logistics",
                "priority": "MEDIUM", "subtasks": 6},
        ],
        "DAMAGE_ASSESSMENT": [
            {"title": "Building Safety Assessment",
                "priority": "HIGH", "subtasks": 10},
            {"title": "Infrastructure Damage Survey",
                "priority": "MEDIUM", "subtasks": 8},
            {"title": "Environmental Hazard Mapping",
                "priority": "MEDIUM", "subtasks": 6},
        ],
        "COMMUNICATIONS": [
            {
                "title": "Inter-Agency Radio Network Setup",
                "priority": "HIGH",
                "subtasks": 4,
            },
            {"title": "Public Information Distribution",
                "priority": "HIGH", "subtasks": 5},
            {"title": "Command Post Communications",
                "priority": "HIGH", "subtasks": 3},
        ],
    }

    HAZARD_DESCRIPTIONS = {
        "LOW": "Area is safe. Minor debris. Full access available.",
        "MEDIUM": "Moderate hazards present. Partial access with protective equipment.",
        "HIGH": "Significant structural damage. Limited access. High risk operations.",
        "CRITICAL": "Severe damage. Unstable structures. Restricted entry only.",
    }

    def __init__(self, seed=None):
        """Initialize with optional seed for reproducible data."""
        if seed:
            random.seed(seed)
            Faker.seed(seed)
        self.fake = Faker()

    def generate_major_incident(
        self, incident_type="EARTHQUAKE", location_lat=32.0853, location_lng=34.7818
    ):
        """
        Generate a major incident with all related data.

        Args:
            incident_type: Type of incident (EARTHQUAKE, MISSILE_STRIKE, BUILDING_COLLAPSE)
            location_lat: Latitude of incident center
            location_lng: Longitude of incident center

        Returns:
            Dictionary with major incident data and related sectors/task groups
        """
        incident_template = self.INCIDENT_TYPES[incident_type]

        major_incident = {
            "title": incident_template["title"],
            "incident_type": incident_type,
            "description": incident_template["description"],
            "status": "ACTIVE",
            "location_lat": location_lat,
            "location_lng": location_lng,
            "radius_meters": incident_template["radius"],
            "estimated_casualties": incident_template["casualty_base"] + random.randint(-50, 100),
            "confirmed_deaths": random.randint(5, 30),
            "displaced_persons": random.randint(200, 1000),
            "command_post_lat": location_lat + random.uniform(-0.005, 0.005),
            "command_post_lng": location_lng + random.uniform(-0.005, 0.005),
        }

        # Generate sectors
        sectors = self._generate_sectors(location_lat, location_lng)

        # Generate task groups (3-4 per category with realistic progression)
        task_groups = self._generate_task_groups(sectors)

        # Generate initial events
        events = self._generate_initial_events(incident_type)

        return {
            "major_incident": major_incident,
            "sectors": sectors,
            "task_groups": task_groups,
            "events": events,
        }

    def _generate_sectors(self, center_lat, center_lng):
        """Generate sector data for the incident area."""
        sectors = []
        for sector_template in self.SECTORS:
            lat_offset, lng_offset = sector_template["offset"]
            sectors.append(
                {
                    "name": sector_template["name"],
                    "location_lat": center_lat + lat_offset,
                    "location_lng": center_lng + lng_offset,
                    "hazard_level": sector_template["hazard"],
                    "status": random.choice(["ACTIVE", "CONTAINED"]),
                    "hazard_description": self.HAZARD_DESCRIPTIONS[sector_template["hazard"]],
                    "estimated_survivors": random.randint(50, 300),
                    "access_status": random.choice(
                        ["ACCESSIBLE", "PARTIALLY_ACCESSIBLE", "BLOCKED"]
                    ),
                    "primary_responder": random.choice(
                        ["Fire Department", "Police", "EMS", "Rescue Units"]
                    ),
                }
            )
        return sectors

    def _generate_task_groups(self, sectors):
        """Generate task groups for the incident."""
        task_groups = []
        group_id = 1

        for category in self.TASK_CATEGORIES:
            templates = self.TASK_TEMPLATES.get(category, [])
            for template in templates:
                # Select 1-3 sectors for this task group
                assigned_sectors = random.sample(
                    sectors, k=random.randint(1, 3))

                # Simulate progress based on priority
                priority = template["priority"]
                if priority == "CRITICAL":
                    progress = random.randint(10, 60)
                    status = random.choice(["PLANNED", "IN_PROGRESS"])
                elif priority == "HIGH":
                    progress = random.randint(0, 80)
                    status = random.choice(
                        ["PLANNED", "IN_PROGRESS", "PAUSED"])
                else:
                    progress = random.randint(0, 40)
                    status = random.choice(["PLANNED", "IN_PROGRESS"])

                completed_subtasks = int(
                    (template["subtasks"] * progress) / 100)

                task_groups.append(
                    {
                        "title": template["title"],
                        "category": category,
                        "description": f"Active {category.replace('_', ' ').lower()} operations",
                        "status": status,
                        "priority": template["priority"],
                        "progress_percent": progress,
                        "assigned_units_count": random.randint(3, 15),
                        "completed_subtasks": completed_subtasks,
                        "total_subtasks": template["subtasks"],
                        "commander_name": self.fake.name(),
                        "notes": random.choice(
                            [
                                "On track for completion",
                                "Awaiting additional resources",
                                "Encountering unexpected hazards",
                                "Making good progress",
                                "Requires immediate attention",
                            ]
                        ),
                        "sector_ids": [s["name"] for s in assigned_sectors],
                    }
                )
                group_id += 1

        return task_groups

    def _generate_initial_events(self, incident_type):
        """Generate initial timeline events for the incident."""
        now = datetime.now()
        events = [
            {
                "event_type": "STATUS_CHANGE",
                "severity": "CRITICAL",
                "title": "Incident Declared",
                "description": f"{incident_type.replace('_', ' ')} declared as major incident",
                "created_by": "Command Center",
                "created_at": now - timedelta(minutes=120),
            },
            {
                "event_type": "HAZARD_ALERT",
                "severity": "CRITICAL",
                "title": "Secondary Hazards Identified",
                "description": "Structural damage and utility hazards confirmed across multiple sectors",
                "created_by": "Damage Assessment Team",
                "created_at": now - timedelta(minutes=90),
            },
            {
                "event_type": "RESOURCE_ARRIVAL",
                "severity": "INFO",
                "title": "Rescue Teams Deployed",
                "description": "First wave of search and rescue units arrived on scene",
                "created_by": "Operations",
                "created_at": now - timedelta(minutes=60),
            },
            {
                "event_type": "CASUALTY_UPDATE",
                "severity": "WARNING",
                "title": "Casualty Estimates Revised",
                "description": "Initial assessment: 250+ casualties, 30+ confirmed deaths",
                "created_by": "Medical Command",
                "created_at": now - timedelta(minutes=45),
            },
            {
                "event_type": "EVACUATION",
                "severity": "WARNING",
                "title": "Evacuation Zones Established",
                "description": "1000+ persons evacuated from unsafe areas",
                "created_by": "Evacuation Coordinator",
                "created_at": now - timedelta(minutes=30),
            },
        ]
        return events

    def simulate_update(self, incident_data):
        """
        Simulate real-time updates to a major incident.
        Returns incremental changes that would occur naturally.

        Args:
            incident_data: Current major incident data structure

        Returns:
            Dictionary with updated fields
        """
        update = {}

        # 40% chance to update casualty estimates
        if random.random() < 0.4:
            old_casualties = incident_data["major_incident"]["estimated_casualties"]
            new_casualties = old_casualties + random.randint(-20, 30)
            update["estimated_casualties"] = max(0, new_casualties)

        # 30% chance to update sector hazard levels
        if random.random() < 0.3 and incident_data["sectors"]:
            sector_idx = random.randint(0, len(incident_data["sectors"]) - 1)
            new_hazard = random.choice(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
            if "sector_updates" not in update:
                update["sector_updates"] = {}
            update["sector_updates"][sector_idx] = {
                "hazard_level": new_hazard,
                "hazard_description": self.HAZARD_DESCRIPTIONS[new_hazard],
            }

        # 35% chance to update task group progress
        if random.random() < 0.35 and incident_data["task_groups"]:
            task_idx = random.randint(0, len(incident_data["task_groups"]) - 1)
            task = incident_data["task_groups"][task_idx]
            if task["status"] == "IN_PROGRESS":
                new_progress = min(
                    100, task["progress_percent"] + random.randint(5, 15))
                new_completed = int(
                    (task["total_subtasks"] * new_progress) / 100)
                if "task_updates" not in update:
                    update["task_updates"] = {}
                update["task_updates"][task_idx] = {
                    "progress_percent": new_progress,
                    "completed_subtasks": new_completed,
                    "status": "COMPLETED" if new_progress >= 100 else "IN_PROGRESS",
                }

        # 40% chance to generate a new event
        if random.random() < 0.40:
            event = self._generate_random_event()
            if "new_event" not in update:
                update["new_event"] = event

        return update if update else {"status": "no_change"}

    def _generate_random_event(self):
        """Generate a random operational event."""
        event_templates = [
            {
                "event_type": "CASUALTY_UPDATE",
                "severity": "WARNING",
                "title": "Updated Casualty Count",
                "description": f"Current count: {random.randint(100, 400)} casualties",
            },
            {
                "event_type": "HAZARD_ALERT",
                "severity": "WARNING",
                "title": "Gas Leak Detected",
                "description": "Natural gas leak detected in East Sector. Evacuation in progress.",
            },
            {
                "event_type": "RESOURCE_ARRIVAL",
                "severity": "INFO",
                "title": "Additional Teams Arrived",
                "description": f"{random.randint(2, 8)} response teams arrived with equipment",
            },
            {
                "event_type": "UPDATE",
                "severity": "INFO",
                "title": "Sector Status Updated",
                "description": random.choice(
                    [
                        "Building assessed - safe for operations",
                        "Structural damage more extensive than initial estimate",
                        "Survivors located - rescue underway",
                        "Area temporarily cleared of hazards",
                    ]
                ),
            },
            {
                "event_type": "COMMUNICATION",
                "severity": "INFO",
                "title": "Inter-Agency Coordination Meeting",
                "description": "Command level meeting conducted. Resource distribution optimized.",
            },
        ]

        template = random.choice(event_templates)
        return {
            **template,
            "created_by": random.choice(
                ["Command Center", "Field Operations",
                    "Medical Team", "Safety Officer"]
            ),
            "created_at": datetime.now().isoformat(),
        }


def get_field_incident_service(seed=None):
    """Factory function to get field incident data service."""
    return FieldIncidentDataService(seed=seed)
