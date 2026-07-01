from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from api.models import Unit


class Command(BaseCommand):
    help = "Mark units offline if they haven't been seen within the given threshold (minutes)."

    def add_arguments(self, parser):
        parser.add_argument("--minutes", type=int, default=5, help="Threshold in minutes to mark units offline")

    def handle(self, *args, **options):
        minutes = options.get("minutes", 5)
        threshold = timezone.now() - timedelta(minutes=minutes)
        qs = Unit.objects.filter(is_online=True, last_seen__lt=threshold)
        updated = qs.update(is_online=False, availability_status="OFFLINE")
        self.stdout.write(self.style.SUCCESS(f"Marked {updated} unit(s) offline (threshold={minutes}m)."))
