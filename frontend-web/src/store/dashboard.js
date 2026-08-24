import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Channel/agency vocabulary, standardized to exactly these three values —
// no MEDICAL, no OTHER/free-text, no HomeFront/Civil Defense (deferred).
// Matches MapView.jsx's incidentForm/dispatchAgency dropdowns exactly.
const DEFAULT_FILTERS = {
  severities: ['LOW', 'MED', 'HIGH', 'CRITICAL'],
  // CLOSED deliberately excluded from the default — a closed incident is
  // done, and showing it identically to an active one in the sidebar by
  // default (checkmark aside) reads as "still needs attention." Still
  // fully viewable on demand via FilterBar's Status chip, which just adds
  // 'CLOSED' back into this same array — nothing about the ability to see
  // closed incidents was removed, only what's shown with no filter touched.
  statuses: ['OPEN', 'PENDING', 'EN_ROUTE', 'ON_SCENE', 'IN_PROGRESS', 'RESOLVED'],
  channels: ['POLICE', 'EMS', 'FIRE'],
  searchText: '',
};

/**
 * Dashboard state management using Zustand.
 * Handles incidents, units, events, filters, and real-time updates.
 *
 * UI preferences (filters, sortBy, activeFilter) are persisted to
 * localStorage so they survive page refreshes. selectedIncidentId is
 * deliberately excluded — see partialize below.
 * Live data (incidents, units, events) is always re-fetched from the backend.
 */
