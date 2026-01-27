from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Roles(models.TextChoices):
        ADMIN = "admin", "Admin"
        DISPATCHER = "dispatcher", "Dispatcher"
        FIELD = "fieldunit", "Field Unit"

    role = models.CharField(
        max_length=32, choices=Roles.choices, default=Roles.DISPATCHER)

    def __str__(self):
        return f"{self.username} ({self.role})"


class Incident(models.Model):
    class Priority(models.TextChoices):
        LOW = "LOW", "Low"
        MED = "MED", "Medium"
        HIGH = "HIGH", "High"
        CRITICAL = "CRITICAL", "Critical"

    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        IN_PROGRESS = "IN_PROGRESS", "In Progress"
        CLOSED = "CLOSED", "Closed"

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    location_lat = models.FloatField()
    location_lng = models.FloatField()
    priority = models.CharField(
        max_length=10, choices=Priority.choices, default=Priority.LOW)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.OPEN)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.title} ({self.status})"


class Unit(models.Model):
    class UnitType(models.TextChoices):
        POLICE = "Police", "Police"
        FIRE = "Fire", "Fire"
        EMS = "EMS", "EMS"
        HOMEFRONT = "HomeFront", "Home Front"

    name = models.CharField(max_length=200)
    type = models.CharField(max_length=50, choices=UnitType.choices)
    location_lat = models.FloatField()
    location_lng = models.FloatField()
    availability_status = models.CharField(max_length=50, default="AVAILABLE")

    def __str__(self):
        return f"{self.name} ({self.type})"


class Task(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        IN_PROGRESS = "IN_PROGRESS", "In Progress"
        DONE = "DONE", "Done"

    incident = models.ForeignKey(
        Incident, related_name="tasks", on_delete=models.CASCADE)
    assigned_unit = models.ForeignKey(
        Unit, related_name="tasks", on_delete=models.SET_NULL, null=True, blank=True)
    title = models.CharField(max_length=200)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING)
    timestamp = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.title} ({self.status})"


# ============================================
# FIELD INCIDENT COMMAND DASHBOARD MODELS
# ============================================

class MajorIncident(models.Model):
    """
    Represents a large-scale, multi-sector incident (earthquake, missile strike, building collapse).
    Requires multi-agency coordination at command level.
    """

    class IncidentType(models.TextChoices):
        EARTHQUAKE = "EARTHQUAKE", "Earthquake"
        MISSILE_STRIKE = "MISSILE_STRIKE", "Missile Strike"
        BUILDING_COLLAPSE = "BUILDING_COLLAPSE", "Building Collapse"
        FLOOD = "FLOOD", "Flood"
        HAZMAT = "HAZMAT", "HAZMAT"
        WILDFIRE = "WILDFIRE", "Wildfire"

    class Status(models.TextChoices):
        DECLARED = "DECLARED", "Declared"
        ACTIVE = "ACTIVE", "Active"
        STABILIZING = "STABILIZING", "Stabilizing"
        RECOVERY = "RECOVERY", "Recovery"

    # Basic info
    title = models.CharField(max_length=300)
    incident_type = models.CharField(
        max_length=50, choices=IncidentType.choices)
    description = models.TextField()
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.ACTIVE)

    # Location
    location_lat = models.FloatField()
    location_lng = models.FloatField()
    radius_meters = models.IntegerField(
        default=5000, help_text="Estimated affected area radius")

    # Situational data
    estimated_casualties = models.IntegerField(default=0)
    confirmed_deaths = models.IntegerField(default=0)
    displaced_persons = models.IntegerField(default=0)

    # Operational context
    command_post_lat = models.FloatField(null=True, blank=True)
    command_post_lng = models.FloatField(null=True, blank=True)

    # Timeline
    created_at = models.DateTimeField(auto_now_add=True)
    declared_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.title} ({self.status})"


