from datetime import timedelta
from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone


class User(AbstractUser):
    class Roles(models.TextChoices):
        ADMIN = "admin", "Admin"
        DISPATCHER = "dispatcher", "Dispatcher"
        FIELD = "fieldunit", "Field Unit"

    role = models.CharField(
        max_length=32, choices=Roles.choices, default=Roles.DISPATCHER)

    unit = models.OneToOneField(
        "Unit", null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="app_user",
    )

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
        PENDING = "PENDING", "Pending"
        EN_ROUTE = "EN_ROUTE", "En Route"
        ON_SCENE = "ON_SCENE", "On Scene"
        # Legacy value predating the explicit pipeline below. Kept so existing
        # rows and the mobile-dispatch bridge (api/views.py::mobile_dispatch,
        # which writes this status directly and is intentionally NOT routed
        # through the guarded state machine) keep working. New incidents are
        # never created in this state.
        IN_PROGRESS = "IN_PROGRESS", "In Progress"
        RESOLVED = "RESOLVED", "Resolved"
        CLOSED = "CLOSED", "Closed"

    # "Commander" = dispatcher/admin acting from the war-room / command dashboard.
    COMMANDER_ROLES = frozenset({"admin", "dispatcher"})
    # Field personnel acting from the mobile app.
    FIELD_ROLES = frozenset({"fieldunit"})

    # Explicit forward-only state machine: {current_status: {next_status: {roles allowed to perform it}}}.
    # Anything not listed here is an invalid transition and is rejected with a 400.
    TRANSITIONS = {
        Status.OPEN: {
            Status.PENDING: COMMANDER_ROLES,       # Dispatch/Assignment
        },
        Status.PENDING: {
            Status.EN_ROUTE: FIELD_ROLES,          # Mobile user accepts
            Status.RESOLVED: COMMANDER_ROLES,      # Commander resolves (override)
        },
        Status.EN_ROUTE: {
            Status.ON_SCENE: FIELD_ROLES,          # Mobile user arrives
            Status.RESOLVED: COMMANDER_ROLES,      # Commander resolves (override)
        },
        Status.ON_SCENE: {
            # Mobile user completes (gated below on all tasks being done) or Commander resolves.
            Status.RESOLVED: FIELD_ROLES | COMMANDER_ROLES,
        },
        Status.IN_PROGRESS: {
            # Migration path for incidents created by the legacy/mobile-dispatch bridge.
            Status.EN_ROUTE: FIELD_ROLES,
            Status.ON_SCENE: FIELD_ROLES,
            Status.RESOLVED: FIELD_ROLES | COMMANDER_ROLES,
        },
        Status.RESOLVED: {
            Status.CLOSED: COMMANDER_ROLES,        # Commander closes — the ONLY way to reach CLOSED
        },
        Status.CLOSED: {},
    }

    class ClosedBy(models.TextChoices):
        UNIT = "UNIT", "Unit"
        COMMAND_CENTER = "COMMAND_CENTER", "Command Center"

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    location_lat = models.FloatField()
    location_lng = models.FloatField()
    mock_incident_id = models.IntegerField(null=True, blank=True, unique=True)
    priority = models.CharField(
        max_length=10, choices=Priority.choices, default=Priority.LOW)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.OPEN)
    # Dispatch channel/agency this incident is routed through (Police/Fire/EMS/Civil
    # Defense). Purely informational — used for dashboard filtering/badges.
    channel = models.CharField(max_length=50, blank=True, default="")
    field_command = models.ForeignKey(
        "FieldCommand", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="incidents",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    # Closure trail — required whenever status transitions to CLOSED (see
    # can_transition_to / IncidentSerializer). No user FK: no login system is
    # enforced for the dashboard, so who closed it is a role + optional free
    # text name, not an authenticated identity.
    closed_reason = models.TextField(null=True, blank=True)
    closed_by = models.CharField(
        max_length=20, choices=ClosedBy.choices, null=True, blank=True)
    closed_by_name = models.CharField(max_length=150, blank=True, default="")
    closed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.title} ({self.status})"

    def all_tasks_completed(self):
        """True if every Task assigned to this incident is DONE or CANCELLED (vacuously true with no tasks)."""
        return not self.tasks.exclude(
            status__in=[Task.Status.DONE, Task.Status.CANCELLED]
        ).exists()

    def can_transition_to(self, target_status, role):
        """
        Validate a proposed status change against the explicit state machine.
        Returns (True, None) if allowed, or (False, "reason") if rejected.
        """
        if target_status not in self.Status.values:
            return False, f"'{target_status}' is not a valid incident status."
        if target_status == self.status:
            return True, None

        # Incidents must NEVER be marked CLOSED except by an explicit Commander
        # action — but that action is allowed directly from any open status
        # (e.g. closing after a phone call, without ever dispatching), never
        # as a side effect of any other request. This intentionally bypasses
        # the generic TRANSITIONS table below, which only knows about
        # RESOLVED -> CLOSED.
        if target_status == self.Status.CLOSED:
            if role not in self.COMMANDER_ROLES:
                return False, "Only a Commander (admin/dispatcher) can close an incident."
            return True, None

        allowed_roles = self.TRANSITIONS.get(self.status, {}).get(target_status)
        if not allowed_roles or role not in allowed_roles:
            return False, (
                f"Cannot transition incident from '{self.status}' to "
                f"'{target_status}' as role '{role or 'anonymous'}'."
            )

        # A field unit "completing" the incident requires every assigned task to
        # be reported done first — this is the "all assigned units report
        # completion" condition. A Commander can still resolve without it (override).
        if target_status == self.Status.RESOLVED and role in self.FIELD_ROLES:
            if not self.all_tasks_completed():
                return False, (
                    "All assigned tasks must be reported complete before a "
                    "field unit can resolve this incident."
                )

        return True, None

    def clean(self):
        super().clean()
        if self.status == self.Status.CLOSED:
            errors = {}
            if not (self.closed_reason or "").strip():
                errors["closed_reason"] = "A closure reason is required to close an incident."
            if self.closed_by not in self.ClosedBy.values:
                errors["closed_by"] = "closed_by ('UNIT' or 'COMMAND_CENTER') is required to close an incident."
            if errors:
                raise ValidationError(errors)

    def save(self, *args, **kwargs):
        # Backstop for every path that isn't the DRF serializer (admin, shell,
        # management commands, a future bulk operation calling .save()) — the
        # serializer's validate() still runs first and produces a clean 400
        # for normal API traffic; this is what actually fires when something
        # bypasses DRF entirely. See IncidentSerializer.validate() for the
        # equivalent (and first-line) check.
        self.full_clean()
        super().save(*args, **kwargs)


