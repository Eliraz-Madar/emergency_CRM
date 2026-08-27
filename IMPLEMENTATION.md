# Field War-Room Dashboard - Implementation Details

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (React + Zustand + Vite)                              │
│  - Dashboard.jsx (regional, real data + live SSE)                │
│  - FieldIncidentDashboard.jsx (training simulation + real        │
│    MajorIncident/FieldCommand overlay)                           │
│  - State management (dashboard.js, fieldIncident.js)             │
│  - Cross-tab sync (BroadcastChannel)                             │
└─────────────────────────────────────────────────────────────────┘
            ▲
            │ HTTP REST + Server-Sent Events
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Backend (Django + DRF)                                         │
│  - Real REST API: Incident/Task/Unit/FieldCommand ModelViewSets  │
│  - Real "Go Live" API: MajorIncident/Sector/TaskGroup/Perimeter  │
│  - Real-time: SSE broadcast from actual writes (not a timer)     │
│  - Training-sim API (/api/field/...): in-memory mock data,       │
│    backed by backend/simulated/ (untouched by the migration)     │
└─────────────────────────────────────────────────────────────────┘
```

**As of Aug 2026, the regional dashboard and Field Command Post are fully real (DB-backed).** Only the Field Incident Command Dashboard's sector/task-group/casualty data remains a seeded mock dataset (`backend/simulated/field_incident_data.py`) — it can now optionally display a real `MajorIncident` on top if one has gone live (see "Major Incident Go-Live" below).

## Frontend Architecture

### State Management (Zustand)

#### `src/store/dashboard.js` (Regional)
- **Data**: `incidents`, `onlineUnits` (real DB `Unit` rows — the map/dispatch source of truth), `fieldCommands` (real DB `FieldCommand` rows), `events`. `units` is a legacy/demo array kept for backward compatibility.
- **Merge helpers**: `upsertOnlineUnit()` / `upsertFieldCommand()` merge-by-id-or-insert so SSE partial updates don't clobber the rest of a record; `addIncident()` dedupes by id as defense-in-depth against a duplicate SSE connection delivering the same event twice.
- **Persistence**: `zustand/middleware persist` (key `ecm-dashboard-ui`), **schema version 2**. `migrate()` discards stale `filters`/`activeFilter` shapes across two breaking changes: v0→1 standardized channel vocabulary, v1→2 dropped `CLOSED` from `DEFAULT_FILTERS.statuses` (closed incidents are hidden by default now, not just another filter option).
  - Persisted: `activeFilter`, `filters`, `sortBy`.
  - Deliberately NOT persisted: `selectedIncidentId` (so a closed/dismissed detail panel never silently reopens after refresh), `incidents`/`units`/`events` (always re-fetched from the API on load).

#### `src/store/fieldIncident.js` (Field Incident Command Dashboard + Field Command Post)
State: `majorIncident`, `fieldCommandStatus`, `fieldCommandSummary`, `sectors`, `taskGroups`, `events`, `incidents`, `routineUnits`, `units`, `mode`, `simulationType`, `simulationStep`, `fieldId`, `perimeterVersion`, plus UI/filter state.

**`fieldCommandSummary`** holds the raw `GET /api/field-commands/{fieldId}/` payload (FieldCommandSerializer shape) for the loaded real post — the single source the field dashboard's `FieldCommandAssignmentsPanel` reads (assigned incidents / forces / missions), so it shows exactly what the war-room shows for that post. Set only by `setFieldCommandData`, cleared by `reset()`. `null` in ROUTINE/SIMULATION.

**`mode` is a 4-way enum: `ROUTINE | SIMULATION | LIVE | FIELD_COMMAND`.** `LIVE` means a real `MajorIncident` has gone live; `FIELD_COMMAND` means a real `FieldCommand` post is loaded that has *not* escalated to a MajorIncident (its `majorIncident` state is a FieldCommand-shaped stand-in with `id: null`, so perimeter calls never fire against it). `fieldCommandStatus` is tracked separately from `majorIncident.status` since `FieldCommand` (ACTIVE/CLOSED) and `MajorIncident` (DECLARED/ACTIVE/STABILIZING/RECOVERY) use non-overlapping status vocabularies.

**Bug fixed (`cf4081b`, "isolate SIMULATION from LIVE data"):** `stopSimulation()` used to unconditionally overwrite `majorIncident`/`sectors` with fake routine data — including while the store was actually in `LIVE` mode, silently destroying real incident data on screen. It now guards `if (get().mode !== 'SIMULATION') return;`. Scenario units are tagged `isScenarioUnit: true` and filtered back out of `routineUnits` in `moveUnits()` so patrol units and simulation units never merge.

**Mobile bridge**: on module load, registers all 50 routine units (`POST /api/mobile/register-units/`); dispatch/cancel/status actions mirror to `/api/mobile/dispatch/`, `/cancel-dispatch/`, `/unit-status/`.

**Storage**: `localStorage['fieldId']` (durable), `sessionStorage['ecm-dispatch-assignments']` (session-scoped), `BroadcastChannel('field-incident-sync')` for cross-tab sync.

### Real-Time Connection (SSE)

**Regional dashboard:** `src/services/realtime.js` (`RealtimeService`, wraps `EventSource`) on `/api/updates/stream/`.

**Field Incident Command dashboard:** connects to its own stream, `/api/field/updates/stream/` (`connectToFieldIncidentStream()`), a separate channel. It consumes the legacy `incident_update` shape *and* the `field_command_*` actions the backend relays onto this stream (see "Central ↔ field real-time sync" above) — on a matching `field_command_id` it silently re-fetches the post so its Central Command panel + typed timeline entries track the war-room live. `fieldId` / the re-fetch fn are held in refs so the stream isn't re-subscribed on every field switch.

**Duplicate-connection bug fixed (`dc2f0ef`):** React Strict Mode's dev-only double mount→cleanup→mount could leave two `EventSource` connections open simultaneously. Fixed in `Dashboard.jsx`'s data-init `useEffect` with:
1. A `let cancelled = false` closure flag checked immediately before `new RealtimeService(...).connect()`, so the first (discarded) Strict-Mode pass's cleanup can bail out before it ever opens a connection.
2. The live connection stored in a `useRef` (not `useState`), so cleanup always targets the actual current instance instead of a stale one captured at render time.

### Component Structure
```
Dashboard.jsx (Regional)
├── KPICards, IncidentList, MapView, EventFeed, FilterBar
├── IncidentDetailsPanel   (built on shared SidePanel; hides "Close Incident" once CLOSED)
└── FieldCommandDetailsPanel  (built on shared SidePanel) — tabs: Overview / Assign / Missions / Close
    ├── Overview  → FieldCommandSummaryView (shared, read-only)
    ├── Assign    → link incidents / attach forces (excludes already-linked or CLOSED)
    ├── Missions  → FieldCommandMissionsTab — create a mission, set status/assignee
    └── Close     → Close Field Command Post form (reason + FIELD_OPERATOR/COMMAND_CENTER)