class Sector(models.Model):
    """
    Geographical subdivision of a major incident area.
    Each sector has independent hazard assessment and response coordination.
    """

    class HazardLevel(models.TextChoices):
        LOW = "LOW", "Low"
        MEDIUM = "MEDIUM", "Medium"
        HIGH = "HIGH", "High"
        CRITICAL = "CRITICAL", "Critical"

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active Response"
        CONTAINED = "CONTAINED", "Contained"
        CLEARED = "CLEARED", "Cleared"

    major_incident = models.ForeignKey(
        MajorIncident, related_name="sectors", on_delete=models.CASCADE)

    # Identity
    name = models.CharField(max_length=100)  # e.g., "North Zone", "Sector A"
    location_lat = models.FloatField()
    location_lng = models.FloatField()

    # Assessment
    hazard_level = models.CharField(
        max_length=20, choices=HazardLevel.choices, default=HazardLevel.MEDIUM)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.ACTIVE)
    hazard_description = models.CharField(max_length=300, blank=True)

    # Operational data
    estimated_survivors = models.IntegerField(default=0)
    # ACCESSIBLE, PARTIALLY, BLOCKED
    access_status = models.CharField(
        max_length=100, default="PARTIALLY_ACCESSIBLE")
    primary_responder = models.CharField(
        max_length=100, blank=True)  # e.g., "Fire Department"

    # Timeline
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.major_incident.title} - {self.name}"


class TaskGroup(models.Model):
    """
    Organized group of related response tasks/objectives within one or more sectors.
    Represents a command-level operational objective (e.g., "Search and Rescue", "Evacuation").
    """

    class Category(models.TextChoices):
        SEARCH_RESCUE = "SEARCH_RESCUE", "Search & Rescue"
        EVACUATION = "EVACUATION", "Evacuation"
        MEDICAL = "MEDICAL", "Medical Response"
        UTILITIES = "UTILITIES", "Utilities/Infrastructure"
        SECURITY = "SECURITY", "Security & Perimeter"
        LOGISTICS = "LOGISTICS", "Logistics & Supply"
        DAMAGE_ASSESSMENT = "DAMAGE_ASSESSMENT", "Damage Assessment"
        COMMUNICATIONS = "COMMUNICATIONS", "Communications"

    class Priority(models.TextChoices):
        LOW = "LOW", "Low"
        MEDIUM = "MEDIUM", "Medium"
        HIGH = "HIGH", "High"
        CRITICAL = "CRITICAL", "Critical"

    class Status(models.TextChoices):
        PLANNED = "PLANNED", "Planned"
        IN_PROGRESS = "IN_PROGRESS", "In Progress"
        PAUSED = "PAUSED", "Paused"
        COMPLETED = "COMPLETED", "Completed"

    major_incident = models.ForeignKey(
        MajorIncident, related_name="task_groups", on_delete=models.CASCADE)
    sectors = models.ManyToManyField(Sector, related_name="task_groups")

    # Identity
    title = models.CharField(max_length=200)
    category = models.CharField(max_length=50, choices=Category.choices)
    description = models.TextField(blank=True)

    # Status & Priority
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PLANNED)
    priority = models.CharField(
        max_length=20, choices=Priority.choices, default=Priority.MEDIUM)

    # Progress tracking
    progress_percent = models.IntegerField(default=0, help_text="0-100%")
    assigned_units_count = models.IntegerField(default=0)
    completed_subtasks = models.IntegerField(default=0)
    total_subtasks = models.IntegerField(default=0)

    # Command context
    commander_name = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)

    # Timeline
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-priority", "-created_at"]

    def __str__(self):
        return f"{self.major_incident.title} - {self.title}"


class IncidentEvent(models.Model):
    """
    Timestamped event log entry for both regular incidents and major incidents.
    Provides operational timeline and decision trail.
    """

    class EventType(models.TextChoices):
        STATUS_CHANGE = "STATUS_CHANGE", "Status Change"
        ASSIGNMENT = "ASSIGNMENT", "Assignment"
        UPDATE = "UPDATE", "Update"
        HAZARD_ALERT = "HAZARD_ALERT", "Hazard Alert"
        CASUALTY_UPDATE = "CASUALTY_UPDATE", "Casualty Update"
        EVACUATION = "EVACUATION", "Evacuation"
        RESOURCE_ARRIVAL = "RESOURCE_ARRIVAL", "Resource Arrival"
        COMMUNICATION = "COMMUNICATION", "Communication"

    class Severity(models.TextChoices):
        INFO = "INFO", "Informational"
        WARNING = "WARNING", "Warning"
        CRITICAL = "CRITICAL", "Critical"

    # Context
    incident = models.ForeignKey(
        Incident, null=True, blank=True, related_name="events", on_delete=models.CASCADE)
    major_incident = models.ForeignKey(
        MajorIncident, null=True, blank=True, related_name="events", on_delete=models.CASCADE)

    # Event info
    event_type = models.CharField(max_length=50, choices=EventType.choices)
    severity = models.CharField(
        max_length=20, choices=Severity.choices, default=Severity.INFO)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)

    # Meta
    created_by = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.event_type} - {self.title}"
