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
- **Backend** — installs `requirements.txt` (only if a dependency is missing), runs `migrate`, seeds sample data, starts Django on `http://localhost:8000`
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

Re-running `create_sample_data.py` is safe — it re-asserts each canonical user's password, unit link and role (so a locally-changed account is repaired, not skipped).

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
- Severity/priority levels: LOW, MED, HIGH, CRITICAL — every incident list (here and on the field dashboard) leads with the same coloured severity dot (green → amber → red → deep-red)
- Unit dispatch with road routing (OSRM) — a dispatched unit shows as "Awaiting acceptance" until the crew taps **On My Way** in the app, then drives to the incident on the map in real time
- The vehicle's road route, position, ETA and remaining distance come from **one shared trip object** that the mobile app reads too, so the war-room map and the phone are always in lock-step
- A spoken announcement ("Unit … is on its way / has arrived at …") fires **exactly once** per event, even with several dashboard tabs open, the dev server restarting, or the SSE reconnecting: one browser tab is elected the "speaker" via a Web Lock, a per-sentence guard blocks any repeat within 12 s, and the SSE client keeps a single connection and owns its own reconnect
- A crew whose phone disconnects mid-dispatch stays attached to the incident, greyed "Connection lost" — one click on **Cancel** removes it (no page refresh needed); it reappears live if the crew reconnects
- Map auto-zooms to incident + dispatched units after every dispatch
- Incident marker pulses with an amber ring after dispatch for visual confirmation
- Details panel stays open after dispatch for continued monitoring
- Dispatch state survives page refresh — units resume their routes automatically on reload
- **Force-typed tasks per incident**: open an incident → **🗂 Tasks** tab → pick a force (🚓 Police / 🚒 Fire / 🚑 Medical, required) and a title. The task is logged to the incident's Event Log and pushed to the field crews. Its status (Open / On it / Done) is **read-only in the war-room** — only the field crew that owns it changes it (mobile app or the field dashboard). Every status change names which force and which mobile unit made it.
- **Field Command Post**: right-click the map (or use the creation panel) to open a real command post, assign units/incidents to it, track casualty/evacuated counts, and close it — closing cascades to release its units and force-close its linked incidents (every affected dashboard updates live)
  - A post opened by escalating a single incident ("Go Live") is bound to that incident and cannot take on others — its **Assign** tab is hidden
  - Everything the post receives (incident linked, force attached, task given) is pushed live to that post's own Field Incident Command dashboard and logged to its Operational Timeline
  - **Closing or deleting an incident removes it from the post entirely** — its tasks, its field reports and its casualty figures all leave the post's dashboard (a *closed* post keeps its full record as an archive)
  - Clicking a 🎖️ marker on the map opens the post's detail panel on the right; its header has a 🧭 **Dashboard** button that opens that post's own Field Incident Command dashboard in a new tab
  - Clicking a post in the KPI "Field Command Posts" card flies the map to its 🎖️ marker
- The map opens **already framed on the current incidents** rather than a fixed centre
- Interactive Leaflet map with incident, unit, and field-command-post markers — selecting a vehicle, an incident, or a field command clears the others (one detail panel at a time)
- Real-time updates via SSE (new incidents/units/posts appear automatically — one live connection, no duplicates)
- KPI cards: active incidents, awaiting dispatch, open field command posts, and available units (broken down by force — 🚓 / 🚒 / 🚑)
- All timestamps displayed in 24-hour format (DD/MM/YYYY HH:MM:SS)

#### Field Incident Command Dashboard — `http://localhost:5173/field-incident`

Command-level management of a single large-scale incident (earthquake, missile strike, building collapse). This view is a **training simulation** by default (seeded mock sector/task-group data) — a dispatcher can instead **declare a real Major Incident** from an actual regional Incident ("Go Live"), which switches this dashboard into live mode showing real data.

