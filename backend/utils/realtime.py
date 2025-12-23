"""
Real-time update service using Server-Sent Events (SSE).
Simulates live updates for the dashboard demo.
"""
import json
import time
import threading
from datetime import datetime
from typing import Callable, List


class RealtimeUpdateService:
    """Manages real-time updates for connected clients."""
    
    def __init__(self):
        self.subscribers: List[Callable] = []
        self.simulation_enabled = True
        self.simulation_speed = 1.0
        self._simulation_thread = None
        self._running = False
    
    def subscribe(self, callback: Callable):
        """Subscribe to updates."""
        self.subscribers.append(callback)
        return lambda: self.unsubscribe(callback)
    
    def unsubscribe(self, callback: Callable):
        """Unsubscribe from updates."""
        if callback in self.subscribers:
            self.subscribers.remove(callback)
    
    def broadcast(self, event: dict):
        """Broadcast event to all subscribers."""
        for callback in self.subscribers:
            try:
                callback(event)
            except Exception as e:
                print(f"Error broadcasting to subscriber: {e}")
    
    def start_simulation(self, mock_service, interval: float = 2.0):
        """Start background simulation thread."""
        if self._running:
            return
        
        self._running = True
        
        def simulate():
            while self._running:
                time.sleep(interval / self.simulation_speed)
                if self.simulation_enabled:
                    update = mock_service.simulate_update()
                    if update:
                        self.broadcast({
                            "type": "update",
                            "data": update,
                            "timestamp": datetime.now().isoformat(),
                        })
        
        self._simulation_thread = threading.Thread(target=simulate, daemon=True)
        self._simulation_thread.start()
    
    def stop_simulation(self):
        """Stop background simulation."""
        self._running = False
        if self._simulation_thread:
            self._simulation_thread.join(timeout=2)
    
    def set_simulation_enabled(self, enabled: bool):
        """Enable/disable simulation."""
        self.simulation_enabled = enabled


# Global instance
_realtime_service = None


def get_realtime_service() -> RealtimeUpdateService:
    """Get or create realtime service."""
    global _realtime_service
    if _realtime_service is None:
        _realtime_service = RealtimeUpdateService()
    return _realtime_service