export const useDashboardStore = create(
  persist(
    (set, get) => ({
      // Data — NOT persisted (re-fetched from API on load)
      incidents: [],
      units: [], // mock/demo units — only used by the legacy Field Command "Assign Global Forces" list
      // Real, DB-backed Unit rows (with a live is_online). This is what the
      // map and Dispatch panel render — see
      // final changes/05_user_unit_claiming_and_live_sync.md.
      onlineUnits: [],
      events: [],
      // Real, DB-backed FieldCommand rows. Was local useState in
      // Dashboard.jsx; moved here so the SSE handler can merge remote
      // field_command_* broadcasts into it the same way onlineUnits works.
      fieldCommands: [],

      // UI State
      selectedIncidentId: null,
      selectedUnitId: null,
      selectedUnitIds: [], // Array of selected unit IDs for multi-dispatch
      connectionStatus: 'DISCONNECTED', // DISCONNECTED, CONNECTING, CONNECTED, DEGRADED
      lastUpdateTime: null,
      demoMode: true,

      // Active channel filter persisted so it survives refresh
      activeFilter: 'ALL',

      // Map zoom/flash triggers — transient, not persisted
      zoomToIncidentId: null,
      flashingIncidentId: null,

      // Filters — persisted
      filters: DEFAULT_FILTERS,

      sortBy: 'severity', // 'severity', 'time', 'status'

      // Actions
      setIncidents: (incidents) => set({ incidents }),
      setUnits: (units) => set({ units }),
      setOnlineUnits: (onlineUnits) => set({ onlineUnits }),
      setEvents: (events) => set({ events }),
      setFieldCommands: (fieldCommands) => set({ fieldCommands }),

      // Merge a partial real-unit update (from an SSE broadcast) into
      // onlineUnits by id — updates in place if known, inserts if new.
      upsertOnlineUnit: (partial) => set((state) => {
        const exists = state.onlineUnits.some((u) => u.id === partial.id);
        return {
          onlineUnits: exists
            ? state.onlineUnits.map((u) => (u.id === partial.id ? { ...u, ...partial } : u))
            : [...state.onlineUnits, partial],
          lastUpdateTime: new Date(),
        };
      }),

      // Same merge-by-id/insert-if-unknown shape as upsertOnlineUnit, keyed
      // on id (== FieldCommand.field_key, e.g. "field-2" — confirmed in
      // Stage 2, never the internal numeric pk). Closed entries are not
      // evicted here — MapView.jsx's field-command marker loop and
      // DashboardSelector.jsx already filter out status === 'CLOSED'
      // client-side, so merging a closed status in is sufficient to hide it
      // everywhere that matters without a separate remove action.
      upsertFieldCommand: (partial) => set((state) => {
        const exists = state.fieldCommands.some((f) => f.id === partial.id);
        return {
          fieldCommands: exists
            ? state.fieldCommands.map((f) => (f.id === partial.id ? { ...f, ...partial } : f))
            : [...state.fieldCommands, partial],
          lastUpdateTime: new Date(),
        };
      }),

      // Defense-in-depth against duplicate delivery (e.g. a stray second SSE
      // connection, a retried broadcast) — a true "add," not a merge like
      // upsertOnlineUnit/upsertFieldCommand: if this id is already present,
      // do nothing (updateIncident/incident_status_update already own real
      // field updates, so silently overwriting here would be the wrong
      // behavior even if it weren't a duplicate).
      addIncident: (incident) => set((state) => (
        state.incidents.some((inc) => inc.id === incident.id)
          ? state
          : { incidents: [incident, ...state.incidents], lastUpdateTime: new Date() }
      )),

      updateIncident: (incidentId, updates) => set((state) => ({
        incidents: state.incidents.map(inc =>
          inc.id === incidentId ? { ...inc, ...updates } : inc
        ),
        lastUpdateTime: new Date(),
      })),

      updateUnit: (unitId, updates) => set((state) => ({
        units: state.units.map(unit =>
          unit.id === unitId ? { ...unit, ...updates } : unit
        ),
        lastUpdateTime: new Date(),
      })),

      addEvent: (event) => set((state) => ({
        events: [event, ...state.events].slice(0, 100), // Keep last 100 events
        lastUpdateTime: new Date(),
      })),

      setSelectedIncident: (incidentId) => set({ selectedIncidentId: incidentId }),
      setSelectedUnit: (unitId) => set({ selectedUnitId: unitId }),
      setSelectedUnitIds: (unitIds) => set({ selectedUnitIds: unitIds }),
      toggleSelectedUnit: (unitId) => set((state) => ({
        selectedUnitIds: state.selectedUnitIds.includes(unitId)
          ? state.selectedUnitIds.filter(id => id !== unitId)
          : [...state.selectedUnitIds, unitId]
      })),
      clearSelectedUnits: () => set({ selectedUnitIds: [] }),

      setConnectionStatus: (status) => set({ connectionStatus: status }),
      setDemoMode: (enabled) => set({ demoMode: enabled }),
      setActiveFilter: (filter) => set({ activeFilter: filter }),

      // Map zoom: trigger MapView to fly to an incident + its dispatched units.
      // Call clearZoomToIncident() from MapView once the animation starts.
      setZoomToIncident: (id) => set({ zoomToIncidentId: id }),
      clearZoomToIncident: () => set({ zoomToIncidentId: null }),

      // Flashing marker: highlight an incident marker for ~4 s after dispatch.
      setFlashingIncident: (id) => set({ flashingIncidentId: id }),
      clearFlashingIncident: () => set({ flashingIncidentId: null }),

      updateFilters: (newFilters) => set((state) => ({
        filters: { ...state.filters, ...newFilters },
      })),

      setSortBy: (sortBy) => set({ sortBy }),

      // Get filtered and sorted incidents
      getFilteredIncidents: () => {
        const state = get();
        let incidents = state.incidents.filter(inc => {
          const sev = inc.priority || inc.severity;
          if (!state.filters.severities.includes(sev)) return false;
          if (!state.filters.statuses.includes(inc.status)) return false;
          if (!state.filters.channels.includes(inc.channel)) return false;
          if (state.filters.searchText) {
            const text = state.filters.searchText.toLowerCase();
            return (
              inc.title.toLowerCase().includes(text) ||
              inc.description.toLowerCase().includes(text) ||
              inc.location_name?.toLowerCase().includes(text)
            );
          }
          return true;
        });

        incidents.sort((a, b) => {
          switch (state.sortBy) {
            case 'severity': {
              const severityOrder = { CRITICAL: 0, HIGH: 1, MED: 2, LOW: 3 };
              const sa = a.priority || a.severity;
              const sb = b.priority || b.severity;
              return (severityOrder[sa] || 999) - (severityOrder[sb] || 999);
            }
            case 'time':
              return new Date(b.created_at) - new Date(a.created_at);
            case 'status': {
              const statusOrder = { OPEN: 0, IN_PROGRESS: 1, CLOSED: 2 };
              return (statusOrder[a.status] || 999) - (statusOrder[b.status] || 999);
            }
            default:
              return 0;
          }
        });

        return incidents;
      },

      getSelectedIncident: () => {
        const state = get();
        return state.incidents.find(inc => inc.id === state.selectedIncidentId);
      },
    }),
    {
      name: 'ecm-dashboard-ui',
      // Only persist UI preferences — live data always comes from the API.
      // selectedIncidentId is deliberately NOT persisted: the incident
      // panel should never silently reopen on a fresh page load pointing
      // at whatever was last selected — every dismiss path (X, Escape,
      // empty-map click, selecting a different incident) should be a real,
      // durable "closed" state, not something a reload can undo.
      partialize: (state) => ({
        activeFilter: state.activeFilter,
        filters: state.filters,
        sortBy: state.sortBy,
      }),
      // Bumped from the unversioned original (implicit version 0) because
      // filters.channels/statuses changed vocabulary (channel/agency
      // standardization — see "final changes" notes). A shallow merge alone
      // would leave any browser with an existing 'ecm-dashboard-ui' entry
      // stuck on the old, now-incompatible values forever. migrate() below
      // discards the persisted filters/activeFilter and falls back to the
      // fresh defaults instead of trying to translate old values.
      //
      // Bumped again, 1 -> 2: DEFAULT_FILTERS.statuses no longer includes
      // CLOSED. Same reasoning as the first bump — anyone already on
      // version 1 has 'CLOSED' baked into their persisted filters.statuses
      // array, and a shallow merge would leave it there forever. migrate()
      // already unconditionally discards the persisted filters/activeFilter
      // in favor of DEFAULT_FILTERS regardless of the old version, so no
      // change to migrate()'s body was needed — only the version bump.
      version: 2,
      migrate: (persistedState) => {
        const old = (persistedState && typeof persistedState === 'object') ? persistedState : {};
        return {
          activeFilter: 'ALL',
          filters: DEFAULT_FILTERS,
          sortBy: old.sortBy ?? 'severity',
        };
      },
    }
  )
);
