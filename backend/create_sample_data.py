"""
Sets up the three canonical field-unit users (police / ambulance / fire)
and their matching DB Unit objects.  Run once after migrations:

    python create_sample_data.py
"""
import os
import sys
import django

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
django.setup()

from api.models import Unit, User, Task, Incident

# ── 1. Canonical units ────────────────────────────────────────────────────────
CANONICAL_UNITS = [
    {"name": "Police Unit Alpha",    "type": "Police", "lat": 32.0853, "lng": 34.7818},
    {"name": "Ambulance Unit Alpha", "type": "EMS",    "lat": 32.0860, "lng": 34.7820},
    {"name": "Fire Unit Alpha",      "type": "Fire",   "lat": 32.0870, "lng": 34.7810},
]

units_by_type = {}
for u in CANONICAL_UNITS:
    obj, created = Unit.objects.get_or_create(
        name=u["name"],
        defaults={
            "type":                u["type"],
            "location_lat":        u["lat"],
            "location_lng":        u["lng"],
            "availability_status": "AVAILABLE",
        },
    )
    units_by_type[u["type"]] = obj
    print(f"{'✓ Created' if created else '  Exists'} unit: {obj.name}")

# ── 2. Field-unit users linked to their unit ──────────────────────────────────
FIELD_USERS = [
    {"username": "police",    "password": "Police123",    "unit_type": "Police"},
    {"username": "ambulance", "password": "Ambulance123", "unit_type": "EMS"},
    {"username": "fire",      "password": "Fire123",      "unit_type": "Fire"},
]

for fu in FIELD_USERS:
    unit = units_by_type[fu["unit_type"]]
    user, created = User.objects.get_or_create(
        username=fu["username"],
        defaults={
            "role":      "fieldunit",
            "is_active": True,
            "unit":      unit,
        },
    )
    if created:
        user.set_password(fu["password"])
        user.save()
        print(f"✓ Created user: {fu['username']} / {fu['password']}  →  {unit.name}")
    else:
        # Make sure existing user is linked to the correct unit
        if user.unit_id != unit.id:
            user.unit = unit
            user.save()
            print(f"  Updated unit link for: {fu['username']}  →  {unit.name}")
        else:
            print(f"  Exists user: {fu['username']}")

# ── 3. Keep legacy fieldunit1 for backward compat ────────────────────────────
legacy, created = User.objects.get_or_create(
    username="fieldunit1",
    defaults={"role": "fieldunit", "is_active": True},
)
if created:
    legacy.set_password("test123")
    legacy.save()
    print("✓ Created legacy user: fieldunit1 / test123")

# ── Summary ───────────────────────────────────────────────────────────────────
print("\n── Field Unit Credentials ───────────────────────")
print("  police    / Police123")
print("  ambulance / Ambulance123")
print("  fire      / Fire123")
print("─────────────────────────────────────────────────")
print(f"Units in DB : {Unit.objects.count()}")
print(f"Users in DB : {User.objects.filter(role='fieldunit').count()} field-unit users")
print(f"Tasks in DB : {Task.objects.count()}")
