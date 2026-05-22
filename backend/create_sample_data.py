import os
import sys
import django

# Force stdout to UTF-8 so checkmark characters don't crash on Windows cp1252 consoles
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

from api.models import Incident, Unit, Task, User

# Create a test user if not exists
user, created = User.objects.get_or_create(
    username='fieldunit1',
    defaults={
        'email': 'field@test.com',
        'role': 'fieldunit',
        'is_active': True
    }
)
if created:
    user.set_password('test123')
    user.save()
    print("✓ Created test user: fieldunit1")

# Create sample incidents
incident1, created = Incident.objects.get_or_create(
    title='Structure Fire - Downtown',
    defaults={
        'description': 'Multi-story building fire',
        'location_lat': 32.0853,
        'location_lng': 34.7818,
        'priority': 'HIGH',
        'status': 'IN_PROGRESS'
    }
)
if created:
    print("✓ Created incident: Structure Fire")

# Create sample units
unit1, created = Unit.objects.get_or_create(
    name='Fire Truck 1',
    defaults={
        'type': 'Fire',
        'location_lat': 32.0860,
        'location_lng': 34.7820,
        'availability_status': 'AVAILABLE'
    }
)
if created:
    print("✓ Created unit: Fire Truck 1")

# Create sample tasks
task1, created = Task.objects.get_or_create(
    title='Evacuate Building',
    incident=incident1,
    assigned_unit=unit1,
    defaults={
        'status': 'PENDING'
    }
)
if created:
    print("✓ Created task: Evacuate Building")

task2, created = Task.objects.get_or_create(
    title='Search for Survivors',
    incident=incident1,
    assigned_unit=unit1,
    defaults={
        'status': 'PENDING'
    }
)
if created:
    print("✓ Created task: Search for Survivors")

task3, created = Task.objects.get_or_create(
    title='Report Status Update',
    incident=incident1,
    assigned_unit=unit1,
    defaults={
        'status': 'IN_PROGRESS'
    }
)
if created:
    print("✓ Created task: Report Status Update")

print("\n✓ Sample data created successfully!")
print(f"Total tasks: {Task.objects.count()}")
