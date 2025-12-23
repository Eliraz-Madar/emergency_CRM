# Field Incident Command Dashboard - Architecture Documentation

## Overview

This document describes the architecture of the Field Incident Command Dashboard and how it differs from the Regional/Multi-Incident Dashboard.

## System Architecture

### Two Dashboard Paradigms

The Emergency Response Command System supports two distinct operational modes:

#### 1. Regional Dashboard (Multi-Incident Dispatch)
- **Scope:** Multiple incidents across a geographic region
- **Users:** Dispatchers, coordinators, operational staff
- **Decision Level:** Tactical (resource allocation, unit dispatch)
- **Timescale:** Minutes to hours per incident
- **Data Volume:** 8-12 concurrent incidents

#### 2. Field Incident Dashboard (Major Incident Command)
- **Scope:** Single large-scale incident with multiple sectors
- **Users:** Incident commanders, sector leaders, task group chiefs
- **Decision Level:** Strategic (command coordination, casualty management)
- **Timescale:** Hours to days for incident lifecycle
- **Data Volume:** 1 major incident, 5 sectors, 8 task groups

## Data Models

### Regional Dashboard Data Model

```
Incident (root)
├── title, description, location
├── severity (LOW, MED, HIGH)
├── status (OPEN, IN_PROGRESS, CLOSED)
├── Tasks (multiple)
│   └── assigned_unit
│   └── status (PENDING, IN_PROGRESS, DONE)
└── Units (assigned)
    └── type, availability, location
```

**Purpose:** Quick status of individual incidents and their response

### Field Incident Dashboard Data Model

```
MajorIncident (root)
├── title, incident_type, description
├── status (DECLARED, ACTIVE, STABILIZING, RECOVERY)
├── estimated_casualties, confirmed_deaths, displaced_persons
├── location, radius_meters, command_post_location
│
├── Sectors (5) - Geographic subdivisions
│   ├── name, location_lat, location_lng
│   ├── hazard_level (LOW, MEDIUM, HIGH, CRITICAL)
│   ├── status (ACTIVE, CONTAINED, CLEARED)
│   ├── estimated_survivors
│   ├── access_status
│   └── primary_responder
│
├── TaskGroups (8) - Operational objectives
│   ├── title, category (SEARCH_RESCUE, EVACUATION, MEDICAL, etc.)
│   ├── priority (CRITICAL, HIGH, MEDIUM, LOW)
│   ├── status (PLANNED, IN_PROGRESS, PAUSED, COMPLETED)
│   ├── progress_percent (0-100)
│   ├── assigned_units_count
│   ├── completed_subtasks / total_subtasks
│   ├── commander_name, notes
│   └── sector_ids (many-to-many relationship)
│
└── IncidentEvents (timeline)
    ├── event_type (STATUS_CHANGE, HAZARD_ALERT, CASUALTY_UPDATE, etc.)
    ├── severity (INFO, WARNING, CRITICAL)
    ├── title, description
    └── created_by, created_at
```

**Purpose:** Command-level coordination with hierarchical task tracking

## Backend Architecture

### API Endpoints

#### Regional Dashboard Endpoints
```
GET  /api/mock/incidents/                    - List incidents
GET  /api/mock/units/                        - List units
GET  /api/mock/events/                       - Event log
GET  /api/mock/incidents/<id>/               - Incident detail
PATCH /api/mock/incidents/<id>/status/       - Update status
PATCH /api/mock/incidents/<id>/severity/     - Update severity
POST /api/mock/incidents/<id>/assign/        - Assign unit
POST /api/mock/incidents/<id>/note/          - Add note
GET  /api/mock/updates/stream/               - SSE stream
```

