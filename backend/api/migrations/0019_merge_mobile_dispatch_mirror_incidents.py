"""
One-off cleanup: fold every `mobile_dispatch` "mirror" Incident back into the
real Incident it shadowed.

The old mobile-dispatch bridge (api/views.py::mobile_dispatch) always did
`Incident.objects.update_or_create(mock_incident_id=<key>, ...)`. When the key
was a real Incident's pk (which is what the war-room actually sends), no row
had that value in `mock_incident_id`, so it created a SECOND incident with the
same title — the duplicate "Theft" / "POLICE Dispatch" pair seen in the
regional list. The bridge no longer does this; this migration removes the rows
it already left behind.

A mirror is unambiguous: `mock_incident_id` equals an existing Incident's pk.
Its still-open tasks and its events are moved onto the real incident; terminal
or duplicate tasks are dropped; then the mirror row is deleted.
"""
from django.db import migrations

TERMINAL = {"DONE", "CANCELLED"}


def merge_mirrors(apps, schema_editor):
    Incident = apps.get_model("api", "Incident")
    Task = apps.get_model("api", "Task")
    IncidentEvent = apps.get_model("api", "IncidentEvent")

    real_ids = set(Incident.objects.values_list("id", flat=True))
    mirrors = Incident.objects.filter(mock_incident_id__in=real_ids)

    for mirror in mirrors:
        real = Incident.objects.filter(pk=mirror.mock_incident_id).first()
        if real is None or real.id == mirror.id:
            continue

        for task in mirror.tasks.all():
            duplicate = bool(
                task.assigned_unit_id
                and Task.objects.filter(
                    incident=real, assigned_unit_id=task.assigned_unit_id
                ).exclude(status__in=TERMINAL).exists()
            )
            if task.status in TERMINAL or duplicate:
                task.delete()
            else:
                task.incident = real
                task.save(update_fields=["incident"])

        IncidentEvent.objects.filter(incident=mirror).update(incident=real)
        mirror.delete()


def noop_reverse(apps, schema_editor):
    # Merging is not reversible — the mirror rows carried no information the
    # real incident didn't already have.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0018_incidentevent_task"),
    ]

    operations = [
        migrations.RunPython(merge_mirrors, noop_reverse),
    ]
