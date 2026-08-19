from rest_framework import serializers
from .models import Incident, Task, Unit, IncidentEvent, ReportMedia


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
        role = getattr(getattr(request, "user", None), "role", "")
        allowed, error = instance.can_transition_to(value, role)
        if not allowed:
            raise serializers.ValidationError(error)
        return value


class IncidentSerializer(serializers.ModelSerializer):
    tasks = TaskSerializer(many=True, read_only=True)

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
            "created_at",
            "tasks",
        ]

    def validate_status(self, value):
        instance = self.instance
        if instance is None:
            # Incident creation -> OPEN, always. Ignore/override anything the client sent.
            return Incident.Status.OPEN
        if value == instance.status:
            return value
        request = self.context.get("request")
        role = getattr(getattr(request, "user", None), "role", "")
        allowed, error = instance.can_transition_to(value, role)
        if not allowed:
            raise serializers.ValidationError(error)
        return value


class UnitSerializer(serializers.ModelSerializer):
    # Staleness-aware: True only if explicitly claimed/heartbeating AND the
    # last heartbeat is recent (Unit.HEARTBEAT_STALE_AFTER). This lets a unit
    # that stopped sending heartbeats stop appearing "online" to clients
    # without any background job writing to the DB — see
    # final changes/05_user_unit_claiming_and_live_sync.md.
    is_online = serializers.SerializerMethodField()
    assigned_username = serializers.SerializerMethodField()

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
