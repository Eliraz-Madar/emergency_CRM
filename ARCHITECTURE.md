# Field Incident Command Dashboard — Architecture Documentation

## Overview

This document describes the architecture of the Emergency Response Command System, covering the Regional War-Room Dashboard, the Field Incident Command Dashboard, and the Field Mobile Application.

---

## System Architecture

### Three-Layer Operational Stack

```
┌──────────────────────────────────────────────────────────────────────┐
│  FIELD MOBILE (React Native / Expo)                                  │
│  Login → Tasks → Report (Text + Image + Video) → Sync               │
│  Auth: JWT Bearer Token  |  Media: expo-image-picker + multipart     │
│  Offline: SQLite (expo-sqlite)  |  Sync: sessionStorage-scoped       │
└───────────────────────────────┬──────────────────────────────────────┘
                                │  HTTPS  |  multipart/form-data  |  JSON
┌───────────────────────────────┴──────────────────────────────────────┐
│  WEB FRONTEND (React 18 + Vite + Zustand + Leaflet)                  │
│  War-Room Dashboard (/regional)  |  Field Command Dashboard (/field) │
│  Real-time: SSE streams  |  State: Zustand  |  Maps: Leaflet/OSRM   │
│  Session dispatch state: sessionStorage (not localStorage)           │
└───────────────────────────────┬──────────────────────────────────────┘
                                │  Django REST Framework
┌───────────────────────────────┴──────────────────────────────────────┐
│  BACKEND API (Python 3.9+ / Django 5.0 / DRF)                       │
│  Auth: JWT (simplejwt) with active role-to-entity mapping            │
│  Parsers: MultiPartParser + FormParser + JSONParser on report routes │
│  Media: MEDIA_ROOT / MEDIA_URL  |  DB: SQLite                        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Dashboard Paradigms

### 1. Regional Dashboard (Multi-Incident Dispatch)
- **Scope:** Multiple incidents across a geographic region
- **Users:** Dispatchers, coordinators, operational staff
- **Decision Level:** Tactical — resource allocation, unit dispatch
- **Data Volume:** 18+ concurrent incidents across Israel

### 2. Field Incident Command Dashboard
- **Scope:** Single large-scale incident with multiple sectors
- **Users:** Incident commanders, sector leaders, task group chiefs
- **Decision Level:** Strategic — command coordination, casualty management
- **Data Volume:** 1 major incident, 5 sectors, 8 task groups

### 3. Field Mobile Application
- **Scope:** Field unit task management and situation reporting
- **Users:** Field units, first responders
- **Decision Level:** Operational — task execution, on-site status
- **Data:** JWT-authenticated task list + polymorphic reports (text / image / video)

---

## Data Models

### Core Models (`api/models.py`)

```
IncidentEvent
├── incident          FK → Incident (nullable)
├── major_incident    FK → MajorIncident (nullable)
├── event_type        STATUS_CHANGE | ASSIGNMENT | UPDATE | HAZARD_ALERT | …
├── severity          INFO | WARNING | CRITICAL
├── title             CharField(200)
├── description       TextField (text report body — always optional)
├── created_by        CharField
├── created_at        DateTimeField(auto_now_add)
└── media ──────────► ReportMedia (reverse FK, one-to-many)

ReportMedia                          ← NEW in v3.0
├── event             FK → IncidentEvent (CASCADE)
├── file              FileField(upload_to="report_media/%Y/%m/%d/")
├── media_type        "image" | "video"
└── uploaded_at       DateTimeField(auto_now_add)
```

**Key design rule:** `description` (text) and `media` (files) are both optional on every report.
A valid report can be text-only, media-only, or a combination of both.

### Mobile Auth Data Model
```
User (AbstractUser)
├── role        "admin" | "dispatcher" | "fieldunit"
└── unit  ─────► Unit (OneToOne, nullable) — links mobile login to a unit type

Unit
├── name, type ("Police" | "Fire" | "EMS")
└── app_user ──► User (reverse OneToOne)