Selecting a unit / an incident / a field command on the regional map is mutually
exclusive (three effects in Dashboard.jsx) — the "Selected Vehicle" card closes
when any other selection is made or the empty map is clicked.

SidePanel — generic right-side panel shell shared by both panels above.
FieldCommandSummaryView — shared read-only render of a post's incidents / forces /
  missions / notes / metrics (used by the war-room Overview tab AND the field
  dashboard, so the two never drift). `utils/agencyMeta.js` = shared POLICE/FIRE/
  EMS/HOMEFRONT icon+colour palette (`getUnitTypeMeta` / `getIncidentChannelMeta`,
  optional 2nd-arg fallback) — also used by MapView.jsx + IncidentList.jsx.

FieldIncidentDashboard.jsx
├── FieldCommandAssignmentsPanel  ← NEW — "Central Command" panel (tabbed:
│     Incidents / Forces / Missions), first in the left column so it's visible
│     without scrolling; rows come from FieldCommandSummaryView
├── SituationOverview  — fetches the real Perimeter when mode === 'LIVE' (compacted CSS)
├── SectorMap, TaskGroupPanel, OperationalTimeline  — timeline now shows typed
│     entries for central-room assignments/missions (NOTE_KIND_META)
└── PerimeterMapPicker  — Leaflet click-to-draw polygon tool; emits ordered
                           {lat,lng}[] which the page POSTs via submitMajorIncidentPerimeter()
```

### Routing (Units)
Units use OSRM public routing for road paths and nearest-road snapping (both web dashboard and, as of Aug 2026, the mobile app's `IncidentMapScreen` via `mobile-app/utils/routing.js`). The public endpoint can rate-limit or time out — a straight-line haversine fallback route always renders in that case; for production, use a private OSRM or another routing provider.

### Styling
`src/styles.css` — CSS variables, responsive grid (1366px minimum), dark palette. Closed-status color tuned to a muted amber (`#78350f`) rather than alarm red, to visually distinguish "closed" from "critical."