class Unit(models.Model):
    class UnitType(models.TextChoices):
        POLICE = "Police", "Police"
        FIRE = "Fire", "Fire"
        EMS = "EMS", "EMS"
        HOMEFRONT = "HomeFront", "Home Front"

    # A unit is only ever "actively online" while a real heartbeat has been
    # seen within this window. Used at read-time (serializer) instead of a
    # background job flipping is_online — this codebase deliberately has no
    # timers mutating state (see final changes/01_disable_simulation_engine.md).
    HEARTBEAT_STALE_AFTER = timedelta(seconds=60)

    name = models.CharField(max_length=200)
    type = models.CharField(max_length=50, choices=UnitType.choices)
    location_lat = models.FloatField()
    location_lng = models.FloatField()
    availability_status = models.CharField(max_length=50, default="AVAILABLE")
    # Last time this unit sent a heartbeat
    last_seen = models.DateTimeField(null=True, blank=True)
    # Explicit flag: set True only by an authenticated user claiming this
    # unit or sending a heartbeat; set False on logout/disconnect. A unit
    # is never online by default — it must be claimed by a real device first.
    is_online = models.BooleanField(default=False)
    field_command = models.ForeignKey(
        "FieldCommand", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="units",
    )

    def __str__(self):
        return f"{self.name} ({self.type})"

    @property
    def is_actively_online(self):
        """True only if explicitly online AND a heartbeat was seen recently."""
        if not self.is_online or not self.last_seen:
            return False
        return timezone.now() - self.last_seen < self.HEARTBEAT_STALE_AFTER


class Task(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        IN_PROGRESS = "IN_PROGRESS", "In Progress"
        DONE = "DONE", "Done"
        CANCELLED = "CANCELLED", "Cancelled"

    TERMINAL_STATUSES = frozenset({Status.DONE, Status.CANCELLED})
    COMMANDER_ROLES = frozenset({"admin", "dispatcher"})

    incident = models.ForeignKey(
        Incident, related_name="tasks", on_delete=models.CASCADE)
    assigned_unit = models.ForeignKey(
        Unit, related_name="tasks", on_delete=models.SET_NULL, null=True, blank=True)
    mock_unit_id = models.IntegerField(null=True, blank=True)
    title = models.CharField(max_length=200)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING)
    timestamp = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.title} ({self.status})"

    def can_transition_to(self, target_status, role):
        """
        Lighter-weight guard than Incident's: field units and dispatchers may
        freely move a task between PENDING/IN_PROGRESS/DONE in any order (the
        mobile report flow can go straight to DONE without an IN_PROGRESS
        checkpoint), but a task can never be edited again once it reaches a
        terminal status, and only a Commander can cancel a task.
        """
        if target_status not in self.Status.values:
            return False, f"'{target_status}' is not a valid task status."
        if target_status == self.status:
            return True, None
        if self.status in self.TERMINAL_STATUSES:
            return False, (
                f"Task is already '{self.status}' and its status can no "
                "longer be changed."
            )
        if target_status == self.Status.CANCELLED and role not in self.COMMANDER_ROLES:
            return False, "Only a dispatcher or admin can cancel a task."
        return True, None


