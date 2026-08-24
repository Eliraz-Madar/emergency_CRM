from django.utils import timezone
from rest_framework import serializers
from .models import (
    Incident, Task, Unit, IncidentEvent, ReportMedia,
    FieldCommand, FieldCommandNote,
    MajorIncident, Sector, TaskGroup, Perimeter,
)
from .permissions import effective_role


class TaskSerializer(serializers.ModelSerializer):
    incident_title    = serializers.CharField(source="incident.title",        read_only=True)
    incident_lat      = serializers.FloatField(source="incident.location_lat", read_only=True)
    incident_lng      = serializers.FloatField(source="incident.location_lng", read_only=True)
    incident_priority = serializers.CharField(source="incident.priority",      read_only=True)
    incident_status   = serializers.CharField(source="incident.status",        read_only=True)

    class Meta:
        model = Task
        fields = [
            "id", "incident", "incident_title",
            "incident_lat", "incident_lng", "incident_priority", "incident_status",
            "assigned_unit", "mock_unit_id", "title", "status", "timestamp",
        ]

    def validate_status(self, value):
        instance = self.instance
        if instance is None or value == instance.status:
            return value
        request = self.context.get("request")
        role = effective_role(request) if request else ""
        allowed, error = instance.can_transition_to(value, role)
        if not allowed:
            raise serializers.ValidationError(error)
        return value


class IncidentSerializer(serializers.ModelSerializer):
    tasks = TaskSerializer(many=True, read_only=True)
    assigned_unit_ids = serializers.SerializerMethodField()
    field_command_name = serializers.CharField(
        source="field_command.name", read_only=True, default=None)

    # Public name for the closure-role input/output, remapped onto the
    # model's `closed_by` column (kept short since it's Incident-only).
    closed_by_role = serializers.ChoiceField(
        choices=Incident.ClosedBy.choices, source="closed_by",
        required=False,
    )

    # Lets the regional dashboard know an Incident has gone live straight
    # from the normal incident list/detail fetch, without depending on any
    # client-side store to carry that state. None if it hasn't gone live.
    major_incident = serializers.SerializerMethodField()

    class Meta:
        model = Incident
        fields = [
            "id",
            "title",
            "description",
            "location_lat",
            "location_lng",
            "priority",
            "status",
            "channel",
            "field_command",
            "field_command_name",
            "created_at",
            "tasks",
            "assigned_unit_ids",
            "closed_reason",
            "closed_by_role",
            "closed_by_name",
            "closed_at",
            "major_incident",
        ]
        read_only_fields = ["field_command", "closed_at"]

    def get_assigned_unit_ids(self, obj):
        return sorted({
            t.assigned_unit_id for t in obj.tasks.all() if t.assigned_unit_id
        })

    def get_major_incident(self, obj):
        if not hasattr(obj, "major_incident"):
            return None
        return {"id": obj.major_incident.id, "status": obj.major_incident.status}

    def validate_status(self, value):
        instance = self.instance
        if instance is None:
            # Incident creation -> OPEN, always. Ignore/override anything the client sent.
            return Incident.Status.OPEN
        if value == instance.status:
            return value
        request = self.context.get("request")
        role = effective_role(request) if request else ""
        allowed, error = instance.can_transition_to(value, role)
        if not allowed:
            raise serializers.ValidationError(error)
        return value

    def validate(self, attrs):
        instance = self.instance
        is_closing = (
            instance is not None
            and attrs.get("status") == Incident.Status.CLOSED
            and instance.status != Incident.Status.CLOSED
        )
        if is_closing:
            reason = (attrs.get("closed_reason") or "").strip()
            if not reason:
                raise serializers.ValidationError(
                    {"closed_reason": "A closure reason is required to close an incident."})
            attrs["closed_reason"] = reason
            closed_by_role = attrs.get("closed_by")
            if not closed_by_role:
                raise serializers.ValidationError(
                    {"closed_by_role": "closed_by_role ('UNIT' or 'COMMAND_CENTER') is required to close an incident."})
            request = self.context.get("request")
            role = effective_role(request) if request else ""
            expected = (
                Incident.ClosedBy.COMMAND_CENTER
                if role in Incident.COMMANDER_ROLES
                else Incident.ClosedBy.UNIT
            )
            if closed_by_role != expected:
                raise serializers.ValidationError(
                    {"closed_by_role": f"Does not match the acting role for this request ('{expected}')."})
        return attrs

    def update(self, instance, validated_data):
        is_closing = (
            validated_data.get("status") == Incident.Status.CLOSED
            and instance.status != Incident.Status.CLOSED
        )
        instance = super().update(instance, validated_data)
        if is_closing:
            instance.closed_at = timezone.now()
            instance.save(update_fields=["closed_at"])
        return instance