## Backend Architecture

### Real Data Models — regional dashboard, Field Command Post, Major Incident Go-Live

These replaced the mock data generator entirely for the regional dashboard (Aug 2026):

- **`Incident`** — explicit forward-only state machine (`TRANSITIONS`): `OPEN → PENDING → EN_ROUTE → ON_SCENE → RESOLVED → CLOSED`, plus a legacy `IN_PROGRESS` path for rows written by the mobile-dispatch bridge. `CLOSED` is reachable only via an explicit Commander action and always requires `closed_reason` + `closed_by`. A field unit can resolve an incident only once every assigned `Task` is DONE/CANCELLED; a Commander can always override.
- **`Unit`** — `is_online` is an explicit flag set only by `/api/units/claim/` or `/heartbeat/`, never true by default. `is_actively_online` is a computed property (`is_online AND last_seen within 60s`) — no background job flips it, so a unit that stops heartbeating simply stops reporting online at read time.
- **`Task`** — terminal once DONE/CANCELLED; only a Commander can CANCEL.
- **`FieldCommand` / `FieldCommandNote` / `FieldCommandMission`** (NEW) — the real "Field Command Post" feature (right-click "Open Field Command Post" on the regional map). Closing a post cascades: releases every assigned `Unit.field_command`, force-closes every linked `Incident`.
  - **`FieldCommandNote.kind`** (`NOTE | INCIDENT_LINKED | FORCE_ASSIGNED | MISSION | STATUS`) — plain operator notes are `NOTE`; the other kinds are auto-logged by the backend whenever the central room links an incident / attaches a force / creates or advances a mission, so the field command's own Operational Timeline reflects everything it receives. Rendered with a distinct icon/type on the field dashboard (`NOTE_KIND_META` in `FieldIncidentDashboard.jsx`).
  - **`FieldCommandMission`** — a titled tasking the war-room gives a post (`title`, `details`, `status` = `OPEN | IN_PROGRESS | DONE`, optional `assigned_unit` — which must already be attached to the post). Independent of `Incident`/`Task`. Managed from the war-room panel's **Missions** tab; shown read-only on the field dashboard.
- **`MajorIncident` / `Sector` / `TaskGroup` / `Perimeter`** (NEW real models) — back the "Go Live" flow, declared from a real `Incident` by a Commander. Entirely separate from the mock `field_incident_*` endpoints, which are untouched.

### Unit Claim / Heartbeat / Disconnect

```
POST /api/units/claim/       { id }  or  { name, type }, location_lat, location_lng
  → links request.user.unit, sets is_online=True, last_seen=now, GPS from device
  → 409 if another user is actively holding the unit
  → claiming a different unit releases the previous one

POST /api/units/heartbeat/   — refresh last_seen (+ GPS); called every 25s by
                                mobile-app/utils/heartbeat.js

POST /api/units/disconnect/  — explicit logout signal (otherwise the unit falls
                                offline naturally 60s after heartbeats stop)
```

A routing-order regression was caught and regression-tested (`UnitHeartbeatRoutingTests`): `DefaultRouter`'s catch-all `units/<pk>/` route can shadow a literal `units/heartbeat/` path if the router is registered first — the heartbeat path must be declared before `router.urls` is included.

### Field Command Post API

```
GET/POST /api/field-commands/                     — lookup by field_key (public id), not pk
POST     /api/field-commands/<id>/assign-unit/     — + logs a FORCE_ASSIGNED note
POST     /api/field-commands/<id>/assign-incident/ — + logs an INCIDENT_LINKED note
GET/POST /api/field-commands/<id>/missions/        — list / create missions (POST logs a MISSION note)
PATCH    /api/field-commands/<id>/missions/<mid>/  — update status / assignee / title / details
PATCH    /api/field-commands/<id>/metrics/
POST     /api/field-commands/<id>/close/           — cascades: releases units, closes incidents
```

Every mission / assignment write returns the full `FieldCommandSerializer` shape (now also carrying `missions[]` and `operational_notes[].kind`), so the caller refreshes its panel with no extra GET.