PushToken
├── mock_unit_id   int   — routine unit number (e.g., 43 for "Unit 43")
├── token          str   — Expo push token
└── registered_at  DateTimeField(auto_now)
```

### Regional Dashboard Data Model
```
Incident
├── title, description, location_lat, location_lng
├── priority (LOW | MED | HIGH | CRITICAL)
├── status   (OPEN | IN_PROGRESS | CLOSED)
├── mock_incident_id  int (nullable, unique) — links to a frontend routine incident
├── created_at
└── Tasks[]
    ├── assigned_unit → Unit
    ├── mock_unit_id  int (nullable) — routine unit number for mobile filtering
    └── status (PENDING | IN_PROGRESS | DONE)
```

### Field Incident Data Model
```
MajorIncident
├── title, incident_type, status, description
├── estimated_casualties, confirmed_deaths, displaced_persons
├── location, radius_meters, command_post_location
│
├── Sectors[]
│   ├── hazard_level (LOW | MEDIUM | HIGH | CRITICAL)
│   ├── status (ACTIVE | CONTAINED | CLEARED)
│   └── estimated_survivors, access_status, primary_responder
│
├── TaskGroups[]
│   ├── category (SEARCH_RESCUE | EVACUATION | MEDICAL | …)
│   ├── priority, status, progress_percent
│   └── sectors (M2M)
│
└── IncidentEvents[]
    └── media[] → ReportMedia   ← polymorphic attachments
```

---

## Backend Architecture

### Authentication & Role Mapping

**Implementation:** `django-rest-framework-simplejwt` with a custom token view (`api/auth.py`).

The JWT token response now embeds operational identity:
```json
{
  "access":   "<token>",
  "refresh":  "<token>",
  "user_id":  3,
  "username": "police",
  "role":     "fieldunit",
  "unit_id":  1,
  "unit_type":"Police"
}
```
`unit_type` is one of `"Police"` / `"Fire"` / `"EMS"` — used by `UnitSelectScreen` to query the correct routine units from the backend.

**Role→Entity mapping is active at every authenticated request:**
- The mobile app passes `X-User-ID` and `X-User-Role` headers derived from the decoded token.
- `TaskPermission` (`api/permissions.py`) enforces that only `fieldunit` role users can PATCH task status; `admin`/`dispatcher` can do full CRUD.
- Tokens expire after 8 hours (access) / 7 days (refresh) — not indefinite sessions.

This replaces the earlier stub pattern where role was stored only in localStorage with no server-side enforcement.

### Polymorphic Field Reporting API

**Endpoint:** `POST /api/field/add-event/?fieldId=<id>`

**Parser stack** (accepts both JSON and multipart in one endpoint):
```python
@parser_classes([MultiPartParser, FormParser, JSONParser])
```

**Request formats supported:**

| Content-Type | Payload | Use case |
|---|---|---|
| `application/json` | `{ event_type, severity, title, description, created_by }` | Text-only report |
| `multipart/form-data` | Same fields + `files[]` (images/videos) | Media report |

**File storage path:** `MEDIA_ROOT/report_media/YYYY/MM/DD/<filename>`

**Response** (always returns full event + absolute media URLs):
```json
{
  "id": 42,
  "event_type": "UPDATE",
  "title": "Field Report: Search for Survivors",
  "description": "Sector B access blocked. Water rising.",
  "created_by": "fieldunit1",
  "created_at": "2026-06-01T14:22:00Z",
  "media": [
    {
      "id": 7,
      "media_type": "image",
      "file_url": "http://host/media/report_media/2026/06/01/photo.jpg",
      "uploaded_at": "2026-06-01T14:22:01Z"
    }
  ]
}
```

### API Endpoints

#### Mobile / Field Unit Endpoints (JWT-authenticated)
```
POST /api/token/                       — Obtain JWT (returns user_id, username, role, unit_id, unit_type)
POST /api/token/refresh/               — Refresh access token
GET  /api/tasks/?mock_unit=<id>        — List tasks for a specific routine unit ID
PATCH /api/tasks/<id>/                 — Update task status (fieldunit role only)
POST /api/push-token/                  — Register Expo push token for a unit
     { mock_unit_id, token }