class UnitSerializer(serializers.ModelSerializer):
    # Staleness-aware: True only if explicitly claimed/heartbeating AND the
    # last heartbeat is recent (Unit.HEARTBEAT_STALE_AFTER). This lets a unit
    # that stopped sending heartbeats stop appearing "online" to clients
    # without any background job writing to the DB — see
    # final changes/05_user_unit_claiming_and_live_sync.md.
    is_online = serializers.SerializerMethodField()
    assigned_username = serializers.SerializerMethodField()
    field_id = serializers.CharField(
        source="field_command.field_key", read_only=True, default=None)

    class Meta:
        model = Unit
        fields = [
            "id",
            "name",
            "type",
            "location_lat",
            "location_lng",
            "availability_status",
            "is_online",
            "last_seen",
            "assigned_username",
            "field_id",
        ]

    def get_is_online(self, obj):
        return obj.is_actively_online

    def get_assigned_username(self, obj):
        user = getattr(obj, "app_user", None)
        return user.username if user else None


class ReportMediaSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = ReportMedia
        fields = ["id", "file_url", "media_type", "uploaded_at"]

    def get_file_url(self, obj):
        request = self.context.get("request")
        if request:
            return request.build_absolute_uri(obj.file.url)
        return obj.file.url


class IncidentEventSerializer(serializers.ModelSerializer):
    media = ReportMediaSerializer(many=True, read_only=True)

    class Meta:
        model = IncidentEvent
        fields = [
            "id",
            "incident",
            "major_incident",
            "event_type",
            "severity",
            "title",
            "description",
            "source",
            "created_by",
            "actor_id",
            "created_at",
            "media",
        ]
        read_only_fields = ["id", "created_at"]


class FieldCommandNoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = FieldCommandNote
        fields = ["id", "message", "created_at"]
        read_only_fields = ["id", "created_at"]


class FieldCommandIncidentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Incident
        fields = ["id", "title", "status", "priority"]


class FieldCommandUnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = Unit
        fields = ["id", "name", "type"]