**Central ↔ field real-time sync.** `_broadcast_realtime()` in `views.py` relays the `field_command_incident_assigned` / `field_command_unit_assigned` / `field_command_closed` / `field_command_mission_created` / `field_command_mission_updated` actions (`_FIELD_DASHBOARD_RELAYED_ACTIONS`) onto the Field Incident Command dashboard's **own** SSE stream (`/api/field/updates/stream/` — a separate channel from `/api/updates/stream/`). An open field dashboard sees the matching `field_command_id` and silently re-fetches (`applyFieldCommandData`), so its assigned incidents / forces / missions / status stay in lockstep with what the war-room shows for that post — no reload. The war-room's SSE handler already consumed these on `/api/updates/stream/`.

### Major Incident "Go Live" API

```
POST     /api/major-incidents/go-live/                       — COMMAND_CENTER only; rejects a
                                                                 second go-live on the same Incident
GET/POST /api/major-incidents/<id>/perimeter/                — FIELD_OPERATOR only for POST
GET/POST /api/major-incidents/<id>/sectors/                  — COMMAND_CENTER only for POST
GET/POST /api/major-incidents/<id>/task-groups/               — optionally links existing Sectors
```

### Training-Simulation Backend (Field Incident Command Dashboard only)

**Unchanged, deliberately untouched by the mock→real migration.** Backed by `backend/simulated/` (`mock_data.py`, `field_incident_data.py`, `realtime.py`, `mock_api_client.py`), served at `/api/field/...`, storing state in an in-memory `_field_incident_data` dict inside `views.py` (not the DB) — except for reports submitted via `add-event`, which do persist a real `IncidentEvent` + `ReportMedia`.

**Auto-simulation disabled:** the field-incident SSE stream used to randomly advance sector/task-group status on a timer (~30% chance per tick), which could silently move a task to COMPLETED with no corresponding API request in the log. That auto-tick is now commented out — state only changes via an explicit call (`/api/field/simulate/`, `PATCH /api/field/sectors/<id>/`, etc.).

### Real-Time Service

`_broadcast_realtime()` (regional) fires only from real write paths (IncidentViewSet/UnitViewSet/TaskViewSet/FieldCommandViewSet create/update, unit claim/heartbeat) — never from a timer. `_push_field_sse()` (training-sim) still exists for the mock dashboard's own event stream.

## Data Flow

### Regional Dashboard — Real Data
```
1. Dashboard mounts → GET /api/incidents/, /api/units/, /api/events/
2. Populate dashboard.js store (incidents, onlineUnits, fieldCommands)
3. Connect SSE (/api/updates/stream/) via a cancelled-flag + useRef guarded effect
4. Every real write (create/update/assign/claim/heartbeat) broadcasts an event
5. Store upserts by id; components re-render
```

### Unit Claim & Live Tracking (Mobile)
```
1. UnitSelectScreen: getDeviceLocation() → POST /api/units/claim/ {id|name+type, lat, lng}
2. On success: unit.is_online=True, user.unit set, unit GPS updated
3. heartbeat.js: startHeartbeatLoop() posts /api/units/heartbeat/ every 25s
4. IncidentMapScreen: watchDeviceLocation() + fetchRealRoute() (OSRM, haversine fallback)
5. On logout: disconnectUnit() → POST /api/units/disconnect/
6. If heartbeats stop for any reason: unit reports offline automatically after 60s
   (Unit.is_actively_online), no background job needed
```

### Field Command Post Lifecycle
```
1. Dispatcher right-clicks the regional map → "Open Field Command Post"
   → POST /api/field-commands/ {name, location_lat, location_lng[, major_incident_id]}
2. Units/incidents assigned via assign-unit/ / assign-incident/ (or an Incident's
   field_command is set directly)
3. Metrics (casualty_count, evacuated_count, incident_phase) updated via PATCH .../metrics/
4. Close: POST .../close/ {closed_reason, closed_by_role}
   → cascades: every assigned Unit.field_command = None,
     every linked Incident force-closed (closed_by=COMMAND_CENTER)
```

**Cross-panel real-time consistency (fixed 2026-08-25):** the SSE handler for `field_command_incident_assigned`/`field_command_unit_assigned` used to only patch the FieldCommand's own record (`upsertFieldCommand`) — it never touched the linked Incident's `field_command` or Unit's `field_id` in the local store. Result: an incident just linked to Field Command A kept appearing as "linkable" in every *other* open Field Command's panel (and an assigned unit kept appearing as "assignable" elsewhere) until a full page refresh. `Dashboard.jsx`'s handler now also calls `updateIncident(update.incident_id, { field_command: update.field_command_id })` / `upsertOnlineUnit({ id: update.unit_id, field_id: update.field_command_id })` on the same event, so both sides of the link update live everywhere. Note: this doesn't yet cover `field_command_closed` — that broadcast carries no incident/unit id list, so units/incidents released by a close still need a refresh to reflect as unlinked in an already-open panel.

