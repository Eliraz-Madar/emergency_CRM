import random
import time

SEVERITIES = ["LOW", "MED", "HIGH"]
UNIT_TYPES = ["Police", "Fire", "EMS", "HomeFront"]


def fetch_mock_events():
    now = int(time.time())
    incidents = [
        {
            "external_id": f"ext-{i}",
            "title": f"Mock Incident {i}",
            "description": "Auto generated incident",
            "location_lat": 32.0 + random.random(),
            "location_lng": 34.0 + random.random(),
            "severity": random.choice(SEVERITIES),
            "status": random.choice(["OPEN", "IN_PROGRESS"]),
        }
        for i in range(1, 3)
    ]
    units = [
        {
            "name": f"Unit-{now % 100}-{i}",
            "type": random.choice(UNIT_TYPES),
            "location_lat": 32.5 + random.random(),
            "location_lng": 34.5 + random.random(),
            "availability_status": random.choice(["AVAILABLE", "BUSY"]),
        }
        for i in range(1, 3)
    ]
    return {"incidents": incidents, "units": units}
