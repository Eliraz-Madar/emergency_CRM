# Field War-Room Dashboard - Implementation Details

## Architecture Overview

The dashboard is built with a modern frontend-backend architecture optimized for real-time operational awareness.

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (React + Zustand + Vite)                              │
│  - Dashboard.jsx (main page)                                    │
│  - Components (KPI, Filter, List, Map, Details, Events)        │
│  - Real-time SSE client                                         │
│  - State management (incidents, units, filters, connection)     │
└─────────────────────────────────────────────────────────────────┘
            ▲
            │ HTTP REST + Server-Sent Events
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Backend (Django + DRF)                                         │
│  - Mock Data Service (generates realistic data)                 │
│  - Real-time Service (SSE broadcast)                            │
│  - REST API (incidents, units, events, actions)                 │
│  - Database Models (ready for real data)                        │
└─────────────────────────────────────────────────────────────────┘
```

## Frontend Architecture

### State Management (Zustand)
Located in `src/store/dashboard.js`, manages:
- **Data**: incidents, units, events
- **UI State**: selected item, filters, sort, connection status
- **Actions**: add/update entities, set filters, selection
- **Selectors**: filtered/sorted incidents, selected incident

Benefits:
- ✅ Minimal boilerplate vs Redux
- ✅ Reactive updates trigger re-renders
- ✅ Easy to persist/restore if needed
- ✅ Type-friendly with JSDoc

### Real-Time Connection
Located in `src/services/realtime.js`:
- Uses Server-Sent Events (SSE) via EventSource API
- Auto-reconnects with exponential backoff
- Handles errors gracefully
- Falls back to polling if SSE unavailable

### Component Structure
```
Dashboard.jsx (page)
├── dashboard-topbar
│   ├── Title + status indicators
│   └── Connection status + demo mode badge
├── KPI Cards
│   ├── Total Incidents
│   ├── Active Incidents
│   ├── Critical Count
│   └── Available Units
├── Filter Bar
│   ├── Search input
│   ├── Sort dropdown
│   └── Advanced filters (severity, status, channel)
├── Main Content (3-column grid)
│   ├── Left: Incident List
│   │   └── Filterable, sortable, selectable list
│   ├── Center: Map View
│   │   ├── Leaflet map
│   │   ├── Incident markers (colored by severity)
│   │   ├── Unit markers
│   │   └── Legend
│   └── Right: Details Panel OR Event Feed
│       ├── Incident Details (when selected)
│       │   ├── Overview section
│       │   ├── Workflow (status/severity controls)
│       │   ├── Assigned units
│       │   ├── Quick actions
│       │   └── Timestamps
│       └── Event Feed (live activity log)
│           └── Paginated events
└── Footer
    └── Attribution + version info
```

### Styling
Located in `src/styles.css` with:
- CSS Variables for consistent theming
- Responsive grid layout (1366px minimum)
- Professional UI with subtle shadows/transitions
- Mobile-friendly fallback (stacked layout)
- Dark color palette with accent colors

## Backend Mock Data Service

### Mock Data Generator (`utils/mock_data.py`)

**Features:**
- Deterministic: seed-based for reproducible demos
- Realistic: uses Faker library for human data
- Scalable: generates on-demand
- Event-driven: tracks all updates

**Data Entities:**

1. **Incident**
   ```python
   {
     "id": int,
     "title": str,          # Random incident type
     "description": str,    # Faker-generated
     "severity": str,       # LOW/MED/HIGH/CRITICAL
     "status": str,         # OPEN/IN_PROGRESS/CLOSED
     "location_lat": float,
     "location_lng": float,
     "location_name": str,  # Tel Aviv area
     "created_at": ISO8601,
     "updated_at": ISO8601,
     "channel": str,        # Police/Fire/EMS/Civil Defense
     "assigned_unit_ids": [int],
     "reporter": str,       # Faker name
     "tags": [str],         # Random tags
   }
   ```

2. **Unit**
   ```python
   {
     "id": int,
     "name": str,           # E.g., "Ambulance-1"
     "type": str,           # Ambulance/Police/Fire/Rescue
     "status": str,         # Available/Dispatched/OnScene/Offline
     "location_lat": float,
     "location_lng": float,
     "last_update": ISO8601,
     "crew_size": int,      # 1-5
   }
   ```

3. **Event**
   ```python
   {
     "id": int,
     "timestamp": ISO8601,
     "entity_type": str,    # "incident" or "unit"
     "entity_id": int,
     "message": str,        # Human-readable
     "level": str,          # "info"/"warn"/"error"
   }
   ```

### Simulation Logic

The `simulate_update()` method randomly:
1. **Creates new incident** (30% chance)
   - Random type, location, severity
   - Initial status: OPEN
2. **Updates incident status** (20% chance)
   - Random incident → next status in workflow
3. **Updates incident severity** (20% chance)
   - Random severity change
4. **Assigns unit** (20% chance)
   - Random incident + unit → create assignment
5. **Moves unit** (10% chance)
   - Random unit location drift

All updates trigger event log entries automatically.

### API Endpoints

**Base:** `http://localhost:8000/api/`