# ============================================
# FIELD COMMAND POST MODELS
# ============================================
# Real, DB-backed "Field Command Post" feature (the right-click "Open Field
# Command Post" menu item on the regional map). NOT to be confused with the
# "Field Incident Command Dashboard" models below, which back the separate,
# intentionally-ephemeral training simulation.

class FieldCommand(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        CLOSED = "CLOSED", "Closed"

    class ClosedByRole(models.TextChoices):
        FIELD_OPERATOR = "FIELD_OPERATOR", "Field Operator"
        COMMAND_CENTER = "COMMAND_CENTER", "Command Center"

    # Public, human-readable identifier (e.g. "field-1", "north"). Kept
    # distinct from the numeric pk so URLs/localStorage values already in use
    # by the field-incident simulation's cosmetic name lookup keep resolving.
    # Null (not "") until auto-assigned in save() so two posts created
    # without an explicit key never collide on the unique constraint.
    field_key = models.CharField(max_length=64, unique=True, null=True, blank=True)
    name = models.CharField(max_length=200)
    location_lat = models.FloatField(null=True, blank=True)
    location_lng = models.FloatField(null=True, blank=True)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.ACTIVE)
    incident_phase = models.CharField(max_length=100, default="Containment")
    casualty_count = models.IntegerField(default=0)
    evacuated_count = models.IntegerField(default=0)
    unit_name = models.CharField(max_length=200, blank=True, default="")
    incident_type = models.CharField(max_length=100, default="General Incident")
    # Optional escalation link: set only when this post was established via
    # "Go Live" from a declared MajorIncident. Most FieldCommand rows are
    # created directly (no escalation) and leave this null — SET_NULL (not
    # CASCADE) so the post survives if the MajorIncident row is ever
    # removed, matching the audit-trail-FK convention used elsewhere
    # (Unit.field_command, Task.assigned_unit).
    major_incident = models.ForeignKey(
        "MajorIncident", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="field_commands",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Closure trail — same rule as Incident: mandatory reason, no user FK.
    closed_reason = models.TextField(null=True, blank=True)
    closed_by_role = models.CharField(
        max_length=20, choices=ClosedByRole.choices, null=True, blank=True)
    closed_by_name = models.CharField(max_length=150, blank=True, default="")
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["major_incident"],
                condition=Q(major_incident__isnull=False, status="ACTIVE"),
                name="unique_active_major_incident_link",
            )
        ]

    def __str__(self):
        return f"{self.name} ({self.status})"

    def clean(self):
        super().clean()
        if self.major_incident_id and self.status == self.Status.ACTIVE:
            duplicates = FieldCommand.objects.filter(
                major_incident_id=self.major_incident_id,
                status=self.Status.ACTIVE,
            ).exclude(pk=self.pk)
            if duplicates.exists():
                raise ValidationError({
                    "major_incident": "This major incident is already linked to an active field command."
                })
        if self.status == self.Status.CLOSED:
            errors = {}
            if not (self.closed_reason or "").strip():
                errors["closed_reason"] = "A closure reason is required to close a field command."
            if self.closed_by_role not in self.ClosedByRole.values:
                errors["closed_by_role"] = "closed_by_role ('FIELD_OPERATOR' or 'COMMAND_CENTER') is required to close a field command."
            if errors:
                raise ValidationError(errors)

    def save(self, *args, **kwargs):
        # Backstop for every path that isn't the DRF serializer — see
        # Incident.save() for the same reasoning. Runs once, before the
        # existing two-step field_key auto-assignment below (which uses
        # super().save() directly so it isn't re-validated redundantly).
        self.full_clean()
        # Auto-assign a stable public key for posts created without one, once
        # the pk is known (mirrors MockDataService._next_field_command_id).
        is_new = self._state.adding
        super().save(*args, **kwargs)
        if is_new and not self.field_key:
            self.field_key = f"field-{self.pk}"
            super().save(update_fields=["field_key"])