POST /api/field/add-event/             — Submit field report (text + optional files)
     ?fieldId=<id>
     Content-Type: multipart/form-data or application/json
```

#### Mobile Bridge Endpoints (open — called by dashboard JS and mobile app)
```
POST /api/mobile/register-units/       — Dashboard registers its routine unit list
     { units: [{ id, name, type }] }   — stored in-memory for mobile unit selection
GET  /api/mobile/units/?type=POLICE    — Returns routine units for unit selection screen
                                         type: POLICE | FIRE | MEDICAL
POST /api/mobile/dispatch/             — Dashboard mirrors a dispatch to DB + push
     { incident_id, incident_title, location_lat, location_lng, priority, units }
```

#### Regional Dashboard Endpoints
```
GET  /api/mock/incidents/
GET  /api/mock/units/
GET  /api/mock/events/
GET  /api/mock/incidents/<id>/
PATCH /api/mock/incidents/<id>/status/
PATCH /api/mock/incidents/<id>/priority/
POST /api/mock/incidents/<id>/assign/
POST /api/mock/incidents/<id>/note/
GET  /api/mock/updates/stream/          — SSE stream
```

#### Field Command Endpoints
```
GET  /api/field/incident/
GET  /api/field/sectors/
GET  /api/field/task-groups/
GET  /api/field/events/
PATCH /api/field/sectors/<id>/
PATCH /api/field/task-groups/<id>/
PATCH /api/field/casualty-update/
POST /api/field/add-event/             — Also stores DB-persisted IncidentEvent + ReportMedia
GET  /api/field/simulate/
GET  /api/field/updates/stream/        — SSE stream
```

#### Media Serving (development)
```
GET  /media/<path>                     — Served by Django staticfiles helper (DEBUG=True only)
```

---

## Frontend Architecture

### State Management

#### Session Scoping of Dispatch Assignments (v3.0 change)

`ecm-dispatch-assignments` was migrated from `localStorage` to `sessionStorage`.

**Why this matters:**
- `localStorage` persisted dispatch assignments indefinitely across browser sessions, causing ghost routes on the map when the referenced mock incidents no longer existed in a new session.
- `sessionStorage` is scoped to the current browser tab and wiped automatically when the tab is closed, ensuring every new session starts clean.
- Page refreshes within the same tab still work — in-progress dispatches resume normally.

| Storage key | Store | Scope |
|---|---|---|
| `ecm-dashboard-ui` | `useDashboardStore` (persist) | `localStorage` — intentionally durable (UI prefs) |
| `ecm-dispatch-assignments` | `fieldIncident.js` | `sessionStorage` — session-scoped (mock data) |
| `fieldId` | `fieldIncident.js` | `localStorage` — durable per-station config |
| `userRole` | `DashboardSelector.jsx` | `localStorage` — durable role preference |

**One-time cleanup:** On Dashboard mount, `localStorage.removeItem('ecm-dispatch-assignments')` removes any stale key left by older builds.

#### Autonomous Data Synchronization Flow

```
ON DISPATCH:
  dispatchUnitsToIncident({ unitIds, incidentId, … })
  → units set EN_ROUTE, OSRM route fetched
  → sessionStorage['ecm-dispatch-assignments'] updated
  → POST /api/mobile/dispatch/ (fire-and-forget) → DB Task + push notification

ON ARRIVAL (moveUnits() detects destination reached):
  → unit.status = 'ON_SCENE'
  → arrived unitIds removed from sessionStorage['ecm-dispatch-assignments']

ON PAGE REFRESH (Dashboard.jsx initializeData):
  → localStorage.removeItem('ecm-dispatch-assignments')  // one-time cleanup (legacy key)
  → read sessionStorage['ecm-dispatch-assignments']
  → if entries exist: call dispatchUnitsToIncident({ …, silent: true }) per group
      silent = true: skips voice synthesis, event-log entries, and backend bridge call on restore
  → set affected incidents IN_PROGRESS

ON NEW SESSION (tab closed and reopened):
  → sessionStorage is cleared automatically by the browser
  → no ghost routes, no stale assignments
  → dispatch state starts clean