#### Field Incident Dashboard Endpoints
```
GET  /api/field/incident/                    - Get major incident + all data
GET  /api/field/sectors/                     - List sectors
GET  /api/field/task-groups/                 - List task groups
GET  /api/field/events/                      - Operational timeline
PATCH /api/field/sectors/<id>/               - Update sector
PATCH /api/field/task-groups/<id>/           - Update task group
PATCH /api/field/casualty-update/            - Update casualties
POST /api/field/add-event/                   - Add timeline event
GET  /api/field/simulate/                    - Trigger simulation
GET  /api/field/updates/stream/              - SSE stream
```

### Mock Data Generation

#### Regional Dashboard
**File:** `backend/utils/mock_data.py`

- Generates 8 initial incidents with realistic data
- 12 units across 4 types (Police, Fire, EMS, HomeFront)
- Continuous simulation with Faker
- Deterministic seeding with `DEMO_SEED` environment variable
- Simulates realistic updates every 1-3 seconds

#### Field Incident Dashboard
**File:** `backend/utils/field_incident_data.py`

- Generates single major incident (EARTHQUAKE, MISSILE_STRIKE, BUILDING_COLLAPSE)
- 5 sectors with varying hazard levels
- 8 task groups across 8 categories
- Realistic casualty estimates and survivors
- Simulation updates:
  - 40% chance: casualty estimate changes
  - 30% chance: sector hazard updates
  - 35% chance: task group progress updates
  - 50% chance: new event generation

## Frontend Architecture

### State Management

#### Regional Dashboard Store
**File:** `frontend-web/src/store/dashboard.js`

```javascript
{
  incidents: [],
  units: [],
  events: [],
  selectedIncident: null,
  connectionStatus: 'CONNECTED',
  filterSeverity: null,
  searchText: '',
  
  // Selectors
  getFilteredIncidents()
  getSelectedIncident()
  getCriticalIncidents()
}
```

**Pattern:** Zustand with computed selectors

#### Field Incident Store
**File:** `frontend-web/src/store/fieldIncident.js`

```javascript
{
  majorIncident: {},
  sectors: [],
  taskGroups: [],
  events: [],
  selectedSector: null,
  selectedTaskGroup: null,
  connectionStatus: 'CONNECTED',
  filterCategory: null,
  taskStatusFilter: 'all',
  
  // Selectors
  getFilteredTaskGroups()
  getSectorByName()
  getSituationSummary()
  getAverageTaskProgress()
  getCriticalAlerts()
}
```

### Component Architecture

#### Regional Dashboard Components

```
Dashboard (page)
├── KPICards              - Summary metrics
├── IncidentList          - Sortable incident list
├── IncidentDetailsPanel  - Details and quick actions
├── MapView               - Leaflet map
├── EventFeed             - Activity log
└── FilterBar             - Search and filtering
```

#### Field Incident Dashboard Components

```
FieldIncidentDashboard (page)
├── SituationOverview     - Incident status, KPIs, alerts
├── SectorMap            - Sector cards with hazard levels
├── TaskGroupPanel       - Task groups with progress
└── OperationalTimeline  - Decision trail and events
```

### Real-Time Communication

**Technology:** Server-Sent Events (SSE)

**Advantages:**
- Simple HTTP protocol (works through proxies)
- Lower overhead than WebSocket
- Automatic reconnection support
- Better for one-way server → client updates

**Implementation:**
- Regional: `connectToUpdatesStream()` - polls for mock incidents/units
- Field Incident: `connectToFieldIncidentStream()` - streams simulated updates

## Styling Architecture

### CSS Organization

**Regional Dashboard:**
- `src/styles/styles.css` - 900+ lines
- Grid layout (3-column: 280px 1fr 320px)
- Responsive breakpoints: 1920px, 1600px, 1366px
- CSS variables for theme consistency

**Field Incident Dashboard:**
- `src/styles/field-incident-dashboard.css` - 1000+ lines
- Command center aesthetic (dark, professional)
- Section-based layout (overview, operations, tasks)
- Command hierarchy visualization

**Dashboard Selector:**
- `src/styles/dashboard-selector.css` - 400+ lines
- Card-based interface
- Architectural comparison table
- Responsive grid layout

### Color Scheme