- **Left column**: the field command's name + type/status badges pinned at the top, then the **Central Command** panel — two tabs, **Incidents** and **Tasks**. Each incident row leads with a severity dot and shows its own casualty figures inline. (There is no "Forces" tab — units are committed to incidents, not to the post.) Below it, **Casualty Figures** (see below)
- **Casualty Figures panel** — live post-wide totals of injured / trapped / dead / treated / evacuated, summed across every incident this post coordinates, from the mobile crews' figure reports. Updates live via SSE, no reload (the per-incident numbers are shown inline on the Incidents tab above)
- **Task board** (center) — every force-typed task for the post's incidents, grouped Police / Fire / Medical, each with its live status; editable here (the field war-room) and from the crew's mobile app
- **Forces on the ground** (right) — every unit committed to the post's incidents, grouped by agency, with live phase (Dispatched → En route → On scene → Task done → Connection lost)
- Operational timeline (decision trail) — central-room assignments/tasks show as distinct typed entries (naming the force + mobile unit on a status change), and every **field report a mobile unit sends** (status + notes + photos/videos) appears here in full, listed with the incident name and who reported it, each stamped with the full date + time — updated live, no reload. A closed event's entries leave the timeline automatically
- Real-time SSE: the training-simulation stream (training mode) and live central-room updates for a real post (incident links, force attachments, tasks, unit connect/disconnect, casualty figures)
- **Go Live**: declare a Major Incident from a real Incident, draw a danger-zone perimeter on the map, and create real sectors/task groups tied to it

---

## Mobile App

The mobile app runs via Expo — scan the QR code with Expo Go on your phone, or use an Android emulator.

### Screens

| Screen | How to reach | What it does |
|---|---|---|
| Login | App start | Authenticates with the backend; JWT includes unit_type |
| Unit Select | After login | Two sections — **units with an active dispatch** (shows the incident, "RESUME") and **available units** ("CLAIM"); pick one to claim it and start GPS heartbeats |
| Incidents | After unit select | Lists the incidents this unit is dispatched to (was "My Tasks"); auto-refreshes every 5 s. Each card: **🚗 ON MY WAY** (accept), then **✓ ARRIVED ON SCENE**, plus **🗺 ROUTE**, **🗂 MISSIONS**, **🔢 FIGURES**, and **FILE REPORT** |
| Missions | **🗂 MISSIONS** on an incident (shown when it has a field command) | The force-typed tasks the war-room assigned to your force for that incident, each with **ON IT** / **FINISHED**; polls every 10 s while open |
| Figures | **🔢 FIGURES** on an incident | Casualty headcount: stepper (±) inputs for injured / trapped / dead / treated / evacuated, prefilled from your last report. **SEND FIGURES** replaces your previous numbers and rolls them into the field war-room's totals |
| Report | Tap **FILE REPORT** on an incident | Status (En Route / In Progress / Done) + notes + photos/videos; a **Previously sent** list below the form shows this task's past reports. Saves offline if no connection |
| Incident Map | **ROUTE** on an incident, or Menu (⋮) → Incident Map | After accepting a dispatch: the OSRM road route to the incident, a moving vehicle marker, live distance + ETA, and the camera re-zooms to the route + vehicle every time you open the map |
| Sync | Menu (⋮) → Sync | Shows offline reports and syncs when back online |

### Navigation

- **ON MY WAY** → accepts the dispatch (war-room starts drawing the route)
- **ROUTE** → opens the Incident Map with the live moving route for that task
- **MISSIONS** → your force's assigned tasks for that incident (mark ON IT / FINISHED)
- **FIGURES** → submit the casualty headcount for that incident
- **FILE REPORT** → opens the Report screen for that task
- Menu (⋮) → Sync / Incident Map / Change Unit / Disconnect
- Back arrow (native stack) → returns to the previous screen