```

#### Field Incident Store Key Fields
```javascript
{
  units:        Unit[],        // active dispatch + simulation units
  routineUnits: Unit[],        // nationwide patrol units (50, generated on load)
  majorIncident: Incident|null,
  mode:         'ROUTINE' | 'SIMULATION' | 'LIVE',
  incidents:    Incident[],
  fieldId:      string,
}
```

**Routine unit generation:** On store module load, `generateNationwideUnits(50)` creates 50 units with IDs `routine-1`…`routine-50`, names `"Unit 1"`…`"Unit 50"`, and types `POLICE`/`FIRE`/`MEDICAL` (random). Immediately after generation, all 50 units are POSTed to `POST /api/mobile/register-units/` so the mobile app can display the same unit list.

**Dispatch bridge:** `dispatchUnitsToIncident()` fires `POST /api/mobile/dispatch/` (fire-and-forget) after updating the store, so DB Tasks and push notifications are created for the dispatched units.

**moveUnits() guard:** If a unit's `assignedTo` incident ID does not exist in either `incidents` or `majorIncident`, the unit is frozen (not moved). This prevents phantom movement to non-existent targets and is the mechanism that made stale assignments visibly broken — now resolved by sessionStorage scoping.

### Component Architecture

```
Dashboard (Regional, /regional)
├── KPICards
├── IncidentList
├── IncidentDetailsPanel
├── MapView              ← Leaflet, EN_ROUTE dashed routes, unit markers
├── EventFeed
└── FilterBar

FieldIncidentDashboard (/field-incident)
├── SituationOverview    ← KPIs, casualty tracker, alerts
├── SectorMap            ← hazard-level grid
├── TaskGroupPanel       ← progress bars, category hierarchy
└── OperationalTimeline  ← IncidentEvent log with media thumbnails
```

### Real-Time Communication (SSE)

```
EventSource connects → connectionStatus = CONNECTING (yellow)
  ↓ onopen
connectionStatus = CONNECTED (green)
  ↓ onerror (connection_dropped)
connectionStatus = CONNECTING (yellow) → auto-reconnect 3s → 30s backoff
  ↓ onerror (parse / unexpected)
connectionStatus = DEGRADED → fallback polling every 5s
  ↓ backend unreachable at load
connectionStatus = OFFLINE  → polling + SSE retry on recovery
```

Cross-tab sync: `BroadcastChannel('field-incident-sync')` propagates mode, simulationType, units, and events between War-Room and Field Command tabs.

---

## Mobile Application Architecture

### Authentication & Unit Selection Flow
```
LoginScreen
  → POST /api/token/ { username, password }
  → Response: { access, refresh, user_id, username, role, unit_id, unit_type }
  → token stored in App.js state (not persisted to disk)
  → user context: { id, username, role, unit_type } set via UserContext
  → All subsequent requests: Authorization: Bearer <token>
                             X-User-ID: <id>
                             X-User-Role: <role>

UnitSelectScreen  (shown after login, before main navigation)
  → GET /api/mobile/units/?type=POLICE  (using unit_type from JWT)
  → Shows same units as the War-Room Dashboard ("Unit 43", "Unit 7", etc.)
  → User selects their specific unit
  → registerPushToken(unit.id) → POST /api/push-token/ { mock_unit_id, token }
  → onSelectUnit(unit) → selectedUnit = { id: 43, name: "Unit 43", type: "POLICE" }

NavigationContainer (Tasks → Report → Sync → Map)
  → All task fetches use: GET /api/tasks/?mock_unit=43
  → Header shows selected unit name ("Unit 43")
  → Menu allows: Incident Map, Sync, Change Unit, Disconnect
```

### Push Notification Flow
```
Registration (on unit select):
  Notifications.requestPermissionsAsync()
  Notifications.getExpoPushTokenAsync()
  POST /api/push-token/ { mock_unit_id: 43, token: "ExponentPushToken[...]" }
  → stored in PushToken table, keyed by mock_unit_id

