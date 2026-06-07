from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0005_user_unit_link_incident_mockid"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="mock_unit_id",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="PushToken",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("mock_unit_id",  models.IntegerField()),
                ("token",         models.CharField(max_length=256, unique=True)),
                ("registered_at", models.DateTimeField(auto_now=True)),
            ],
        ),
    ]
