import threading
import time
from django.db import transaction
from django.conf import settings

_polling_thread = None
_polling_interval = int(getattr(settings, "POLLING_INTERVAL", 5))


def _sync_with_external():
    from external.mock_api_client import fetch_mock_events
    from api.models import Incident, Unit

    payload = fetch_mock_events()
    incidents = payload.get("incidents", [])
    units = payload.get("units", [])

    with transaction.atomic():
        for inc in incidents:
            Incident.objects.update_or_create(
                title=inc["title"],
                defaults={
                    "description": inc.get("description", ""),
                    "location_lat": inc.get("location_lat", 0.0),
                    "location_lng": inc.get("location_lng", 0.0),
                    "severity": inc.get("severity", "LOW"),
                    "status": inc.get("status", "OPEN"),
                },
            )
        for unit in units:
            Unit.objects.update_or_create(
                name=unit["name"],
                defaults={
                    "type": unit.get("type", "Police"),
                    "location_lat": unit.get("location_lat", 0.0),
                    "location_lng": unit.get("location_lng", 0.0),
                    "availability_status": unit.get("availability_status", "AVAILABLE"),
                },
            )


def _polling_loop():
    while True:
        try:
            _sync_with_external()
        except Exception:
            # Intentionally swallow exceptions to keep the demo running
            pass
        time.sleep(_polling_interval)


def start_polling_service():
    global _polling_thread
    if _polling_thread and _polling_thread.is_alive():
        return
    _polling_thread = threading.Thread(target=_polling_loop, daemon=True)
    _polling_thread.start()