**`sortedAssignableUnits` fixed to read `onlineUnits`, not `units` (2026-08-25):** `Dashboard.jsx` was computing the Field Command "Assign" tab's unit list from `units` — the legacy array populated once on initial load — instead of `onlineUnits`, the array SSE keeps fresh. A unit claimed from the mobile app didn't appear there until a full page refresh.

### Major Incident "Go Live" Lifecycle
```
1. Commander selects a real Incident → POST /api/major-incidents/go-live/
   {incident_id, incident_type} → creates MajorIncident (status=DECLARED), links via OneToOne
2. Field operator draws a danger-zone polygon (PerimeterMapPicker.jsx, Leaflet click-to-draw)
   → POST /api/major-incidents/<id>/perimeter/ {points: [{lat,lng}, ...]} (min 3 points)
3. Commander creates Sectors (name + hazard_level) and TaskGroups (optionally linking Sectors)
4. FieldIncidentDashboard.jsx's fieldIncident.js store switches to mode='LIVE' and
   SituationOverview.jsx fetches/re-fetches the Perimeter (perimeterVersion counter)
```

### Dispatch & Unit Routing (unchanged from prior versions)
```
1. dispatchUnitsToIncident() in fieldIncident.js → units EN_ROUTE, OSRM route fetched
2. sessionStorage['ecm-dispatch-assignments'] updated; POST /api/mobile/dispatch/ (fire-and-forget)
3. On arrival: unit → ON_SCENE; assignment removed from sessionStorage
4. On page refresh: sessionStorage assignments restored silently (silent: true — no voice/log spam)
```

## Key Design Decisions

### 1. SSE vs WebSocket — unchanged rationale (simpler, auto-fallback, sufficient for server→client)

### 2. Real data replaces mock for regional + Field Command Post, but the training simulation stays mock
- **Why:** the Field Incident Command Dashboard is explicitly a training/demo view (multi-sector large-scale incident drills) — it doesn't need to be backed by real casualty/sector data to serve that purpose, and keeping it mock avoids needing realistic seed data for every drill scenario.
- The real "Go Live" flow exists precisely so a *genuine* major incident can be projected into that same UI without touching the drill/mock code path underneath it.

### 3. State Management — Zustand, unchanged rationale; the 4-way `mode` enum in `fieldIncident.js` is the main new nuance (see above)

### 4. Explicit state machines over free-form status fields
- **Chosen** for `Incident.TRANSITIONS` and `Task.can_transition_to()` because silent invalid transitions (e.g. skipping straight to CLOSED with no closure trail) were a real risk once real dispatchers/field units could edit status directly.
- Enforced at the serializer's `validate_status()`/`validate()`, using `effective_role()` to resolve whichever of "real authenticated user" or "declared X-Actor-Role header" applies.

## Testing Scenarios

### Automated Backend Tests (`backend/api/test_*.py`)

| File | Classes | Covers |
|---|---|---|
| `test_auth.py` | `TokenObtainTests` | JWT login returns access/refresh + custom claims; rejects bad password; refresh flow |
| | `UnitHeartbeatRoutingTests` | Regression: router route-shadowing bug on `/units/heartbeat/`; location update; auth required |
| `test_endpoints.py` | `IncidentEndpointSchemaTests` | List shape; location required on create |
| | `TaskEndpointSchemaAndFilterTests` | Denormalized incident fields; `?incident=`/`?mock_unit=` filters; `by-incident` action |
| | `MobileDispatchBridgeTests` | Dispatch creates incident+task idempotently; requires location; cancel marks CANCELLED; unit-type filtering |
| | `MobileUnitStatusEndpointTests` | Missing/invalid field 400s; valid update accepted |
| | `UnitClaimingTests` | Full claim/disconnect lifecycle: default-offline, claimable filter, claim-by-id/name, conflict on active claim, re-claim releases previous unit, stale-heartbeat reports offline |
| | `FieldCommandLinkLifecycleTests` | Prevents duplicate active MajorIncident↔FieldCommand link on create/update; cascade-closes linked incidents |
| `test_permissions.py` | `TaskPermissionAuthenticationTests` | Anonymous list/patch on `/api/tasks/` rejected |
| | `TaskPermissionRoleTests` | Field unit patches only status; dispatcher can create tasks; documents a known gap (field unit can patch a task not assigned to them) |
| | `ReadOnlyOrAdminDispatcherGapTests` | **Documents (does not fix)** that anonymous users can currently create incidents / delete units |

