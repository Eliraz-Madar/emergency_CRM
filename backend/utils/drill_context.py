"""
Drill Context Service

Manages the active drill state globally and ensures strict isolation
of drill data across all components.
"""

import threading


class DrillContextService:
    """
    Thread-safe service to manage the active drill context.
    Ensures all data queries are filtered by the currently active drill.
    """

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        """Singleton pattern with thread safety."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._active_drill_id = None
        return cls._instance

    @property
    def active_drill_id(self):
        """Get the currently active drill ID."""
        return self._active_drill_id

    @active_drill_id.setter
    def active_drill_id(self, value):
        """Set the active drill ID."""
        self._active_drill_id = value

    def set_active_drill(self, drill_id):
        """Set the active drill context."""
        self.active_drill_id = drill_id

    def clear_drill_context(self):
        """Clear the active drill context."""
        self.active_drill_id = None

    def has_active_drill(self):
        """Check if a drill is currently active."""
        return self.active_drill_id is not None

    def ensure_drill_context(self):
        """Raise exception if no drill is active."""
        if not self.has_active_drill():
            raise RuntimeError(
                "No active drill context. Call set_active_drill() first.")
        return self.active_drill_id


def get_drill_context_service():
    """Factory function to get the drill context service instance."""
    return DrillContextService()