class FieldCommandSerializer(serializers.ModelSerializer):
    # Public identifier stays the string field_key (e.g. "field-1"), matching
    # every existing frontend consumer (localStorage fieldId, marker popups,
    # the cosmetic name lookup in FieldIncidentDashboard.jsx) — never the
    # internal numeric pk.
    id = serializers.CharField(source="field_key", read_only=True)
    operational_notes = serializers.SerializerMethodField()
    incidents = FieldCommandIncidentSerializer(many=True, read_only=True)
    units = FieldCommandUnitSerializer(many=True, read_only=True)
    incidents_count = serializers.SerializerMethodField()
    units_count = serializers.SerializerMethodField()
    # Write-only: append an operational note in the same create/update request
    # (mirrors mock's initial_report/notes/operational_note handling).
    note = serializers.CharField(write_only=True, required=False, allow_blank=True)
    # Write side: accepts the declared MajorIncident's id when this post is
    # established via "Go Live" (optional — the direct creation flow, no
    # escalation, sends nothing and this stays null). Read side: a nested
    # {id, status} shape, same precedent as IncidentSerializer.get_major_incident,
    # so FieldIncidentDashboard.jsx can check "is this post escalated" without
    # a second request.
    major_incident_id = serializers.PrimaryKeyRelatedField(
        source="major_incident", queryset=MajorIncident.objects.all(),
        write_only=True, required=False, allow_null=True,
    )
    major_incident = serializers.SerializerMethodField()

    class Meta:
        model = FieldCommand
        fields = [
            "id",
            "name",
            "location_lat",
            "location_lng",
            "status",
            "incident_phase",
            "casualty_count",
            "evacuated_count",
            "unit_name",
            "incident_type",
            "operational_notes",
            "incidents",
            "units",
            "incidents_count",
            "units_count",
            "note",
            "major_incident_id",
            "major_incident",
            "closed_reason",
            "closed_by_role",
            "closed_by_name",
            "closed_at",
        ]
        read_only_fields = ["closed_at"]

    def get_operational_notes(self, obj):
        return [
            {"timestamp": note.created_at.isoformat(), "message": note.message}
            for note in obj.notes.all()
        ]

    def get_major_incident(self, obj):
        # Forward FK (unlike Incident.major_incident, which is the reverse
        # side of a OneToOneField and needs hasattr() to avoid
        # RelatedObjectDoesNotExist) — a plain None check is correct and
        # sufficient here.
        if obj.major_incident_id is None:
            return None
        mi = obj.major_incident
        # Fuller shape than a bare {id, status} — there is no standalone
        # GET-by-id endpoint for MajorIncident (only go-live's create
        # response, and the sectors/task-groups/perimeter sub-resource
        # endpoints, neither of which return the MajorIncident itself), so
        # FieldIncidentDashboard.jsx needs this nested shape to populate
        # Situation Overview for a FieldCommand it loads independently of
        # the regional dashboard's go-live flow.
        return {
            "id": mi.id,
            "status": mi.status,
            "title": mi.title,
            "incident_type": mi.incident_type,
            "estimated_casualties": mi.estimated_casualties,
            "confirmed_deaths": mi.confirmed_deaths,
            "displaced_persons": mi.displaced_persons,
            "radius_meters": mi.radius_meters,
        }

    def get_incidents_count(self, obj):
        return obj.incidents.count()

    def get_units_count(self, obj):
        return obj.units.count()

    def validate(self, attrs):
        instance = self.instance
        if instance is None:
            if attrs.get("location_lat") is None or attrs.get("location_lng") is None:
                raise serializers.ValidationError(
                    "location_lat and location_lng are required to create a field command.")
        is_closing = (
            instance is not None
            and attrs.get("status") == FieldCommand.Status.CLOSED
            and instance.status != FieldCommand.Status.CLOSED
        )
        if is_closing:
            reason = (attrs.get("closed_reason") or "").strip()
            if not reason:
                raise serializers.ValidationError(
                    {"closed_reason": "A closure reason is required to close a field command."})
            attrs["closed_reason"] = reason
            if not attrs.get("closed_by_role"):
                raise serializers.ValidationError(
                    {"closed_by_role": "closed_by_role ('FIELD_OPERATOR' or 'COMMAND_CENTER') is required to close a field command."})
        return attrs

    def create(self, validated_data):
        note = validated_data.pop("note", None)
        instance = super().create(validated_data)
        if note and note.strip():
            FieldCommandNote.objects.create(field_command=instance, message=note.strip())
        return instance

    def update(self, instance, validated_data):
        note = validated_data.pop("note", None)
        is_closing = (
            validated_data.get("status") == FieldCommand.Status.CLOSED
            and instance.status != FieldCommand.Status.CLOSED
        )
        instance = super().update(instance, validated_data)
        if note and note.strip():
            FieldCommandNote.objects.create(field_command=instance, message=note.strip())
        if is_closing:
            instance.closed_at = timezone.now()
            instance.save(update_fields=["closed_at"])
            # Release resources tied to this post, mirroring
            # MockDataService.close_field_command.
            Unit.objects.filter(field_command=instance).update(field_command=None)
            Incident.objects.filter(field_command=instance).update(field_command=None)
        return instance


# ============================================
# REAL MAJOR INCIDENT / SECTOR / TASK GROUP / PERIMETER
# ============================================
# Backs the real "go live" flow (api/views.py's major_incident_* endpoints).
# NOT the mock field-incident dashboard (simulated/field_incident_data.py,
# api/views.py's field_incident_* endpoints) — that stays untouched.

class MajorIncidentSerializer(serializers.ModelSerializer):
    class Meta:
        model = MajorIncident
        fields = [
            "id",
            "incident",
            "title",
            "incident_type",
            "description",
            "status",
            "location_lat",
            "location_lng",
            "radius_meters",
            "estimated_casualties",
            "confirmed_deaths",
            "displaced_persons",
            "command_post_lat",
            "command_post_lng",
            "created_at",
            "declared_at",
            "updated_at",
        ]
        read_only_fields = fields


