"""
Backfill FieldCommandNote.incident, then prune the field-command operational
log of everything tied to an incident that is no longer live on the post.

Field command posts had accumulated timeline entries and missions for
incidents that were later closed or deleted — a rescue post kept showing
reports/tasks for events it no longer handles. Going forward the app hides
(and deletes) those; this one-off pass cleans up what is already there.
"""
from django.db import migrations


AUTO_KINDS = {"INCIDENT_LINKED", "FORCE_ASSIGNED", "MISSION", "STATUS"}


def backfill_and_prune(apps, schema_editor):
    FieldCommandNote = apps.get_model("api", "FieldCommandNote")
    FieldCommandMission = apps.get_model("api", "FieldCommandMission")
    Incident = apps.get_model("api", "Incident")

    incidents = list(Incident.objects.all())
    # Longest titles first so "AAA" is tried before "A", etc.
    incidents.sort(key=lambda i: len(i.title or ""), reverse=True)

    # --- 1. Backfill note -> incident by the title quoted in the message ---
    for note in FieldCommandNote.objects.filter(incident__isnull=True):
        msg = note.message or ""
        matches = [
            i for i in incidents
            if i.title and i.title in msg and i.created_at <= note.created_at
        ]
        if not matches:
            continue
        # Prefer an incident still linked to this very post, else the newest
        # one that already existed when the note was written.
        same_post = [i for i in matches if i.field_command_id == note.field_command_id]
        chosen = (same_post or matches)
        chosen.sort(key=lambda i: i.created_at, reverse=True)
        note.incident_id = chosen[0].id
        note.save(update_fields=["incident"])

    closed_ids = set(
        Incident.objects.filter(status="CLOSED").values_list("id", flat=True)
    )

    def incident_is_stale_for(fc_id, incident_id, incident_fc_id):
        # No incident, a closed incident, or one that has moved to another post.
        if incident_id is None:
            return True
        if incident_id in closed_ids:
            return True
        return incident_fc_id != fc_id

    # --- 2. Prune missions not tied to a live incident on their post ---
    for m in FieldCommandMission.objects.select_related("incident").all():
        inc = m.incident
        if incident_is_stale_for(
            m.field_command_id, m.incident_id,
            inc.field_command_id if inc else None,
        ):
            m.delete()

    # --- 3. Prune auto-logged notes not tied to a live incident on their post
    #        (plain NOTE entries are left alone — they are operator text) ---
    for n in FieldCommandNote.objects.select_related("incident").all():
        if n.kind not in AUTO_KINDS:
            continue
        inc = n.incident
        if incident_is_stale_for(
            n.field_command_id, n.incident_id,
            inc.field_command_id if inc else None,
        ):
            n.delete()


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0023_fieldcommandnote_incident"),
    ]

    operations = [
        migrations.RunPython(backfill_and_prune, noop),
    ]
