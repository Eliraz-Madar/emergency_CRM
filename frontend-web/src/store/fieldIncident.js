/**
 * Field Incident Command Dashboard Store
 *
 * Manages state for large-scale incident command coordination.
 * Separate from regional dashboard store - command-level decision making.
 */

import { create } from 'zustand';
import { SCENARIOS } from '../data/simulationScenarios';

// Major Israeli cities used for unit and event placement (inland-safe centers)
const ISRAEL_CITIES = [
  { name: 'Tel Aviv', lat: 32.0853, lng: 34.7818 },
  { name: 'Jerusalem', lat: 31.7683, lng: 35.2137 },
  { name: 'Haifa', lat: 32.7940, lng: 34.9896 },
  { name: 'Beer Sheva', lat: 31.2518, lng: 34.7913 },
  { name: 'Eilat', lat: 29.5577, lng: 34.9519 },
  { name: 'Kiryat Shmona', lat: 33.2073, lng: 35.5711 },
  { name: 'Ashdod', lat: 31.8018, lng: 34.6479 },
  { name: 'Tiberias', lat: 32.7940, lng: 35.5309 },
];

// Routine event catalog
const ROUTINE_EVENT_TYPES = {
  FIRE: ['Brush Fire', 'Apartment Fire'],
  PUBLIC_ORDER: ['Shooting Incident', 'Violent Brawl'],
  ENGINEERING: ['Building Collapse'],
};

const randomChoice = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Convert km + angle to degree offsets at given latitude
const kmOffsetToDeg = (lat, km, angleRad) => {
  const degPerKmLat = 1 / 111; // ~111 km per degree latitude
  const degPerKmLng = 1 / (111 * Math.cos((lat * Math.PI) / 180) || 1);
  const dLat = Math.cos(angleRad) * km * degPerKmLat;
  const dLng = Math.sin(angleRad) * km * degPerKmLng;
  return [dLat, dLng];
};

const LAT_MIN = 29.5;
const LAT_MAX = 33.3;
const LNG_MIN = 34.2;
const LNG_MAX = 35.9;
const PATROL_STEP_DELTA = 0.003; // Visible patrol speed on country map (~300m per tick)

const clampToIsrael = (lat, lng) => {
  const safeLat = Number.isFinite(lat) ? Math.min(Math.max(lat, LAT_MIN), LAT_MAX) : LAT_MIN;
  const safeLng = Number.isFinite(lng) ? Math.min(Math.max(lng, LNG_MIN), LNG_MAX) : LNG_MIN;
  return [safeLat, safeLng];
};

export const moveUnitRandomly = (lat, lng) => {
  const nextLat = lat + (Math.random() - 0.5) * PATROL_STEP_DELTA;
  const nextLng = lng + (Math.random() - 0.5) * PATROL_STEP_DELTA;
  return clampToIsrael(nextLat, nextLng);
};

const landLatMin = 31.0;
const landLatMax = 32.5;
const landLngMin = 34.8;
const landLngMax = 35.5;

const randomLandPoint = () => {
  const lat = landLatMin + Math.random() * (landLatMax - landLatMin);
  const lng = landLngMin + Math.random() * (landLngMax - landLngMin);
  return clampToIsrael(lat, lng);
};