### Manual Functional Testing
1. **Load Initial Data**: Dashboard shows real incidents/units from the DB (seeded via `create_sample_data.py`)
2. **Filter by Severity/Status**: Closed incidents hidden by default; toggle via FilterBar
3. **Dispatch a unit**: assign → OSRM route → map auto-zoom → mobile app receives push + task
4. **Claim a unit (mobile)**: select unit → GPS captured → dashboard shows it online; log out → offline within 60s
5. **Open a Field Command Post**: right-click map → create → assign units/incidents → close → verify cascade (units released, incidents force-closed)
6. **Go Live**: declare a MajorIncident from a real Incident → submit a perimeter → create sectors/task groups → verify Field Incident Command Dashboard shows the real data in `LIVE` mode
7. **Real-Time**: watch SSE-driven updates appear automatically; confirm only one connection in Network tab (no duplicate EventSource)

### Edge Cases
- Lost SSE connection: CONNECTING (yellow) while auto-reconnecting; OFFLINE (red) only if the stream can't be established at all, falling back to polling
- Stale unit: heartbeat stops → unit silently reports offline after 60s, no error surfaced
- Double "Go Live" on the same Incident: rejected with a 400 explaining it already went live
- Closing a Field Command Post with linked incidents still open: incidents are force-closed with an explicit closure reason, not left dangling
- Mobile app claims a unit while another user's Field Command panel is open: the unit appears in that panel's Assign list live, no refresh (fixed 2026-08-25 — see `sortedAssignableUnits` note above)
- Incident linked to a Field Command while a *different* Field Command's panel is open elsewhere: it disappears from that other panel's link list live (fixed 2026-08-25)

## Security Notes

⚠️ **This is a DEMO/MVP - NOT PRODUCTION READY**

- ✅ JWT authentication (simplejwt — access 8h / refresh 7d)
- ✅ Role-based checks via `effective_role()` in serializers (Incident/Task/FieldCommand/MajorIncident/Sector/Perimeter validation)
- ✅ `TaskPermission` — fieldunit can only PATCH their own task status (partially — see known gap below)
- ❌ **`ReadOnlyOrAdminDispatcher.has_permission` always returns `True`** — documented, regression-tested gap (`ReadOnlyOrAdminDispatcherGapTests`); anonymous requests can currently create/delete on Incident/Unit/FieldCommand ModelViewSets
- ❌ A field unit can currently PATCH the status of a task not assigned to them (documented in `TaskPermissionRoleTests`, not yet fixed)
- ❌ No rate limiting, no HTTPS/TLS, CORS allows all origins, no audit logging, no data encryption
- ❌ Mobile bridge endpoints (`/api/mobile/*`) remain open (no auth)

### Security Hardening Checklist
- [x] JWT authentication
- [x] Role-based access control for Task/serializer-level checks
- [ ] Fix `ReadOnlyOrAdminDispatcher` no-op
- [ ] Fix field-unit-can-patch-unassigned-task gap
- [ ] Validate all inputs; enable HTTPS; restrict CORS; add rate limiting; audit logging; encryption

## Future Enhancements

### Done since last major revision
- [x] Real database integration for regional dashboard + Field Command Post
- [x] Real Major Incident "Go Live" flow (Sector/TaskGroup/Perimeter)
- [x] Live unit tracking (claim/heartbeat/disconnect)
- [x] Automated backend test suite

### Still open
- [ ] Real database integration for the Field Incident Command Dashboard's own sector/task-group data (currently mock, with a real MajorIncident optionally layered on top)
- [ ] Fix the two documented permission gaps above
- [ ] Map clustering for 100+ incidents
- [ ] Advanced analytics & reporting
- [ ] AI-powered incident routing, predictive analytics, multi-agency CAD/RMS integration

---

**Dashboard Version:** 4.1 | **Last Updated:** 2026-08-25 | **Status:** Demo/MVP — regional dashboard and Field Command Post real; training simulation dashboard mock with real overlay