**Primary Colors:**
- Cyan/Teal: `#06b6d4`, `#0ea5e9` (primary actions)
- Dark Blue: `#0f172a`, `#1e293b` (backgrounds)
- Gray: `#475569`, `#64748b` (secondary text)
- Light Gray: `#f1f5f9`, `#e2e8f0` (primary text)

**Status Colors:**
- Critical/Error: `#ef4444` (red)
- Warning: `#f59e0b` (orange)
- Success: `#10b981` (green)
- Info: `#3b82f6` (blue)

## Routing Architecture

**File:** `frontend-web/src/main.jsx`

```
/ → DashboardSelector (landing page)
├── /regional → Dashboard (multi-incident)
└── /field-incident → FieldIncidentDashboard (major incident)
```

**Navigation:**
- All dashboards accessible from selector
- Each dashboard stands alone (no cross-linking)
- Back button returns to selector

## Extensibility

### Adding a New Dashboard Type

1. **Data Model** (Backend)
   - Add models in `api/models.py`
   - Create migration: `python manage.py makemigrations`
   - Define endpoints in `views.py` and `urls.py`

2. **Mock Data** (Backend)
   - Create `backend/utils/<type>_data.py`
   - Implement data generation and simulation logic
   - Factory function for initialization

3. **State Management** (Frontend)
   - Create `frontend-web/src/store/<type>.js`
   - Implement Zustand store with selectors
   - Export store and selectors

4. **Components** (Frontend)
   - Create `frontend-web/src/components/<type>/`
   - Build specialized UI components
   - Import from centralized store

5. **Page** (Frontend)
   - Create `frontend-web/src/pages/<Type>Dashboard.jsx`
   - Implement data loading and real-time connection
   - Use store selectors and API client

6. **Styling** (Frontend)
   - Create `frontend-web/src/styles/<type>-dashboard.css`
   - Follow existing CSS variable patterns
   - Include responsive breakpoints

7. **Routing** (Frontend)
   - Add route in `main.jsx`
   - Add option to `DashboardSelector.jsx`
   - Update comparison table in selector

## Performance Considerations

### Data Optimization
- Regional: ~100 incidents/units worth of data
- Field: ~1 major incident with ~100 objects
- SSE updates throttled (1-3 seconds)
- Component memoization for expensive renders

### Memory Management
- Event log limited to 100 most recent
- Sectors/task groups held in memory (minimal)
- Zustand handles subscription cleanup

### Network
- SSE connection reused (no polling)
- Auto-reconnect with exponential backoff (3s → 30s)
- Fallback to polling if SSE unavailable

## Security Notes

### Current Implementation (Demo)
- No authentication (bypassed for MVP)
- CORS enabled for development
- Django DEBUG = true in development

### Production Recommendations
1. Implement JWT authentication
2. Restrict CORS origins
3. Set Django DEBUG = false
4. Add API rate limiting
5. Validate all inputs server-side
6. Use HTTPS for real deployments
7. Implement role-based access control

## Testing Strategy

### Backend Testing
```bash
# Test regional endpoints
curl http://localhost:8000/api/mock/incidents/
curl http://localhost:8000/api/mock/units/

# Test field incident endpoints
curl http://localhost:8000/api/field/incident/
curl http://localhost:8000/api/field/sectors/
```

### Frontend Testing
1. Regional dashboard loads correctly
2. Field incident dashboard loads correctly
3. SSE connections establish and reconnect
4. Simulation updates appear in real-time
5. State updates trigger re-renders
6. Navigation between dashboards works

## Deployment

### Docker Support
Both dashboards can be containerized:
- Python image for Django backend
- Node image for frontend build
- Docker Compose for orchestration

### Cloud Deployment
Suitable for:
- Azure Container Apps
- AWS ECS
- Google Cloud Run
- Kubernetes clusters

---

**Last Updated:** December 2025
**Architecture Version:** 2.0 (Added Field Incident Dashboard)
**Status:** Production-ready MVP