If a mobile disconnects mid-dispatch and reconnects, it resumes from its **last position before the disconnect** (not the phone's real GPS): if it was still driving, the "On My Way" button reappears; if it had already arrived, it stays parked at the incident.

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
| GET | `/api/tasks/<id>/trip/` | No | Shared en-route trip (OSRM path + accepted_at + speedup) — war-room + mobile |
| GET | `/api/tasks/<id>/reports/` | No | This task's field-report history (with media) |
| GET/POST | `/api/incidents/` | Partial* | List/create real incidents |
| POST | `/api/incidents/<id>/assign-unit/` | Partial* | Assign a unit (reuses a live Task or creates a fresh PENDING one — a stale CANCELLED/DONE task is never handed back) |
| POST | `/api/incidents/<id>/unassign-unit/` | Partial* | Cancel a unit's non-terminal Task (war-room "Cancel") |
| GET/POST | `/api/incidents/<id>/figures/` | Yes | GET every crew's casualty headcount; POST upserts the caller's `{injured,dead,trapped,treated,evacuated}` |
| GET/POST | `/api/units/` | Partial* | List/create real units (`?claimable=true`, `?type=`, `?with_assignment=true`) |
| POST | `/api/units/claim/` | Yes | Claim a unit, mark it online, set GPS |
| POST | `/api/units/disconnect/` | Yes | Release the caller's claimed unit |
| POST | `/api/units/heartbeat/` | Yes | Refresh a claimed unit's last-seen + GPS |
| GET | `/api/events/` | No | Real incident event feed (`?limit=`, `?incident_id=`) |
| GET | `/api/updates/stream/` | No | Live SSE stream (real writes only) |
| GET/POST | `/api/field-commands/` | Partial* | List/create Field Command Posts |
| POST | `/api/field-commands/<id>/assign-unit/` \| `/assign-incident/` | Partial* | Attach a force / link an incident (logged to the post's timeline) |
| GET/POST | `/api/field-commands/<id>/missions/` | Partial* | List (`?incident=`, `?force_type=`) / create force-typed tasks (`incident_id` + `force_type` required from the war-room) |
| PATCH | `/api/field-commands/<id>/missions/<mid>/` | Partial* | Update a task's status / assignee / text (status change logs the force + mobile unit) |
| POST | `/api/field-commands/<id>/close/` | Partial* | Close a post (cascades to units/incidents) |
| GET | `/api/field/updates/stream/` | No | Field dashboard SSE stream (sim events + relayed central-room field-command updates) |
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
        models.py           # User, Incident, Unit, Task, FieldCommand,
                             # FieldCommandNote (kind + incident FK, CASCADE),
                             # FieldCommandMission (force_type + incident FK, CASCADE),
                             # MajorIncident, Sector, TaskGroup, Perimeter,
                             # IncidentEvent, ReportMedia, IncidentFigureReport
        views.py            # Real ModelViewSets + Field Command/Go-Live endpoints + SSE + training-sim endpoints
        serializers.py
        permissions.py      # Role-based: admin, dispatcher, fieldunit (see known gap in ARCHITECTURE.md)
        urls.py
        test_auth.py         # JWT + unit-heartbeat routing tests
        test_endpoints.py    # Incident/Task/mobile-bridge/unit-claim/field-command/en-route tests
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
            IncidentDetailsPanel.jsx    # Built on SidePanel; tabs Dispatch / Tasks / Events / Major Incident / Settings
            FieldCommandDetailsPanel.jsx  # Built on SidePanel; tabs Overview / Assign / Close (Assign hidden for event-scoped posts)
            FieldCommandSummaryView.jsx   # Shared read-only post summary (war-room + field dash)
            IncidentSeverityIcon.jsx    # The one severity-dot marker used by every incident list
            SidePanel.jsx               # Shared right-side panel shell
            MapView.jsx
            EventFeed.jsx
            FilterBar.jsx
            field-incident/
                SituationOverview.jsx           # Just the field name + type/status badges (top of the left column)
                CasualtyFiguresPanel.jsx        # Live post-wide injured/trapped/dead/treated/evacuated totals
                FieldCommandAssignmentsPanel.jsx  # "Central Command" tabbed panel (Incidents / Tasks) — grows to fill the left column
                IncidentTaskBoard.jsx           # Force-grouped task board (replaced SectorMap)
                FieldForcesPanel.jsx            # Units on the ground grouped by agency + live phase (replaced TaskGroupPanel)
                OperationalTimeline.jsx
                PerimeterMapPicker.jsx  # Leaflet click-to-draw perimeter tool
        store/
            dashboard.js        # Regional Zustand store (real incidents/units/field-commands)
            fieldIncident.js    # Field incident Zustand store (ROUTINE/SIMULATION/LIVE/FIELD_COMMAND)
        api/
            client.js           # Axios client (all endpoints)
        services/
            realtime.js         # SSE client — one live EventSource per instance, owns its own reconnect
        utils/
            time.js             # 24-hour timestamp formatters (en-GB locale, hour12: false; formatDateTimeShort = DD/MM/YYYY HH:MM)
            units.js            # Distance/nearest-available-unit helpers
            agencyMeta.js       # Shared POLICE/FIRE/EMS icon (🚓/🚒/🚑) + colour palette
            incidentMeta.js     # Canonical incident-severity → colour/label map (LOW→CRITICAL)
            announce.js         # One-shot war-room announcements: window-hub dedup + per-sentence guard + Web-Lock speaker election
    package.json
    vite.config.js

mobile-app/
    App.js                  # Navigation container, auth state, JWT token; Stack: Tasks/Missions/Figures/Report/Sync/Map
    context/
        UserContext.js       # { user: {id, username, role, unit_type} }
    screens/
        LoginScreen.js       # JWT login form
        UnitSelectScreen.js  # Unit selection — "with a dispatch" / "available" split + claim (sends is_mock_location)
        TasksScreen.js       # "INCIDENTS" list (5 s polling); On My Way / Arrived; ROUTE / MISSIONS / FIGURES / FILE REPORT
        MissionsScreen.js    # Force-matched tasks for an incident — ON IT / FINISHED (10 s polling)
        FiguresScreen.js     # Casualty headcount stepper form per incident (injured/trapped/dead/treated/evacuated)
        ReportScreen.js      # Status + notes + media; "Previously sent" report history
        SyncScreen.js        # Offline report sync
        IncidentMapScreen.js # Live moving route to the assigned incident (shared trip + OSRM); re-zooms on every focus; 3 severity levels
    utils/
        heartbeat.js         # 25s live-location heartbeat loop (sends is_mock_location)
        location.js          # GPS permission handling + mock fallback
        routing.js           # OSRM route fetch + straight-line fallback
        trip.js              # Reads /api/tasks/<id>/trip/ + interpolates the vehicle (matches web)
        taskActions.js       # markOnMyWay / markArrived
        apiClient.js         # Auth header helper
    storage/
        offlineDB.js        # expo-sqlite local storage
    config.js               # API_BASE_URL (set to your machine's LAN IP)
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

### `run_project.bat` shows "ERROR: Operation cancelled by user" / "Terminate batch job (Y/N)?" on the first run

The dependency step used to run `pip install` in the foreground on every launch; on a cold start that blocked for several seconds and a stray Ctrl+C (common when launching a `.bat` from a PowerShell prompt) aborted the whole batch. The script now skips `pip install` entirely when the packages are already present, so the fragile window is gone. If you still hit it, run the batch from **cmd** (`cmd /c run_project.bat`) or by double-clicking it in Explorer rather than from PowerShell.

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

### No route / vehicle not moving on the app's Incident Map

The moving route only appears **after** the crew taps **ON MY WAY** for that task (the button is on the task card, above ROUTE / FILE REPORT). Before that the map just shows the incident pin. If it still doesn't move after accepting, check that the backend is reachable — the vehicle position comes from `GET /api/tasks/<id>/trip/`.

### Re-dispatched a unit but the mobile shows nothing

Fixed. `assign-unit` used to hand back any existing Task for that unit+incident pair, including a `CANCELLED` one left by a previous dispatch/unassign — the mobile app filters cancelled tasks out, so the crew saw nothing. It now only reuses a live task and otherwise creates a fresh `PENDING` one. Old cancelled tasks in your DB are harmless.

### Same incident shows twice in the war-room list

An old `mobile_dispatch` bug created a second "mirror" incident (same title, own task) when a real incident's id was dispatched through the bridge. This is fixed; migration `0019` merges the mirrors already in your DB — just run `python manage.py migrate`.

### A closed / deleted incident's reports or tasks still show on a field command post

Fixed. Every field-command log line and task now records the incident's own id (not its title), so closing or deleting an event removes it from the post entirely. Migrations `0023`–`0026` add the id link and clean up log lines that were mis-associated by title (e.g. two incidents both named "Theft") — run `python manage.py migrate`. A *closed* post keeps its full history as a read-only archive.

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