class MajorIncidentGoLiveSerializer(serializers.Serializer):
    """
    Input-only serializer for POST /api/major-incidents/go-live/. Everything
    but incident_type is copied from the source Incident server-side (see
    Incident model at api/models.py:27) rather than accepted from the client
    — Incident has no equivalent "type" field, so incident_type is the one
    piece of new information this call actually needs.
    """
    incident_id = serializers.IntegerField()
    incident_type = serializers.ChoiceField(choices=MajorIncident.IncidentType.choices)

    def validate_incident_id(self, value):
        try:
            incident = Incident.objects.get(pk=value)
        except Incident.DoesNotExist:
            raise serializers.ValidationError("Incident not found.")
        if hasattr(incident, "major_incident"):
            raise serializers.ValidationError(
                f"Incident {incident.id} has already gone live as "
                f"MajorIncident {incident.major_incident.id}."
            )
        self._incident = incident
        return value

    def validate(self, attrs):
        request = self.context.get("request")
        role = effective_role(request) if request else ""
        if role not in Incident.COMMANDER_ROLES:
            raise serializers.ValidationError(
                {"detail": "Only COMMAND_CENTER (dispatcher/admin) can declare a major incident."})
        return attrs

    def create(self, validated_data):
        incident = self._incident
        return MajorIncident.objects.create(
            incident=incident,
            title=incident.title,
            incident_type=validated_data["incident_type"],
            description=incident.description,
            status=MajorIncident.Status.DECLARED,
            location_lat=incident.location_lat,
            location_lng=incident.location_lng,
            declared_at=timezone.now(),
        )


class PerimeterSerializer(serializers.ModelSerializer):
    class Meta:
        model = Perimeter
        fields = ["id", "major_incident", "points", "submitted_by_role", "created_at"]
        read_only_fields = ["id", "major_incident", "created_at"]

    def validate_points(self, value):
        if not isinstance(value, list) or len(value) < 3:
            raise serializers.ValidationError(
                "points must be a list of at least 3 {lat, lng} objects.")
        for point in value:
            if not isinstance(point, dict) or "lat" not in point or "lng" not in point:
                raise serializers.ValidationError(
                    "Each point must be an object with 'lat' and 'lng' keys.")
        return value

    def validate(self, attrs):
        # Strictly FIELD_OPERATOR-only for this endpoint (not COMMAND_CENTER,
        # even though the model's SubmittedByRole choices still allow it —
        # this is an endpoint-level restriction, not a schema change).
        request = self.context.get("request")
        role = effective_role(request) if request else ""
        declared = attrs.get("submitted_by_role")
        if not declared:
            raise serializers.ValidationError(
                {"submitted_by_role": "submitted_by_role ('FIELD_OPERATOR') is required."})
        if role != "fieldunit" or declared != Perimeter.SubmittedByRole.FIELD_OPERATOR:
            raise serializers.ValidationError(
                {"submitted_by_role": "Only a field operator (FIELD_OPERATOR) may submit a perimeter."})
        return attrs


class SectorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Sector
        fields = [
            "id",
            "major_incident",
            "name",
            "location_lat",
            "location_lng",
            "hazard_level",
            "status",
            "hazard_description",
            "estimated_survivors",
            "access_status",
            "primary_responder",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "major_incident", "created_at", "updated_at"]

    def validate(self, attrs):
        request = self.context.get("request")
        role = effective_role(request) if request else ""
        if role not in Incident.COMMANDER_ROLES:
            raise serializers.ValidationError(
                {"detail": "Only COMMAND_CENTER (dispatcher/admin) can create a sector."})
        return attrs


class TaskGroupSerializer(serializers.ModelSerializer):
    # Accepts existing Sector ids to link via the M2M on create; read side
    # exposes the linked sectors as plain ids (matches this codebase's other
    # M2M-adjacent fields, e.g. IncidentSerializer.assigned_unit_ids).
    sector_ids = serializers.PrimaryKeyRelatedField(
        source="sectors", queryset=Sector.objects.all(), many=True,
        required=False, write_only=True,
    )
    sectors = serializers.PrimaryKeyRelatedField(many=True, read_only=True)

    class Meta:
        model = TaskGroup
        fields = [
            "id",
            "major_incident",
            "sectors",
            "sector_ids",
            "title",
            "category",
            "description",
            "status",
            "priority",
            "progress_percent",
            "assigned_units_count",
            "completed_subtasks",
            "total_subtasks",
            "commander_name",
            "notes",
            "created_at",
            "started_at",
            "completed_at",
            "updated_at",
        ]
        read_only_fields = ["id", "major_incident", "sectors", "created_at", "updated_at"]

    def validate_sector_ids(self, value):
        # Guard against linking a Sector that belongs to a different
        # MajorIncident than the one this TaskGroup is being created under —
        # not explicitly requested, but the M2M would otherwise silently
        # allow cross-incident links with no error. Flagged here rather than
        # added silently.
        major_incident = self.context.get("major_incident")
        if major_incident is not None:
            mismatched = [s.id for s in value if s.major_incident_id != major_incident.id]
            if mismatched:
                raise serializers.ValidationError(
                    f"Sectors {mismatched} do not belong to this MajorIncident.")
        return value
