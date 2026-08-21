from django.apps import AppConfig


class ApiConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "api"

    def ready(self):
        # Background mock polling thread disabled — it silently overwrote
        # Incident/Unit rows every POLLING_INTERVAL seconds with data from
        # simulated.mock_api_client, independent of any HTTP request.
        # State transitions must now only happen via explicit API calls.
        # See "final changes/01_disable_simulation_engine.md".
        # (its module, utils/polling_service.py, has since been removed)
        pass