#### Data Retrieval
```
GET  /mock/incidents/           → List all incidents
GET  /mock/units/               → List all units
GET  /mock/events/?limit=50     → List recent events
GET  /mock/incidents/<id>/      → Get specific incident
```

#### Data Modification
```
PATCH /mock/incidents/<id>/status/     {status: "IN_PROGRESS"}
PATCH /mock/incidents/<id>/severity/   {severity: "HIGH"}
POST  /mock/incidents/<id>/assign/     {unit_id: 5}
POST  /mock/incidents/<id>/note/       {note: "Patient conscious"}
```

#### Real-Time
```
GET   /mock/updates/stream/     → Server-Sent Events
GET   /mock/simulate/           → Trigger one random update (for testing)
```

### Real-Time Service (`utils/realtime.py`)

- Manages subscriber callbacks
- Broadcasts updates to all SSE connections
- Background thread simulates events at configurable interval
- Supports enable/disable of simulation

## Data Flow

### Initial Load
```
1. Dashboard mounts
2. Fetch initial data (incidents, units, events)
3. Populate Zustand store
4. Connect SSE stream
5. Listen for updates
```

### Real-Time Update
```
1. Backend simulates random update
2. Broadcast via SSE
3. Frontend receives event
4. Parse and route (incident/unit/event)
5. Update Zustand store
6. Components re-render with new data
7. Update map markers
8. Add event log entry
```

### User Action
```
1. User clicks action (e.g., assign unit)
2. API call to PATCH /mock/incidents/<id>/assign/
3. Backend updates mock data
4. Response returns updated incident
5. Frontend updates store immediately (optimistic)
6. SSE broadcasts update to all clients
7. Event logged automatically
```

## Key Design Decisions

### 1. SSE vs WebSocket
- **Chosen: SSE** because:
  - ✅ Simpler to implement (no library needed)
  - ✅ Falls back to polling automatically
  - ✅ Less resource-intensive for simple updates
  - ✅ Works through standard proxies
  - ⚠️ Only server→client (sufficient for operational dashboard)

### 2. Mock Data Strategy
- **Chosen: In-memory generation** because:
  - ✅ No database required
  - ✅ Deterministic with seed
  - ✅ Instant startup
  - ✅ Safe demo data (no PII)
  - Ready to replace with real queries

### 3. State Management
- **Chosen: Zustand** because:
  - ✅ Minimal setup vs Redux
  - ✅ Reactive updates
  - ✅ Composable selectors
  - ✅ Good DevTools support
  - ⚠️ No built-in persistence (acceptable for MVP)

### 4. Component Architecture
- **Chosen: Functional + Hooks** because:
  - ✅ Modern React best practices
  - ✅ Easy to test
  - ✅ Composable logic
  - ✅ Better performance with memoization

## Extending to Real Data

To integrate with real incident/unit systems:

### Step 1: Replace Mock Service
```python
# backend/api/views.py
def mock_incidents(request):
    # OLD: return Response(get_mock_service().get_incidents())
    # NEW: return Response(Incident.objects.all().values(...))
    incidents = Incident.objects.select_related(...).all()
    return Response(IncidentSerializer(incidents, many=True).data)
```

