from django.apps import AppConfig


class ApiConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "api"

    def ready(self):
        # Start background polling thread when app loads
        from utils.polling_service import start_polling_service

        start_polling_service()