// Create a routine event with required and compatibility fields
export const generateRoutineEvent = () => {
  const type = randomChoice(Object.keys(ROUTINE_EVENT_TYPES));
  const subtype = randomChoice(ROUTINE_EVENT_TYPES[type]);
  const city = randomChoice(ISRAEL_CITIES);
  const rKm = 1 + Math.random() * 2; // 1–3 km offset for event location
  const theta = Math.random() * 2 * Math.PI;
  const [dLat, dLng] = kmOffsetToDeg(city.lat, rKm, theta);
  const [lat, lng] = clampToIsrael(city.lat + dLat, city.lng + dLng);

  // Priority heuristic
  const priority = (
    subtype === 'Apartment Fire' || subtype === 'Violent Brawl' ? 'HIGH' :
      subtype === 'Building Collapse' || subtype === 'Shooting Incident' ? 'CRITICAL' :
        'MED'
  );

  const event = {
    id: `evt-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    type,
    subtype,
    priority,
    status: 'OPEN',
    location_lat: lat,
    location_lng: lng,
    // Compatibility fields for any existing UI expecting these
    title: `${type.replace('_', ' ')}: ${subtype}`,
    description: `Routine ${type.toLowerCase().replace('_', ' ')}: ${subtype} reported near ${city.name}.`,
    event_type: type,
    severity: priority,
    created_at: new Date().toISOString(),
  };

  return event;
};

const generateNationwideUnits = (count = 50) => {
  const types = ['POLICE', 'FIRE', 'MEDICAL'];

  return Array.from({ length: count }).map((_, idx) => {
    // Pick random city and random 2–5 km offset
    const city = randomChoice(ISRAEL_CITIES);
    const rKm = 2 + Math.random() * 3; // 2–5 km
    const theta = Math.random() * 2 * Math.PI;
    const [dLat, dLng] = kmOffsetToDeg(city.lat, rKm, theta);

    const [lat, lng] = clampToIsrael(city.lat + dLat, city.lng + dLng);

    // Separate target waypoint near same city
    const rKmTarget = 2 + Math.random() * 3;
    const thetaTarget = Math.random() * 2 * Math.PI;
    const [tLatOff, tLngOff] = kmOffsetToDeg(city.lat, rKmTarget, thetaTarget);
    const [tLat, tLng] = clampToIsrael(city.lat + tLatOff, city.lng + tLngOff);

    return {
      id: `routine-${idx + 1}`,
      name: `Unit ${idx + 1}`,
      type: types[Math.floor(Math.random() * types.length)],
      status: 'PATROL',
      position: [lat, lng],
      targetPosition: [tLat, tLng],
      missionIncidentId: null,
      lastUpdated: Date.now() + idx,
    };
  });
};

const createRoutineUnits = () => generateNationwideUnits(50);
const buildInitialRoutineUnits = () => createRoutineUnits();
const initialRoutineUnits = buildInitialRoutineUnits();

export const useFieldIncidentStore = create((set, get) => ({
  // Major incident data
  majorIncident: null,
  sectors: [],
  taskGroups: [],
  events: [],
  incidents: [],
  routineUnits: initialRoutineUnits,
  units: initialRoutineUnits.map((u) => ({ ...u })), // Active units (patrol or simulation)

  // UI state
  selectedSector: null,
  selectedTaskGroup: null,
  connectionStatus: 'DISCONNECTED', // CONNECTED, DEGRADED, OFFLINE
  loading: true,
  error: null,

  // Filter/view state
  filterCategory: null, // Filter task groups by category
  taskStatusFilter: 'all', // all, in-progress, completed

  // Simulation state
  mode: 'ROUTINE', // 'ROUTINE' or 'SIMULATION'
  simulationType: null, // 'FIRE', 'TSUNAMI', 'EARTHQUAKE', 'MISSILE', or null
  simulationStep: 0, // Current step index in the simulation

  // Actions
  setMajorIncident: (incident) => set({ majorIncident: incident }),
  setSectors: (sectors) => set({ sectors }),
  setTaskGroups: (taskGroups) => set({ taskGroups }),
  setEvents: (events) => set({ events }),
  setUnits: (units) => set({ units }),

  setSelectedSector: (sectorName) => set({ selectedSector: sectorName }),
  setSelectedTaskGroup: (taskGroupId) => set({ selectedTaskGroup: taskGroupId }),

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  setFilterCategory: (category) => set({ filterCategory: category }),
  setTaskStatusFilter: (filter) => set({ taskStatusFilter: filter }),

  dispatchUnitsToIncident: (incidentIdOrPayload, unitIdsMaybe) =>
    set((state) => {
      const isPayloadObject = incidentIdOrPayload && typeof incidentIdOrPayload === 'object' && !Array.isArray(incidentIdOrPayload);
      const incidentId = isPayloadObject ? incidentIdOrPayload.incidentId : incidentIdOrPayload;
      const unitIds = isPayloadObject ? incidentIdOrPayload.unitIds : unitIdsMaybe;

      if (!Array.isArray(unitIds) || unitIds.length === 0 || !incidentId) {
        console.warn('Invalid dispatch payload/signature', incidentIdOrPayload, unitIdsMaybe);
        return {};
      }

      const updatedUnits = (state.units || []).map((u) =>
        unitIds.includes(u.id)
          ? { ...u, status: 'EN_ROUTE', assignedTo: incidentId }
          : u
      );

      // Also update routineUnits to keep them in sync
      const updatedRoutineUnits = (state.routineUnits || []).map((u) =>
        unitIds.includes(u.id)
          ? { ...u, status: 'EN_ROUTE', assignedTo: incidentId }
          : u
      );

      // Add dispatched units to incident.assignedUnits immutably
      const dispatchedUnits = updatedUnits.filter((u) => unitIds.includes(u.id));
      const updatedIncidents = (state.incidents || []).map((incident) => {
        if (incident.id !== incidentId) return incident;
        const existingAssigned = Array.isArray(incident.assignedUnits) ? incident.assignedUnits : [];
        const mergedMap = new Map();
        existingAssigned.forEach((u) => mergedMap.set(u.id, u));
        dispatchedUnits.forEach((u) => mergedMap.set(u.id, u));
        return {
          ...incident,
          status: 'IN_PROGRESS',
          assignedUnits: Array.from(mergedMap.values()),
        };
      });

      return { units: updatedUnits, routineUnits: updatedRoutineUnits, incidents: updatedIncidents };
    }),

  tickRoutinePatrol: () =>
    set((state) => {
      if (state.mode !== 'ROUTINE') {
        return {};
      }

      const baseUnits =
        Array.isArray(state.routineUnits) && state.routineUnits.length > 0
          ? state.routineUnits
          : createRoutineUnits();

      const speedFactor = 0.005; // visible per tick

      const updatedUnits = baseUnits.map((unit, idx) => {
        const hasPos = Array.isArray(unit.position) && unit.position.length >= 2;
        const hasTarget = Array.isArray(unit.targetPosition) && unit.targetPosition.length >= 2;

        const [currentLat, currentLng] = hasPos ? unit.position : randomLandPoint();
        const [targetLat, targetLng] = hasTarget ? unit.targetPosition : randomLandPoint();

        const dLat = targetLat - currentLat;
        const dLng = targetLng - currentLng;
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);

        let nextLat = currentLat;
        let nextLng = currentLng;
        let nextTarget = [targetLat, targetLng];

        if (dist < 0.001 || !Number.isFinite(dist)) {
          // Arrived: pick a new waypoint
          nextTarget = randomLandPoint();
        } else {
          nextLat = currentLat + dLat * speedFactor;
          nextLng = currentLng + dLng * speedFactor;
        }

        const [clampedLat, clampedLng] = clampToIsrael(nextLat, nextLng);

        return {
          ...unit,
          id: unit.id || `routine-${idx}`,
          position: [clampedLat, clampedLng],
          targetPosition: nextTarget,
          lastUpdated: Date.now(),
        };
      });

      return {
        routineUnits: updatedUnits,
        units: updatedUnits,
      };
    }),

  // Update incident data
  updateMajorIncident: (updates) =>
    set((state) => ({
      majorIncident: state.majorIncident
        ? { ...state.majorIncident, ...updates }
        : updates,
    })),

  updateSector: (sectorName, updates) =>
    set((state) => ({
      sectors: state.sectors.map((s) =>
        s.name === sectorName ? { ...s, ...updates } : s
      ),
    })),

  updateTaskGroup: (taskGroupId, updates) =>
    set((state) => ({
      taskGroups: state.taskGroups.map((tg, idx) =>
        idx === taskGroupId ? { ...tg, ...updates } : tg
      ),
    })),

  updateIncidentPriority: (incidentId, newPriority) =>
    set((state) => ({
      incidents: (state.incidents || []).map((incident) =>
        incident.id === incidentId ? { ...incident, priority: newPriority } : incident
      ),
    })),

  addEvent: (newEvent) =>
    set((state) => {
      // Check if event with same title and description already exists
      const isDuplicate = state.events.some(
        (e) => e.title === newEvent.title && e.description === newEvent.description
      );

      if (isDuplicate) {
        return {}; // Do nothing if duplicate
      }

      // Ensure event has a timestamp
      const eventWithTime = {
        ...newEvent,
        created_at: newEvent.created_at || new Date().toISOString(),
      };

      return {
        events: [eventWithTime, ...state.events].slice(0, 50), // Keep last 50 events
      };
    }),

  // Movement Engine - called every tick to update unit positions
  moveUnits: () =>
    set((state) => {
      if (!Array.isArray(state.units) || state.units.length === 0) {
        return {};
      }

      const updatedUnits = state.units.map((u) => {
        if (u.status === 'EN_ROUTE' && u.assignedTo) {
          const target = (state.incidents || []).find((i) => i.id === u.assignedTo);
          if (!target) return u;

          const currentLat = u.latitude ?? (Array.isArray(u.position) ? u.position[0] : undefined) ?? 31.77;
          const currentLng = u.longitude ?? (Array.isArray(u.position) ? u.position[1] : undefined) ?? 35.22;

          const targetLat = target.latitude ?? target.location_lat ?? target.lat;
          const targetLng = target.longitude ?? target.location_lng ?? target.lng;

          if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) {
            return u;
          }

          const dLat = (targetLat - currentLat) * 0.05;
          const dLng = (targetLng - currentLng) * 0.05;
          const nextLat = currentLat + dLat;
          const nextLng = currentLng + dLng;

          const distance = Math.sqrt((targetLat - nextLat) ** 2 + (targetLng - nextLng) ** 2);
          const arrived = distance < 0.0005;

          return {
            ...u,
            latitude: arrived ? targetLat : nextLat,
            longitude: arrived ? targetLng : nextLng,
            position: [arrived ? targetLat : nextLat, arrived ? targetLng : nextLng],
            status: arrived ? 'ON_SCENE' : 'EN_ROUTE',
            lastUpdated: Date.now(),
          };
        }

        return u;
      });

      return { units: updatedUnits };
    }),

  // Selectors
  getFilteredTaskGroups: () => {
    const state = get();
    let filtered = state.taskGroups;

    if (state.filterCategory) {
      filtered = filtered.filter((tg) => tg.category === state.filterCategory);
    }

    if (state.taskStatusFilter !== 'all') {
      filtered = filtered.filter((tg) => {
        if (state.taskStatusFilter === 'in-progress') {
          return tg.status === 'IN_PROGRESS';
        }
        if (state.taskStatusFilter === 'completed') {
          return tg.status === 'COMPLETED';
        }
        return true;
      });
    }

    return filtered.sort((a, b) => {
      // Sort by priority and progress
      const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return (
        (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3)
      );
    });
  },

  getSectorByName: (name) => {
    const state = get();
    return state.sectors.find((s) => s.name === name);
  },

  getTaskGroupsByCategory: (category) => {
    const state = get();
    return state.taskGroups.filter((tg) => tg.category === category);
  },

  // Situational awareness
  getSituationSummary: () => {
    const state = get();
    if (!state.majorIncident) return null;

    return {
      title: state.majorIncident.title,
      type: state.majorIncident.incident_type,
      status: state.majorIncident.status,
      estimatedCasualties: state.majorIncident.estimated_casualties,
      confirmedDeaths: state.majorIncident.confirmed_deaths,
      displacedPersons: state.majorIncident.displaced_persons,
      affectedRadius: state.majorIncident.radius_meters,
      sectors: state.sectors.length,
      activeSectorCount: state.sectors.filter((s) => s.status === 'ACTIVE').length,
      criticalHazards: state.sectors.filter((s) => s.hazard_level === 'CRITICAL')
        .length,
      taskGroups: state.taskGroups.length,
      tasksInProgress: state.taskGroups.filter((tg) => tg.status === 'IN_PROGRESS')
        .length,
      tasksCompleted: state.taskGroups.filter((tg) => tg.status === 'COMPLETED')
        .length,
    };
  },

  getAverageTaskProgress: () => {
    const state = get();
    if (state.taskGroups.length === 0) return 0;
    const total = state.taskGroups.reduce((sum, tg) => sum + tg.progress_percent, 0);
    return Math.round(total / state.taskGroups.length);
  },

  getCriticalAlerts: () => {
    const state = get();
    const alerts = [];

    // Critical sector hazards
    state.sectors.forEach((sector) => {
      if (sector.hazard_level === 'CRITICAL') {
        alerts.push({
          type: 'SECTOR_HAZARD',
          severity: 'CRITICAL',
          message: `${sector.name}: ${sector.hazard_description}`,
          sector: sector.name,
        });
      }
    });

    // Stalled task groups
    state.taskGroups.forEach((tg) => {
      if (tg.status === 'PAUSED' && tg.priority === 'CRITICAL') {
        alerts.push({
          type: 'STALLED_TASK',
          severity: 'HIGH',
          message: `Critical task paused: ${tg.title}`,
          taskGroup: tg.title,
        });
      }
    });

    return alerts;
  },

  reset: () => {
    const freshUnits = createRoutineUnits();
    set({
      majorIncident: null,
      sectors: [],
      taskGroups: [],
      events: [],
      routineUnits: freshUnits,
      units: freshUnits,
      selectedSector: null,
      selectedTaskGroup: null,
      connectionStatus: 'DISCONNECTED',
      loading: true,
      error: null,
      filterCategory: null,
      taskStatusFilter: 'all',
      mode: 'ROUTINE',
      simulationType: null,
      simulationStep: 0,
    });
  },

  // Helper function to generate routine baseline data
  generateRoutineData: () => {
    const routineIncident = {
      id: 1,
      title: 'Routine Operations',
      incident_type: 'ROUTINE',
      status: 'ACTIVE',
      estimated_casualties: 0,
      confirmed_deaths: 0,
      displaced_persons: 0,
      radius_meters: 5000,
      location_lat: 31.77,
      location_lng: 35.22,
    };

    const routineSectors = [
      {
        name: 'North Sector',
        status: 'ACTIVE',
        hazard_level: 'LOW',
        hazard_description: 'Normal operations - monitoring traffic and weather',
        units_deployed: 3,
        personnel_count: 9,
      },
      {
        name: 'South Sector',
        status: 'ACTIVE',
        hazard_level: 'LOW',
        hazard_description: 'Routine patrols and community engagement',
        units_deployed: 2,
        personnel_count: 6,
      },
    ];

    const routineTasks = [
      {
        title: 'Daily Equipment Check',
        description: 'Standard equipment inspection and maintenance',
        category: 'OPERATIONS',
        priority: 'LOW',
        status: 'COMPLETED',
        progress_percent: 100,
        assigned_units: 1,
      },
      {
        title: 'Community Outreach',
        description: 'Fire safety education at local schools',
        category: 'OPERATIONS',
        priority: 'LOW',
        status: 'IN_PROGRESS',
        progress_percent: 60,
        assigned_units: 2,
      },
    ];

    // Generate diverse routine events (compat fields included)
    const routineEvents = [generateRoutineEvent(), generateRoutineEvent(), generateRoutineEvent()];

    const resetUnits = createRoutineUnits();

    set({
      majorIncident: routineIncident,
      sectors: routineSectors,
      taskGroups: routineTasks,
      events: routineEvents,
      routineUnits: resetUnits,
      units: resetUnits,
      mode: 'ROUTINE',
      simulationType: null,
      simulationStep: 0,
    });
  },

  // Simulation Actions
  startSimulation: (type) => {
    if (!SCENARIOS[type]) {
      console.error(`Unknown simulation type: ${type}`);
      return;
    }

    const scenario = SCENARIOS[type];
    const firstStep = scenario[0];
    const routineUnits = Array.isArray(get().routineUnits) && get().routineUnits.length > 0
      ? get().routineUnits
      : createRoutineUnits();
    const simUnits = Array.isArray(firstStep?.units) ? firstStep.units : [];
    const combinedUnits = [...routineUnits, ...simUnits];

    // CRITICAL: Set safe defaults (never null) to prevent crashes
    set({
      mode: 'SIMULATION',
      simulationType: type,
      simulationStep: 0,
      majorIncident: {
        id: 'sim-1',
        title: `${type} EMERGENCY`,
        incident_type: type,
        status: 'INITIALIZING',
        estimated_casualties: firstStep?.stats?.estimated_casualties || 0,
        confirmed_deaths: firstStep?.stats?.confirmed_deaths || 0,
        displaced_persons: firstStep?.stats?.displaced_persons || 0,
        radius_meters: 1000,
        location_lat: firstStep?.incidentLocation?.lat || 31.77,
        location_lng: firstStep?.incidentLocation?.lng || 35.22,
      },
      sectors: [],
      taskGroups: [],
      routineUnits,
      units: combinedUnits,
      events: [{
        title: 'Simulation Started',
        description: `${type} emergency scenario activated`,
        event_type: 'SIMULATION_START',
        severity: 'HIGH',
        created_at: new Date().toISOString(),
      }],
      loading: false,
      error: null,
    });
  },

  nextSimulationStep: () => {
    const state = get();
    if (state.mode !== 'SIMULATION' || !state.simulationType) {
      return;
    }

    const scenario = SCENARIOS[state.simulationType];
    if (!scenario || state.simulationStep >= scenario.length) {
      // Simulation complete
      return;
    }

    const step = scenario[state.simulationStep];
    if (!step) return; // Safety check

    // Set incident location if available
    if (step.incidentLocation) {
      get().updateMajorIncident({
        location_lat: step.incidentLocation.lat,
        location_lng: step.incidentLocation.lng,
      });
    }

    // Append new timeline events with defensive checks
    if (step.timeline && Array.isArray(step.timeline) && step.timeline.length > 0) {
      step.timeline.forEach((event) => {
        if (event && typeof event === 'object') {
          // Ensure event has required fields
          const safeEvent = {
            ...event,
            id: event.id || `evt-${Date.now()}-${Math.random()}`,
            created_at: event.created_at || new Date().toISOString(),
          };
          get().addEvent(safeEvent);
        }
      });
    }

    // Set units for this step (merge routine patrols so map stays populated)
    if (step.units && Array.isArray(step.units)) {
      const routineUnits = Array.isArray(state.routineUnits) ? state.routineUnits : [];
      set({ units: [...routineUnits, ...step.units] });
    }

    // Add new sectors with defensive checks
    if (step.sectors && Array.isArray(step.sectors) && step.sectors.length > 0) {
      const safeSectors = step.sectors.map((sector, idx) => ({
        ...sector,
        id: sector.id || `sector-${Date.now()}-${idx}`,
        access_status: sector.access_status || 'RESTRICTED',
        estimated_survivors: sector.estimated_survivors || 0,
        primary_responder: sector.primary_responder || 'Incident Command',
      }));
      set((s) => ({
        sectors: [...(s.sectors || []), ...safeSectors],
      }));
    }

    // Add new tasks with defensive checks
    if (step.tasks && Array.isArray(step.tasks) && step.tasks.length > 0) {
      const safeTasks = step.tasks.map((task, idx) => ({
        ...task,
        id: task.id || `task-${Date.now()}-${idx}`,
        completed_subtasks: task.completed_subtasks || 0,
        total_subtasks: task.total_subtasks || 5,
        assigned_units_count: task.assigned_units || task.assigned_units_count || 1,
        commander_name: task.commander_name || 'Incident Commander',
        sector_ids: task.sector_ids || [],
        notes: task.notes || task.description || 'No additional notes',
      }));
      set((s) => ({
        taskGroups: [...(s.taskGroups || []), ...safeTasks],
      }));
    }

    // Update stats with defensive check
    if (step.stats && typeof step.stats === 'object') {
      get().updateMajorIncident(step.stats);
    }

    // Increment step
    set({ simulationStep: state.simulationStep + 1 });
  },

  stopSimulation: () => {
    // Immediately restore routine state with full objects (never null)
    const routineIncident = {
      id: 'routine-1',
      title: 'ROUTINE SECURITY OPERATIONS',
      incident_type: 'ROUTINE',
      status: 'ACTIVE MONITORING',
      estimated_casualties: 0,
      confirmed_deaths: 0,
      displaced_persons: 0,
      radius_meters: 5000,
      location_lat: 31.77,
      location_lng: 35.22,
    };

    const routineSectors = [
      {
        name: 'North Sector',
        status: 'ACTIVE',
        hazard_level: 'LOW',
        hazard_description: 'Normal operations - monitoring traffic and weather',
        units_deployed: 3,
        personnel_count: 9,
      },
      {
        name: 'South Sector',
        status: 'ACTIVE',
        hazard_level: 'LOW',
        hazard_description: 'Routine patrols and community engagement',
        units_deployed: 2,
        personnel_count: 6,
      },
    ];

    const routineTasks = [
      {
        title: 'Daily Equipment Check',
        description: 'Standard equipment inspection and maintenance',
        category: 'OPERATIONS',
        priority: 'LOW',
        status: 'COMPLETED',
        progress_percent: 100,
        assigned_units: 1,
      },
      {
        title: 'Community Outreach',
        description: 'Fire safety education at local schools',
        category: 'OPERATIONS',
        priority: 'LOW',
        status: 'IN_PROGRESS',
        progress_percent: 60,
        assigned_units: 2,
      },
    ];

    const routineEvents = [
      {
        title: 'Simulation Terminated',
        description: 'Returned to routine operations mode',
        event_type: 'SIMULATION_END',
        severity: 'LOW',
        created_at: new Date().toISOString(),
      },
      {
        title: 'Shift Change',
        description: 'Day shift relieving night shift - standard handoff',
        event_type: 'SHIFT_CHANGE',
        severity: 'LOW',
        created_at: new Date().toISOString(),
      },
    ];

    const routineUnits = Array.isArray(get().routineUnits) && get().routineUnits.length > 0
      ? get().routineUnits
      : createRoutineUnits();

    const patrolUnits = routineUnits.map((unit, idx) => ({
      ...unit,
      id: unit.id || `routine-${idx}`,
    }));

    set({
      majorIncident: routineIncident,
      sectors: routineSectors,
      taskGroups: routineTasks,
      events: routineEvents,
      routineUnits: patrolUnits,
      units: patrolUnits,
      mode: 'ROUTINE',
      simulationType: null,
      simulationStep: 0,
    });
  },
}));
