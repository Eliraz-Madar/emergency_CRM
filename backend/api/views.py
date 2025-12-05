from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.decorators import action

from .models import Incident, Task, Unit
from .serializers import IncidentSerializer, TaskSerializer, UnitSerializer
from .permissions import ReadOnlyOrAdminDispatcher, TaskPermission


class IncidentViewSet(viewsets.ModelViewSet):
    queryset = Incident.objects.all().order_by("-created_at")
    serializer_class = IncidentSerializer
    permission_classes = [ReadOnlyOrAdminDispatcher]


class TaskViewSet(viewsets.ModelViewSet):
    queryset = Task.objects.select_related("incident", "assigned_unit").all().order_by("-timestamp")
    serializer_class = TaskSerializer
    permission_classes = [TaskPermission]

    def get_queryset(self):
        incident_id = self.request.query_params.get("incident")
        qs = super().get_queryset()
        if incident_id:
            qs = qs.filter(incident_id=incident_id)
        return qs

    def partial_update(self, request, *args, **kwargs):
        user_role = getattr(request.user, "role", "")
        if user_role == "fieldunit":
            status_value = request.data.get("status")
            if status_value is None:
                return Response({"detail": "Field units can only update status."}, status=status.HTTP_400_BAD_REQUEST)
            kwargs["partial"] = True
            instance = self.get_object()
            serializer = self.get_serializer(instance, data={"status": status_value}, partial=True)
            serializer.is_valid(raise_exception=True)
            self.perform_update(serializer)
            return Response(serializer.data)
        return super().partial_update(request, *args, **kwargs)

    @action(detail=False, methods=["get"], url_path="by-incident/(?P<incident_id>[^/.]+)")
    def by_incident(self, request, incident_id=None):
        tasks = self.get_queryset().filter(incident_id=incident_id)
        serializer = self.get_serializer(tasks, many=True)
        return Response(serializer.data)


class UnitViewSet(viewsets.ModelViewSet):
    queryset = Unit.objects.all()
    serializer_class = UnitSerializer
    permission_classes = [ReadOnlyOrAdminDispatcher]
