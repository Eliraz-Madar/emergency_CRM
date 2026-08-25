# Emergency CRM - Field War-Room Dashboard

![Status](https://img.shields.io/badge/status-in%20progress-yellow)
![Stack](https://img.shields.io/badge/stack-Django%20%7C%20React%20%7C%20React%20Native-blue)
![License](https://img.shields.io/badge/project-BSc%20Final%20Year-green)


A full-stack emergency response coordination system with a web dispatcher dashboard, a field mobile app for Android/iOS, and a shared Django REST backend.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.9+, Django 5.0, Django REST Framework, SQLite |
| Auth | JWT (djangorestframework-simplejwt) |
| Real-time | Server-Sent Events (SSE) |
| Web Frontend | React 18, Vite 5, Zustand, Leaflet, Axios |
| Mobile App | React Native 0.83, Expo 55, React Navigation 6, expo-sqlite |
| Routing API | OSRM (public, no key required) |

---

## Quick Start

### Prerequisites

- Python 3.9+
- Node.js 16+ with npm
- A Python virtual environment at the repo root: `py -m venv .venv`
- Expo Go app on your phone (or an Android emulator) for the mobile app

### Run Everything (Windows)

```bat
run_project.bat
```

Requires `.venv\Scripts\python.exe` to already exist at the repo root (the script checks and exits with instructions if it's missing). It opens three terminal windows:
- **Backend** — installs `requirements.txt`, runs `migrate`, seeds sample data, starts Django on `http://localhost:8000`
- **Frontend** — starts Vite dev server on `http://localhost:5173`
- **Mobile** — starts Expo; scan the QR code with Expo Go on your phone

> After the terminals open, press **`r`** in the Mobile terminal to reload the bundle if it shows a cached version.

---

## Authentication

The system uses JWT tokens. The sample data script creates these accounts automatically:

| Username | Password | Role | Notes |
|---|---|---|---|
| `police` | `Police123` | fieldunit | Police unit — mobile app login |
| `ambulance` | `Ambulance123` | fieldunit | Ambulance (EMS) — mobile app login |
| `fire` | `Fire123` | fieldunit | Fire unit — mobile app login |
| `fieldunit1` | `test123` | fieldunit | Legacy test account, no unit link |

Field-unit users log in, then either pick a routine unit from the legacy list (`/api/mobile/units/`) or **claim** a real DB unit directly (`POST /api/units/claim/`), which marks it online and starts sending live GPS heartbeats every 25s.

To create additional users via Django shell:
```bash
cd backend
python manage.py createsuperuser
```

---

## Web Dashboard

Open `http://localhost:5173` in your browser.

### Two Dashboards

#### Regional Dashboard — `http://localhost:5173/regional`

Coordinates multiple incidents across a region, backed by real DB data (not simulated).

- Live incident list with sorting, filtering, and search — closed incidents hidden by default
- Explicit status workflow: Open → Pending → En Route → On Scene → Resolved → Closed (Closed requires a reason and can only be set by a dispatcher/admin)
- Severity/priority levels: LOW, MED, HIGH, CRITICAL with color coding
- Unit dispatch with road routing (OSRM) — dispatched units travel to the incident on the map in real time
- Map auto-zooms to incident + dispatched units after every dispatch
- Incident marker pulses with an amber ring after dispatch for visual confirmation
- Details panel stays open after dispatch for continued monitoring
- Dispatch state survives page refresh — units resume their routes automatically on reload
- **Field Command Post**: right-click the map (or use the creation panel) to open a real command post, assign units/incidents to it, track casualty/evacuated counts, and close it — closing cascades to release its units and force-close its linked incidents
- Interactive Leaflet map with incident, unit, and field-command-post markers
- Real-time updates via SSE (new incidents/units/posts appear automatically — one live connection, no duplicates)
- KPI cards: total incidents, active, critical, available units
- All timestamps displayed in 24-hour UTC format (DD/MM/YYYY HH:MM:SS)

#### Field Incident Command Dashboard — `http://localhost:5173/field-incident`

Command-level management of a single large-scale incident (earthquake, missile strike, building collapse). This view is a **training simulation** by default (seeded mock sector/task-group data) — a dispatcher can instead **declare a real Major Incident** from an actual regional Incident ("Go Live"), which switches this dashboard into live mode showing real data.

- Situation overview with casualty tracking
- Sector-based operational map with hazard levels
- Task group hierarchy with progress tracking
- Operational timeline (decision trail)
- Critical alerts and resource tracking
- Real-time SSE simulation stream (training mode only)
- **Go Live**: declare a Major Incident from a real Incident, draw a danger-zone perimeter on the map, and create real sectors/task groups tied to it

---

## Mobile App

The mobile app runs via Expo — scan the QR code with Expo Go on your phone, or use an Android emulator.

### Screens

| Screen | How to reach | What it does |
|---|---|---|
| Login | App start | Authenticates with the backend; JWT includes unit_type |
| Unit Select | After login | Shows the same units as the dashboard (e.g. "Unit 43"); user picks their unit |
| Tasks | After unit select | Lists tasks for the selected unit; auto-refreshes every 8 s |
| Report | Tap **FILE REPORT** on a task | Updates task status; saves offline if no connection |
| Incident Map | Menu (⋮) → Incident Map | Map of incidents assigned to the selected unit |
| Sync | Menu (⋮) → Sync | Shows offline reports and syncs when back online |

### Navigation

- **REPORT** button → opens the Report screen for that task
- **Sync** button (top-right header on Tasks screen) → opens Sync screen
- Back arrow (native stack) → returns to the previous screen

### Offline Support

Reports submitted while offline are saved locally in SQLite (`offlineReports.db`). Open the Sync screen and tap **Sync** when back online to push them to the backend.

---

## Backend API

Base URL: `http://localhost:8000`

### Authentication

```bash
# Get token
curl -X POST http://localhost:8000/api/token/ \
  -H "Content-Type: application/json" \
  -d '{"username": "fieldunit1", "password": "test123"}'
```

### Endpoints

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/api/token/` | No | Obtain JWT access + refresh tokens |
| POST | `/api/token/refresh/` | No | Refresh access token |
| GET | `/api/tasks/` | Yes | List tasks (`?incident=`, `?mock_unit=`) |
| PATCH | `/api/tasks/<id>/` | Yes | Update task status |
| GET/POST | `/api/incidents/` | Partial* | List/create real incidents |
| POST | `/api/incidents/<id>/assign-unit/` | Partial* | Assign a unit (creates a Task) |
| GET/POST | `/api/units/` | Partial* | List/create real units (`?claimable=true`, `?type=`) |
| POST | `/api/units/claim/` | Yes | Claim a unit, mark it online, set GPS |
| POST | `/api/units/disconnect/` | Yes | Release the caller's claimed unit |
| POST | `/api/units/heartbeat/` | Yes | Refresh a claimed unit's last-seen + GPS |
| GET | `/api/events/` | No | Real incident event feed (`?limit=`, `?incident_id=`) |
| GET | `/api/updates/stream/` | No | Live SSE stream (real writes only) |
| GET/POST | `/api/field-commands/` | Partial* | List/create Field Command Posts |
| POST | `/api/field-commands/<id>/close/` | Partial* | Close a post (cascades to units/incidents) |
| POST | `/api/major-incidents/go-live/` | Partial* | Declare a real MajorIncident from an Incident |
| GET/POST | `/api/major-incidents/<id>/perimeter/` | Partial* | Get/submit the danger-zone perimeter |
| GET/POST | `/api/major-incidents/<id>/sectors/` | Partial* | Get/create Sectors |
| GET/POST | `/api/major-incidents/<id>/task-groups/` | Partial* | Get/create Task Groups |
| POST | `/api/push-token/` | Yes | Register Expo push token for a unit |
| POST | `/api/mobile/register-units/` | No | Dashboard registers routine units for mobile |
| GET | `/api/mobile/units/` | No | Mobile unit selection list (filtered by type) |
| POST | `/api/mobile/dispatch/` | No | Mirrors dashboard dispatch to DB + push notification |
| GET | `/api/field/incident/` | No | Training-simulation incident detail (mock) |
| GET | `/api/field/sectors/` | No | Training-simulation sector list (mock) |
| GET | `/api/field/task-groups/` | No | Training-simulation task group list (mock) |
| GET | `/api/field/events/` | No | Training-simulation event log (mock) |
| POST | `/api/field/add-event/` | No | Field report (real IncidentEvent + media, even in mock mode) |
| GET | `/api/field/updates/stream/` | No | Training-simulation SSE stream |

\* Role is checked in the request body/serializer (`X-Actor-Role` header or JWT role), not by DRF permission classes — see [ARCHITECTURE.md](ARCHITECTURE.md) for the known `ReadOnlyOrAdminDispatcher` gap.

---

## Project Structure

```
backend/
    api/
        models.py           # User, Incident, Unit, Task, FieldCommand, FieldCommandNote,
                             # MajorIncident, Sector, TaskGroup, Perimeter, IncidentEvent, ReportMedia
        views.py            # Real ModelViewSets + Field Command/Go-Live endpoints + SSE + training-sim endpoints
        serializers.py
        permissions.py      # Role-based: admin, dispatcher, fieldunit (see known gap in ARCHITECTURE.md)
        urls.py
        test_auth.py         # JWT + unit-heartbeat routing tests
        test_endpoints.py    # Incident/Task/mobile-bridge/unit-claim/field-command tests
        test_permissions.py  # Task + permission-gap regression tests
    simulated/
        mock_data.py            # Training-sim mock data generator (field-incident dashboard only)
        field_incident_data.py  # Training-sim field incident mock data generator
        realtime.py              # Training-sim SSE background service
    core/
        settings.py
    create_sample_data.py   # Seeds police/ambulance/fire units + linked users
    manage.py
    requirements.txt

frontend-web/
    src/
        pages/
            Dashboard.jsx               # Regional dashboard (real data)
            FieldIncidentDashboard.jsx  # Field incident dashboard (training sim + real Go-Live overlay)
            DashboardSelector.jsx       # Landing/selector page
        components/
            KPICards.jsx
            IncidentList.jsx
            IncidentDetailsPanel.jsx    # Built on SidePanel
            FieldCommandDetailsPanel.jsx  # Built on SidePanel
            SidePanel.jsx               # Shared right-side panel shell
            MapView.jsx
            EventFeed.jsx
            FilterBar.jsx
            field-incident/
                SituationOverview.jsx
                SectorMap.jsx
                TaskGroupPanel.jsx
                OperationalTimeline.jsx
                PerimeterMapPicker.jsx  # Leaflet click-to-draw perimeter tool
        store/
            dashboard.js        # Regional Zustand store (real incidents/units/field-commands)
            fieldIncident.js    # Field incident Zustand store (ROUTINE/SIMULATION/LIVE/FIELD_COMMAND)
        api/
            client.js           # Axios client (all endpoints)
        services/
            realtime.js         # SSE client
        utils/
            time.js             # 24-hour timestamp formatters (en-GB locale, hour12: false)
            units.js            # Distance/nearest-available-unit helpers
    package.json
    vite.config.js

mobile-app/
    App.js                  # Navigation container, auth state, JWT token
    screens/
        LoginScreen.js       # JWT login form
        UnitSelectScreen.js  # Post-login unit selection / real unit claim
        TasksScreen.js       # Task list with auto-refresh (8 s polling)
        ReportScreen.js      # Task status update (online + offline)
        SyncScreen.js        # Offline report sync
        IncidentMapScreen.js # Live route to the assigned incident (OSRM + fallback)
    utils/
        heartbeat.js         # 25s live-location heartbeat loop
        location.js          # GPS permission handling + mock fallback
        routing.js           # OSRM route fetch + straight-line fallback
    storage/
        offlineDB.js        # expo-sqlite local storage
    package.json

run_project.bat             # One-command startup (Windows) — requires .venv at repo root
```

---

## Ports

| Service | Port |
|---|---|
| Django backend | 8000 |
| Vite web frontend | 5173 |
| Expo mobile (dev) | 8081 |

---

## Troubleshooting

### "Access is denied" when running run_project.bat

Close all previous terminal windows from an earlier run, then run the bat again. Old processes may be holding ports or the DB file.

### Mobile app shows 401 error

The app requires a real JWT. Make sure:
1. The backend is running and `create_sample_data.py` has run (done automatically by `run_project.bat`)
2. You logged in on the Login screen with `fieldunit1` / `test123`
3. You pressed **`r`** in the Expo terminal to reload the bundle

### Mobile app shows "Network request failed"

The emulator uses `10.0.2.2` to reach the host machine's localhost. Make sure the Django backend is running on port 8000 before the app tries to connect.

### Port already in use

```bash
# Windows — find and kill process on port 8000
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

### Reset the database

```bash
cd backend
del db.sqlite3
python manage.py migrate
python create_sample_data.py
```

### No real-time updates on web dashboard

Verify the SSE stream is reachable:
```bash
curl http://localhost:8000/api/updates/stream/
# Should stream events continuously — press Ctrl+C to stop
```

The connection indicator in the top-right shows:
- 🟢 **CONNECTED** — SSE stream is live
- 🟡 **CONNECTING** — stream dropped, auto-reconnecting (normal after backend restart)
- 🔴 **OFFLINE** — SSE could not be established at all; falls back to polling

### Dispatched units disappeared after page refresh

The dashboard automatically restores dispatch assignments within the same browser session using `sessionStorage`. If units are not re-appearing after refresh:
1. Open DevTools → Application → Session Storage → look for `ecm-dispatch-assignments`
2. If the key is missing or empty, the session ended cleanly (tab was closed or units arrived on-scene)
3. If units still don't appear, re-dispatch the units manually

### Mobile app shows "No units registered yet"

The unit list is populated when the War-Room Dashboard loads in a browser tab. Open `http://localhost:5173/regional` first, then log in on the mobile app.

### Mobile app shows no tasks after dispatch

Make sure you selected the exact unit that was dispatched. Example: select "Unit 43" in the app, then dispatch "Unit 43" in the dashboard. Tasks are filtered strictly by unit ID.

### OSRM routing timeouts

The app uses the public OSRM service (`router.project-osrm.org`). If it is slow or rate-limited, routes on the map will be delayed. Backoff and retry are automatic.

### Mobile app's unit shows up in the sea / far from your actual location

If the phone denies location permission or GPS is disabled, the app falls back to a fixed mock coordinate (`mobile-app/utils/location.js`) so the report/claim flow still works — as of 2026-08-25 that fallback is Tel Aviv city center. Enable location permission for the app to see your real position instead.

---

## Environment Variables (optional)

Backend (`backend/` folder):
```bash
DEMO_SEED=12345        # Seed for reproducible mock data
DJANGO_DEBUG=1         # Debug mode
```

Frontend (`frontend-web/` folder):
```bash
VITE_API_URL=http://localhost:8000/api   # Default
```
