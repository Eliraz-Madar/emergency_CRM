from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Roles(models.TextChoices):
        ADMIN = "admin", "Admin"
        DISPATCHER = "dispatcher", "Dispatcher"
        FIELD = "fieldunit", "Field Unit"

    role = models.CharField(max_length=32, choices=Roles.choices, default=Roles.DISPATCHER)

    def __str__(self):
        return f"{self.username} ({self.role})"


class Incident(models.Model):
    class Severity(models.TextChoices):
        LOW = "LOW", "Low"
        MED = "MED", "Medium"
        HIGH = "HIGH", "High"

    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        IN_PROGRESS = "IN_PROGRESS", "In Progress"
        CLOSED = "CLOSED", "Closed"

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    location_lat = models.FloatField()
    location_lng = models.FloatField()
    severity = models.CharField(max_length=10, choices=Severity.choices, default=Severity.LOW)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
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

    incident = models.ForeignKey(Incident, related_name="tasks", on_delete=models.CASCADE)
    assigned_unit = models.ForeignKey(Unit, related_name="tasks", on_delete=models.SET_NULL, null=True, blank=True)
    title = models.CharField(max_length=200)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    timestamp = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.title} ({self.status})"
