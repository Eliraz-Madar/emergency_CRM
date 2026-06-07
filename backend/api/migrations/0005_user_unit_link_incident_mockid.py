from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0004_reportmedia"),
    ]

    operations = [
        migrations.AddField(
            model_name="incident",
            name="mock_incident_id",
            field=models.IntegerField(blank=True, null=True, unique=True),
        ),
        migrations.AddField(
            model_name="user",
            name="unit",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="app_user",
                to="api.unit",
            ),
        ),
    ]