Dispatch trigger (from dashboard):
  POST /api/mobile/dispatch/ receives unit { mock_unit_num: 43, type: "POLICE" }
  → PushToken.objects.filter(mock_unit_id=43)
  → POST to exp.host/--/api/v2/push/send (Expo Push API)
  → Device receives alert: "New Dispatch — [incident title] — respond immediately"
  → Tapping notification navigates to Tasks screen
```

### Polymorphic Report Submission
```
ReportScreen
  → User selects status (Pending | In Progress | Done) via pill chips
  → User optionally adds text notes
  → User optionally attaches files:
       📷 Camera   → ImagePicker.launchCameraAsync({ mediaTypes: ['images'] })
       🖼 Photos   → ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] })
       🎥 Video    → ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] })
       Max 5 attachments per report
       Content-type detection: video/* → MediaType.VIDEO, else MediaType.IMAGE

  ONLINE MODE:
    1. PATCH /api/tasks/<id>/  { status }              ← task status update (required)
    2. POST  /api/field/add-event/?fieldId=mobile       ← notes + files (non-fatal if fails)
         FormData: event_type, severity, title, description, created_by, files[]

  OFFLINE MODE:
    → saveReport(title, notes, status, null) → SQLite (expo-sqlite)
    → SyncScreen uploads to /api/incidents/ when back online
```

### Offline Sync Strategy
```
Connectivity check: @react-native-community/netinfo
  isConnected && isInternetReachable → online=true

Connection lost:
  → Alert: "Continue Offline" | "Retry"
  → Offline: reports saved to SQLite (offlineReports.db)

Back online:
  → SyncScreen auto-triggers syncNow()
  → POST each offline report to /api/incidents/
  → clearReports() removes SQLite records on success
```

---

## Storage Architecture

### Backend Storage
| Type | Location | Content |
|---|---|---|
| SQLite DB | `backend/db.sqlite3` | All model data including IncidentEvent, ReportMedia records |
| Media files | `backend/media/report_media/YYYY/MM/DD/` | Uploaded images and videos |
| Static files | `backend/static/` | Django admin static assets |

### Frontend Storage
| Key | Storage | Written by | Content |
|---|---|---|---|
| `ecm-dashboard-ui` | `localStorage` | `useDashboardStore` persist | `{ selectedIncidentId, activeFilter, filters, sortBy }` |
| `ecm-dispatch-assignments` | `sessionStorage` | `fieldIncident.js` | `[{ unitId, incidentId, incidentLat, incidentLng }]` |
| `fieldId` | `localStorage` | `fieldIncident.js` | Station field ID string |
| `userRole` | `localStorage` | `DashboardSelector.jsx` | `"FIELD_MANAGER"` or `"DISPATCHER"` |

---

## Security Architecture

### JWT Role Mapping (Active — v3.0)

JWT is now actively mapping functional operational roles to real-time client entities, replacing the earlier unlinked generic account pattern.

| Claim | Value | Enforcement |
|---|---|---|
| `role: "admin"` | Full CRUD on all resources | `IsAdminUser` + `ReadOnlyOrAdminDispatcher` |
| `role: "dispatcher"` | Read all; update incidents, assign units | `ReadOnlyOrAdminDispatcher` |
| `role: "fieldunit"` | Read assigned tasks; PATCH own task status only | `TaskPermission` |

**Token contents:**
```
Header: { alg: HS256 }
Payload: { user_id, username, role, exp, iat }
```

**Access token lifetime:** 8 hours (field shifts)
**Refresh token lifetime:** 7 days

**Request authentication on every protected call:**
```
Authorization: Bearer <access_token>
X-User-ID:    <user_id>
X-User-Role:  <role>
```

### Current Demo Limitations
- Django `DEBUG = True` in development
- SQLite (not production-grade DB)
- CORS `allow_all_origins = True` (development only)
- No HTTPS enforced locally

### Production Checklist
1. Set `DJANGO_DEBUG=0`
2. Restrict `ALLOWED_HOSTS` and CORS origins
3. Replace SQLite with PostgreSQL
4. Configure HTTPS with a reverse proxy (nginx)
5. Move `MEDIA_ROOT` to S3 or equivalent object storage
6. Add API rate limiting (django-ratelimit or nginx)
7. Rotate `SECRET_KEY` from environment variable

---

## Migrations

| Migration | Change |
|---|---|
| `0001_initial` | User, Incident, Unit, Task |
| `0002_majorincident_incidentevent_sector_taskgroup` | MajorIncident, Sector, TaskGroup, IncidentEvent |
| `0003_remove_incident_severity_incident_priority` | Replaced severity with priority on Incident |
| `0004_reportmedia` | ReportMedia model (file, media_type, FK → IncidentEvent) |
| `0005_user_unit_link_incident_mockid` | User.unit FK → Unit (OneToOne); Incident.mock_incident_id |
| `0006_task_mock_unit_pushtoken` | Task.mock_unit_id; PushToken model |

---

## Performance Considerations

- SSE updates throttled to 1–3 seconds server-side
- Unit movement loop: 500 ms client-side interval (animation smoothness)
- Event log capped at 100 most recent entries in memory
- OSRM route requests: max 3 per `moveUnits()` tick, with retry backoff
- Media uploads: quality 0.7–0.8 on mobile, max 5 files, 60s video cap

---

## Extensibility

### Adding a New Dashboard
1. **Backend:** model → migration → views → urls
2. **Mock data:** `backend/simulated/<type>_data.py`
3. **Store:** `frontend-web/src/store/<type>.js` (Zustand)
4. **Components:** `frontend-web/src/components/<type>/`
5. **Page:** `frontend-web/src/pages/<Type>Dashboard.jsx`
6. **Route:** `main.jsx` + `DashboardSelector.jsx`

### Adding a New Media Type
1. Extend `ReportMedia.MediaType` choices (`api/models.py`)
2. Update content-type detection in `field_incident_add_event` view
3. Update `appendAssets()` in `ReportScreen.js` mobile
4. Run `python manage.py makemigrations`

---

**Last Updated:** 2026-06-07
**Architecture Version:** 3.1

**Changelog v3.1:**
- Mobile app: post-login `UnitSelectScreen` — user selects specific routine unit (e.g. "Unit 43")
- Mobile app: `IncidentMapScreen` — Leaflet-style pin map of assigned incidents
- Mobile app: menu (⋮) with Incident Map, Sync, Change Unit, Disconnect
- Mobile app: background polling reduced to 8 s; flicker eliminated (no `setLoading(true)` on background polls)
- Mobile app: Expo push notifications via `expo-notifications ~0.29.0`
- Mobile app: `react-native-maps 1.20.1` for incident map
- Backend: `User.unit` OneToOne FK to `Unit`; `unit_type` added to JWT response
- Backend: `Incident.mock_incident_id`, `Task.mock_unit_id`, `PushToken` model (migrations 0005, 0006)
- Backend: `POST /api/mobile/register-units/` — stores routine unit list in memory
- Backend: `GET /api/mobile/units/` — serves routine units to mobile app for unit selection
- Backend: `POST /api/mobile/dispatch/` — mirrors dashboard dispatch to DB Tasks + Expo push
- Backend: `POST /api/push-token/` — registers device push token keyed by mock_unit_id
- Frontend (`fieldIncident.js`): registers all 50 routine units on load; bridges dispatch to backend
- 3 new sample accounts: `police/police123`, `ambulance/ambulance123`, `fire/fire123`

**Changelog v3.0:**
- `ecm-dispatch-assignments` migrated from `localStorage` → `sessionStorage` (session isolation for mock data)
- `ReportMedia` model added with `IncidentEvent` FK for multi-file polymorphic reports
- `POST /api/field/add-event/` upgraded to `MultiPartParser + FormParser + JSONParser`
- `MEDIA_ROOT` / `MEDIA_URL` configured; development media serving via `static()` helper
- JWT role mapping active: `fieldunit` / `dispatcher` / `admin` enforced server-side per request
- Mobile `ReportScreen` supports Camera, Photos, Video via `expo-image-picker ~17.0.11`
- Mobile app redesigned with `react-native-paper` Material Design components
