import create from 'zustand';

/**
 * Dashboard state management using Zustand.
 * Handles incidents, units, events, filters, and real-time updates.
 */

export const useDashboardStore = create((set, get) => ({
  // Data
  incidents: [],
  units: [],
  events: [],
  
  // UI State
  selectedIncidentId: null,
  selectedUnitId: null,
  connectionStatus: 'DISCONNECTED', // DISCONNECTED, CONNECTING, CONNECTED, DEGRADED
  lastUpdateTime: null,
  demoMode: true,
  
  // Filters
  filters: {
    severities: ['LOW', 'MED', 'HIGH', 'CRITICAL'],
    statuses: ['OPEN', 'IN_PROGRESS', 'CLOSED'],
    channels: ['Police', 'Fire', 'EMS', 'Civil Defense'],
    searchText: '',
  },
  
  sortBy: 'severity', // 'severity', 'time', 'status'
  
  // Actions
  setIncidents: (incidents) => set({ incidents }),
  setUnits: (units) => set({ units }),
  setEvents: (events) => set({ events }),
  
  addIncident: (incident) => set((state) => ({
    incidents: [incident, ...state.incidents],
    lastUpdateTime: new Date(),
  })),
  
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
  
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setDemoMode: (enabled) => set({ demoMode: enabled }),
  
  updateFilters: (newFilters) => set((state) => ({
    filters: { ...state.filters, ...newFilters },
  })),
  
  setSortBy: (sortBy) => set({ sortBy }),
  
  // Get filtered and sorted incidents
  getFilteredIncidents: () => {
    const state = get();
    let incidents = state.incidents.filter(inc => {
      // Filter by severity
      if (!state.filters.severities.includes(inc.severity)) return false;
      
      // Filter by status
      if (!state.filters.statuses.includes(inc.status)) return false;
      
      // Filter by channel
      if (!state.filters.channels.includes(inc.channel)) return false;
      
      // Filter by search text
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
    
    // Sort
    incidents.sort((a, b) => {
      switch (state.sortBy) {
        case 'severity': {
          const severityOrder = { CRITICAL: 0, HIGH: 1, MED: 2, LOW: 3 };
          return (severityOrder[a.severity] || 999) - (severityOrder[b.severity] || 999);
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
}));
