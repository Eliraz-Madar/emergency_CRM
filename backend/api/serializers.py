from django.utils import timezone
from rest_framework import serializers
from .models import (
    Incident, Task, Unit, IncidentEvent, ReportMedia,
    FieldCommand, FieldCommandNote,
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
        ]
        read_only_fields = ["field_command", "closed_at"]

    def get_assigned_unit_ids(self, obj):
        return sorted({
            t.assigned_unit_id for t in obj.tasks.all() if t.assigned_unit_id
        })

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
