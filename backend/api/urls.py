from rest_framework.routers import DefaultRouter
from django.urls import path, include

from .views import IncidentViewSet, TaskViewSet, UnitViewSet

router = DefaultRouter()
router.register(r"incidents", IncidentViewSet)
router.register(r"tasks", TaskViewSet)
router.register(r"units", UnitViewSet)

urlpatterns = [
    path("", include(router.urls)),
]