class FieldCommandNote(models.Model):
    field_command = models.ForeignKey(
        FieldCommand, related_name="notes", on_delete=models.CASCADE)
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Note on {self.field_command_id}: {self.message[:40]}"


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

    # Link back to the regional-dashboard Incident this was declared from.
    # OneToOne: an Incident can go live at most once. SET_NULL (not CASCADE)
    # so this row survives if the source Incident is ever deleted, matching
    # the SET_NULL convention used elsewhere for audit-trail FKs (see
    # Incident.field_command, Task.assigned_unit). The "go live" view is
    # responsible for rejecting a second attempt on the same Incident
    # (see api/views.py) — this field alone only prevents it at the DB level
    # once both rows exist.
    incident = models.OneToOneField(
        Incident, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="major_incident",
    )

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
    # Nullable: this phase creates sectors as label + hazard_level only, with
    # no map position. Left as FloatField (not removed) so a position can be
    # attached later without another migration touching this pair.
    location_lat = models.FloatField(null=True, blank=True)
    location_lng = models.FloatField(null=True, blank=True)

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


class Perimeter(models.Model):
    """
    Field-submitted danger-zone/perimeter boundary for a MajorIncident.
    No uniqueness constraint — a resubmission is inserted as a new row so
    history is kept; callers wanting the active boundary take the latest by
    created_at (see Meta.ordering).
    """

    # Mirrors FieldCommand.ClosedByRole's two values rather than inventing a
    # new enum — there is no existing single COMMAND_CENTER/FIELD_OPERATOR/
    # UNIT choice set in this codebase to reuse verbatim (Incident.ClosedBy
    # is UNIT/COMMAND_CENTER; FieldCommand.ClosedByRole is FIELD_OPERATOR/
    # COMMAND_CENTER). This picks the FieldCommand pair since a perimeter is
    # always submitted by a field operator or, on their behalf, command
    # center — never a generic "unit".
    class SubmittedByRole(models.TextChoices):
        FIELD_OPERATOR = "FIELD_OPERATOR", "Field Operator"
        COMMAND_CENTER = "COMMAND_CENTER", "Command Center"

    major_incident = models.ForeignKey(
        MajorIncident, related_name="perimeters", on_delete=models.CASCADE)
    points = models.JSONField(
        help_text="Ordered list of {lat, lng} objects tracing the boundary.")
    submitted_by_role = models.CharField(
        max_length=20, choices=SubmittedByRole.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.major_incident.title} perimeter @ {self.created_at:%Y-%m-%d %H:%M}"


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

    # Who logged this event. Same three-way vocabulary as the X-Actor-Role
    # header itself (see ACTOR_ROLE_HEADER in permissions.py) and matches
    # this codebase's existing "UNIT" (not "MOBILE_UNIT") convention from
    # Incident.ClosedBy. Nullable/blank: only field_incident_add_event sets
    # this today (see api/views.py); events logged elsewhere (e.g.
    # _log_status_change for regular Incident transitions) don't populate it.
    class Source(models.TextChoices):
        COMMAND_CENTER = "COMMAND_CENTER", "Command Center"
        FIELD_OPERATOR = "FIELD_OPERATOR", "Field Operator"
        UNIT = "UNIT", "Unit"

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
    source = models.CharField(
        max_length=20, choices=Source.choices, null=True, blank=True)

    # Meta
    created_by = models.CharField(max_length=100, blank=True)
    actor_id = models.IntegerField(
        null=True, blank=True,
        help_text="ID of the authenticated user who performed this action, if any.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.event_type} - {self.title}"


class ReportMedia(models.Model):
    """Optional multimedia attachment (image or video) for an IncidentEvent report."""

    class MediaType(models.TextChoices):
        IMAGE = "image", "Image"
        VIDEO = "video", "Video"

    event = models.ForeignKey(
        IncidentEvent, related_name="media", on_delete=models.CASCADE)
    file = models.FileField(upload_to="report_media/%Y/%m/%d/")
    media_type = models.CharField(max_length=10, choices=MediaType.choices)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.media_type} attachment for event {self.event_id}"


class PushToken(models.Model):
    """Expo push token for a field unit device, keyed by the mock unit ID."""
    mock_unit_id  = models.IntegerField()
    token         = models.CharField(max_length=256, unique=True)
    registered_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"unit {self.mock_unit_id} → {self.token[:30]}…"
