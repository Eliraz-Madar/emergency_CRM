"""
Safety net for 0024's title-based backfill of FieldCommandNote.incident.

0024 had to guess which incident an old log line was about by matching the
title quoted in its text. When two incidents share a title (e.g. a "Theft"
created yesterday and deleted, then another "Theft" today) an old note could
be attached to the wrong, still-live incident and reappear on its post.

A note can never predate the incident it is about, so any note older than its
linked incident was mis-attached — the real incident is gone. Drop those.

Going forward there is no guessing: every log line is written with the
incident's own id (a real FK), and deleting/closing an incident deletes its
log lines.
"""
from django.db import migrations


def drop_misdated_notes(apps, schema_editor):
    FieldCommandNote = apps.get_model("api", "FieldCommandNote")
    stale = [
        n.id
        for n in FieldCommandNote.objects
        .select_related("incident")
        .filter(incident__isnull=False)
        if n.created_at < n.incident.created_at
    ]
    if stale:
        FieldCommandNote.objects.filter(id__in=stale).delete()


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0025_alter_fieldcommandmission_incident_and_more"),
    ]

    operations = [
        migrations.RunPython(drop_misdated_notes, noop),
    ]