### Step 2: Implement Real-Time Updates
```python
# Option A: Keep SSE, trigger from signal handlers
from django.db.models.signals import post_save
@receiver(post_save, sender=Incident)
def incident_updated(sender, instance, **kwargs):
    realtime_service.broadcast({
        'type': 'incident_updated',
        'data': IncidentSerializer(instance).data
    })

# Option B: Replace with WebSocket
# Install django-channels, use async consumers
```

### Step 3: Authentication
```python
# Currently bypassed (auth temporarily disabled)
# To enable: Remove permission_classes bypass in views.py
# Implement JWT token validation
from rest_framework.permissions import IsAuthenticated
permission_classes = [IsAuthenticated]
```

### Step 4: Validation & Error Handling
```python
# Add proper error handling for real data
try:
    incident = Incident.objects.get(pk=id)
except Incident.DoesNotExist:
    return Response({"error": "Not found"}, status=404)

# Validate user permissions
if not user.can_modify_incident(incident):
    return Response({"error": "Forbidden"}, status=403)
```

## Performance Considerations

### Frontend
- **Re-render optimization**: Zustand only updates changed slices
- **Memoization**: Components using `React.memo` where needed
- **Lazy loading**: Event list scrolls (not pagination)
- **Map clustering**: Would be added for 100+ markers

### Backend
- **Connection pooling**: Django handles automatically
- **Query optimization**: Use `select_related` for joins
- **Caching**: Could add Redis for frequently accessed data
- **Rate limiting**: Should add for production

### Real-Time
- **Update batching**: SSE doesn't support this yet (could add)
- **Compression**: Standard gzip for larger payloads
- **Scalability**: SSE doesn't scale beyond single server
  - For production: Use message queue (RabbitMQ, Redis) + WebSocket

## Testing Scenarios

### Functional Testing
1. **Load Initial Data**: Dashboard shows 8 incidents, 12 units
2. **Filter by Severity**: Show only CRITICAL → 1 incident
3. **Search by Title**: Search "fire" → filtered list
4. **Assign Unit**: Click incident → click assign button → verify update
5. **Change Status**: Click OPEN incident → click IN_PROGRESS → verify
6. **Add Note**: Click incident → click "Add Note" → verify in event log
7. **Real-Time**: Watch new incidents appear automatically

### Load Testing
- 100+ incidents: Map should still be responsive (add clustering)
- 1000+ events: Event log should paginate/virtualize
- 10 concurrent users: Backend should handle gracefully

### Edge Cases
- Lost connection: Show "OFFLINE" status
- Recover connection: Auto-reconnect with backoff
- Invalid data: Show error toast
- Server error: Fallback to last known state
- User offline: Queue actions, sync when online

## Security Notes

⚠️ **This is a DEMO/MVP - NOT PRODUCTION READY**

Issues to address for production:
- ❌ No authentication (anyone can access)
- ❌ No authorization (anyone can modify any incident)
- ❌ No rate limiting (vulnerable to DOS)
- ❌ No HTTPS/TLS
- ❌ CORS allows all origins
- ❌ No input validation
- ❌ No audit logging
- ❌ No data encryption

### Security Hardening Checklist
- [ ] Implement JWT authentication
- [ ] Add role-based access control (RBAC)
- [ ] Validate all inputs (request body, query params)
- [ ] Enable HTTPS with valid certificate
- [ ] Restrict CORS to known domains
- [ ] Add rate limiting (DRF throttling)
- [ ] Log all actions with user/timestamp
- [ ] Encrypt sensitive fields in database
- [ ] Add unit tests for permissions
- [ ] Security audit by external team

## Future Enhancements

### Phase 2 (Post-MVP)
- [ ] Real database integration
- [ ] User authentication & roles
- [ ] Map clustering for 100+ incidents
- [ ] Notification system (push, SMS, email)
- [ ] Incident templates & quick create
- [ ] Advanced analytics & reporting
- [ ] Offline mode with sync
- [ ] Mobile app integration

### Phase 3 (Long-term)
- [ ] AI-powered incident routing
- [ ] Predictive analytics
- [ ] Multi-agency coordination
- [ ] Integration with CAD/RMS systems
- [ ] Video integration
- [ ] Voice communication bridge
- [ ] Mobile field app with offline cache
- [ ] Public information management (PIM)

---

**Dashboard Version:** 1.0 MVP | **Build Date:** 2024 | **Status:** Production Ready (for Demo)
