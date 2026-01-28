/**
 * Field Incident Command Dashboard Store
 *
 * Manages state for large-scale incident command coordination.
 * Separate from regional dashboard store - command-level decision making.
 */

import { create } from 'zustand';
import { SCENARIOS } from '../data/simulationScenarios';
import { calculateRoute, getNextPositionOnRoute } from '../services/routingService';

// Major Israeli cities used for unit and event placement (inland-safe centers)
const ISRAEL_CITIES = [
  // מרכז
  { name: 'Tel Aviv', lat: 32.0853, lng: 34.7818 },
  { name: 'Ramat Gan', lat: 32.0853, lng: 34.8103 },
  { name: 'Petah Tikva', lat: 32.0878, lng: 34.8879 },
  { name: 'Rishon LeZion', lat: 31.9730, lng: 34.7925 },
  { name: 'Holon', lat: 32.0167, lng: 34.7667 },
  { name: 'Rehovot', lat: 31.8944, lng: 34.8081 },
  // ירושלים והסביבה
  { name: 'Jerusalem', lat: 31.7683, lng: 35.2137 },
  { name: 'Beit Shemesh', lat: 31.7522, lng: 34.9897 },
  { name: 'Modi\'in', lat: 31.8969, lng: 35.0106 },
  // צפון
  { name: 'Haifa', lat: 32.7940, lng: 34.9896 },
  { name: 'Nazareth', lat: 32.7028, lng: 35.2978 },
  { name: 'Tiberias', lat: 32.7940, lng: 35.5309 },
  { name: 'Kiryat Shmona', lat: 33.2073, lng: 35.5711 },
  { name: 'Safed', lat: 32.9658, lng: 35.4983 },
  // דרום
  { name: 'Beer Sheva', lat: 31.2518, lng: 34.7913 },
  { name: 'Ashdod', lat: 31.8018, lng: 34.6479 },
  { name: 'Ashkelon', lat: 31.6688, lng: 34.5742 },
  { name: 'Netivot', lat: 31.4203, lng: 34.5952 },
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

// Israel land boundaries - avoiding sea areas
const LAT_MIN = 29.5;
const LAT_MAX = 33.3;
const LNG_MIN = 34.3;  // Moved east to avoid Mediterranean
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

// Land-safe boundaries for unit spawning (avoiding coastlines)
const landLatMin = 29.5;
const landLatMax = 33.2;
const landLngMin = 34.4;  // Further from coast
const landLngMax = 35.8;

const randomLandPoint = () => {
  // Pick a random city and offset from it to ensure land placement
  const city = randomChoice(ISRAEL_CITIES);
  const offsetKm = 0.5 + Math.random() * 2; // 0.5-2.5 km from city center
  const theta = Math.random() * 2 * Math.PI;
  const [dLat, dLng] = kmOffsetToDeg(city.lat, offsetKm, theta);
  return clampToIsrael(city.lat + dLat, city.lng + dLng);
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
    // Pick random city - guaranteed on land
    const city = randomChoice(ISRAEL_CITIES);
    const rKm = 1 + Math.random() * 3; // 1–4 km from city center
    const theta = Math.random() * 2 * Math.PI;
    const [dLat, dLng] = kmOffsetToDeg(city.lat, rKm, theta);

    const [lat, lng] = clampToIsrael(city.lat + dLat, city.lng + dLng);

    // Separate target waypoint near same or nearby city
    const targetCity = Math.random() > 0.7 ? randomChoice(ISRAEL_CITIES) : city;
    const rKmTarget = 1 + Math.random() * 3;
    const thetaTarget = Math.random() * 2 * Math.PI;
    const [tLatOff, tLngOff] = kmOffsetToDeg(targetCity.lat, rKmTarget, thetaTarget);
    const [tLat, tLng] = clampToIsrael(targetCity.lat + tLatOff, targetCity.lng + tLngOff);

    return {
      id: `routine-${idx + 1}`,
      name: `Unit ${idx + 1}`,
      type: types[Math.floor(Math.random() * types.length)],
      status: 'PATROL',
      position: [lat, lng],
      latitude: lat,
      longitude: lng,
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
  setMajorIncident: (incident) => set((state) => {
    if (!incident) return { majorIncident: null };
    // Also add/update the incident in the incidents array so IncidentDetailsPanel can find it
    const existingIncidents = state.incidents || [];
    const incidentIndex = existingIncidents.findIndex(i => i.id === incident.id);
    let updatedIncidents;
    if (incidentIndex >= 0) {
      updatedIncidents = [...existingIncidents];
      updatedIncidents[incidentIndex] = { ...incident };
    } else {
      updatedIncidents = [{ ...incident }, ...existingIncidents];
    }
    return { majorIncident: incident, incidents: updatedIncidents };
  }),
  setSectors: (sectors) => set({ sectors }),
  setTaskGroups: (taskGroups) => set({ taskGroups }),
  setEvents: (events) => set({ events }),
  setUnits: (units) => set({ units }),
  setIncidents: (incidents) => set({ incidents }),

  setSelectedSector: (sectorName) => set({ selectedSector: sectorName }),
  setSelectedTaskGroup: (taskGroupId) => set({ selectedTaskGroup: taskGroupId }),

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  setFilterCategory: (category) => set({ filterCategory: category }),
  setTaskStatusFilter: (filter) => set({ taskStatusFilter: filter }),

  dispatchUnitsToIncident: async (incidentIdOrPayload, unitIdsMaybe) => {
    const state = get();
    const isPayloadObject = incidentIdOrPayload && typeof incidentIdOrPayload === 'object' && !Array.isArray(incidentIdOrPayload);
    const incidentId = isPayloadObject ? incidentIdOrPayload.incidentId : incidentIdOrPayload;
    const unitIds = isPayloadObject ? incidentIdOrPayload.unitIds : unitIdsMaybe;

    console.log('🚨 Dispatching units:', unitIds, 'to incident:', incidentId);

    if (!Array.isArray(unitIds) || unitIds.length === 0 || !incidentId) {
      console.warn('Invalid dispatch payload/signature', incidentIdOrPayload, unitIdsMaybe);
      return;
    }

    // Find target incident
    const target = (state.incidents || []).find((i) => i.id === incidentId);
    if (!target) {
      console.warn('Target incident not found:', incidentId);
      return;
    }

    const targetLat = target.latitude ?? target.location_lat ?? target.lat;
    const targetLng = target.longitude ?? target.location_lng ?? target.lng;

    console.log('🎯 Target location:', targetLat, targetLng);

    // Calculate routes for all dispatched units
    const routePromises = unitIds.map(async (unitId) => {
      const unit = (state.units || []).find((u) => u.id === unitId);
      if (!unit) return { unitId, route: null };

      const unitLat = unit.latitude ?? (Array.isArray(unit.position) ? unit.position[0] : undefined) ?? 31.77;
      const unitLng = unit.longitude ?? (Array.isArray(unit.position) ? unit.position[1] : undefined) ?? 35.22;

      console.log(`🚗 Unit ${unitId} starting from:`, unitLat, unitLng);

      try {
        const apiRoute = await calculateRoute(unitLat, unitLng, targetLat, targetLng);

        // Ensure route starts EXACTLY where unit is now
        // Always prepend current position to ensure route starts from unit
        let route = apiRoute;
        if (apiRoute && apiRoute.length > 0) {
          // Always add current position as first waypoint
          route = [[unitLat, unitLng], ...apiRoute];
          console.log(`📍 Prepended current position to route for ${unitId}`);
        }

        console.log(`✅ Route calculated for unit ${unitId}:`, route?.length, 'waypoints');
        return { unitId, route };
      } catch (error) {
        console.warn(`Failed to calculate route for unit ${unitId}:`, error);
        return { unitId, route: null };
      }
    });

    const routes = await Promise.all(routePromises);
    console.log('✅ All routes calculated:', routes.length);

    set((state) => {
      const updatedUnits = (state.units || []).map((u) => {
        if (!unitIds.includes(u.id)) return u;

        const routeData = routes.find((r) => r.unitId === u.id);
        const hasRoute = routeData?.route && Array.isArray(routeData.route) && routeData.route.length > 0;

        console.log(`📍 Unit ${u.id} assigned route with ${routeData?.route?.length ?? 0} waypoints`);
        console.log(`📍 Unit ${u.id} staying at current position: [${u.latitude}, ${u.longitude}]`);
        if (hasRoute) {
          console.log(`📍 Route starts at: [${routeData.route[0][0]}, ${routeData.route[0][1]}]`);
          console.log(`📍 Route ends at: [${routeData.route[routeData.route.length - 1][0]}, ${routeData.route[routeData.route.length - 1][1]}]`);
        }

        return {
          ...u,
          status: 'EN_ROUTE',
          assignedTo: incidentId,
          route: routeData?.route || null,
          routeIndex: 0,
          // DON'T update position - keep unit where it is!
        };
      });

      // Also update routineUnits to keep them in sync
      const updatedRoutineUnits = (state.routineUnits || []).map((u) => {
        if (!unitIds.includes(u.id)) return u;

        const routeData = routes.find((r) => r.unitId === u.id);

        return {
          ...u,
          status: 'EN_ROUTE',
          assignedTo: incidentId,
          route: routeData?.route || null,
          routeIndex: 0,
          // DON'T update position - keep unit where it is!
        };
      });

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

      // Update majorIncident if it matches the incident being dispatched to
      const updatedMajorIncident = state.majorIncident && state.majorIncident.id === incidentId
        ? {
          ...state.majorIncident,
          status: 'IN_PROGRESS',
          assignedUnits: Array.isArray(state.majorIncident.assignedUnits)
            ? state.majorIncident.assignedUnits
            : []
        }
        : state.majorIncident;

      return { units: updatedUnits, routineUnits: updatedRoutineUnits, incidents: updatedIncidents, majorIncident: updatedMajorIncident };
    });
  },

  tickRoutinePatrol: () =>
    set((state) => {
      if (state.mode !== 'ROUTINE') {
        return {};
      }

      const baseUnits =
        Array.isArray(state.routineUnits) && state.routineUnits.length > 0
          ? state.routineUnits
          : createRoutineUnits();

      // Use same speed as dispatched units for consistency
      const PATROL_SPEED = 0.0005; // Same as route movement speed

      const updatedUnits = baseUnits.map((unit, idx) => {
        // Skip units that are EN_ROUTE or ON_SCENE - they should be handled by moveUnits
        if (unit.status === 'EN_ROUTE' || unit.status === 'ON_SCENE') {
          return unit;
        }

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

        if (dist < PATROL_SPEED * 2 || !Number.isFinite(dist)) {
          // Arrived: pick a new waypoint
          nextTarget = randomLandPoint();
        } else {
          // Move at constant speed towards target
          const ratio = PATROL_SPEED / dist;
          nextLat = currentLat + dLat * ratio;
          nextLng = currentLng + dLng * ratio;
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

      // Merge: keep EN_ROUTE/ON_SCENE units from current state, update patrol units
      const currentUnits = state.units || [];
      const mergedUnits = currentUnits.map(u => {
        // If unit is dispatched, keep it as-is (it's updated by moveUnits)
        if (u.status === 'EN_ROUTE' || u.status === 'ON_SCENE') {
          return u;
        }
        // Otherwise use the updated patrol version
        const updated = updatedUnits.find(upd => upd.id === u.id);
        return updated || u;
      });

      return {
        routineUnits: updatedUnits,
        units: mergedUnits,
      };
    }),

  // Update incident data
  updateMajorIncident: (updates) =>
    set((state) => {
      const updatedMajor = state.majorIncident
        ? { ...state.majorIncident, ...updates }
        : updates;

      // Also update in incidents array
      const incidents = state.incidents || [];
      const incidentIndex = incidents.findIndex(i => i.id === updatedMajor.id);
      let updatedIncidents;
      if (incidentIndex >= 0) {
        updatedIncidents = [...incidents];
        updatedIncidents[incidentIndex] = updatedMajor;
      } else {
        updatedIncidents = [updatedMajor, ...incidents];
      }

      return {
        majorIncident: updatedMajor,
        incidents: updatedIncidents
      };
    }),

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
      majorIncident: state.majorIncident && state.majorIncident.id === incidentId
        ? { ...state.majorIncident, priority: newPriority }
        : state.majorIncident,
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

      let movedCount = 0;
      const updatedUnits = state.units.map((u) => {
        if (u.status === 'EN_ROUTE' && u.assignedTo) {
          const target = (state.incidents || []).find((i) => i.id === u.assignedTo);
          if (!target) {
            console.warn(`Unit ${u.id} assigned to non-existent incident ${u.assignedTo}`);
            return u;
          }

          // Check if unit has a route before trying to move it
          if (!u.route || !Array.isArray(u.route) || u.route.length === 0) {
            console.warn(`🚨 Unit ${u.id} is EN_ROUTE but has NO ROUTE! Route value:`, u.route);
            return u;
          }

          const currentLat = u.latitude ?? (Array.isArray(u.position) ? u.position[0] : undefined) ?? 31.77;
          const currentLng = u.longitude ?? (Array.isArray(u.position) ? u.position[1] : undefined) ?? 35.22;

          const targetLat = target.latitude ?? target.location_lat ?? target.lat;
          const targetLng = target.longitude ?? target.location_lng ?? target.lng;

          if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) {
            return u;
          }

          // If unit has a route, follow it
          if (u.route && Array.isArray(u.route) && u.route.length > 0) {
            const currentIndex = u.routeIndex ?? 0;
            const targetWaypoint = u.route[Math.min(currentIndex + 5, u.route.length - 1)];
            console.log(`🚀 Moving ${u.id}: index=${currentIndex}/${u.route.length}, from [${currentLat.toFixed(4)}, ${currentLng.toFixed(4)}]`);
            console.log(`   Target waypoint ahead: [${targetWaypoint[0].toFixed(4)}, ${targetWaypoint[1].toFixed(4)}]`);

            const nextPos = getNextPositionOnRoute(
              u.route,
              currentLat,
              currentLng,
              currentIndex,
              0.0005 // Increased speed slightly for smoother movement
            );

            if (nextPos.lat !== null && nextPos.lng !== null) {
              const movedDist = Math.sqrt(
                Math.pow(nextPos.lat - currentLat, 2) + Math.pow(nextPos.lng - currentLng, 2)
              );
              console.log(`✅ ${u.id} moved to [${nextPos.lat.toFixed(4)}, ${nextPos.lng.toFixed(4)}], index=${nextPos.index}, moved=${movedDist.toFixed(6)}, arrived=${nextPos.arrived}`);
              movedCount++;
              return {
                ...u,
                latitude: nextPos.lat,
                longitude: nextPos.lng,
                position: [nextPos.lat, nextPos.lng],
                routeIndex: nextPos.index,
                status: nextPos.arrived ? 'ON_SCENE' : 'EN_ROUTE',
                lastUpdated: Date.now(),
              };
            }
          } else {
            console.warn(`Unit ${u.id} is EN_ROUTE but has no route!`);
          }

          // Fallback to straight line movement if no route
          // Use same speed as route-based movement for consistency
          const FALLBACK_SPEED = 0.0005; // Same as route movement speed
          const dLat = targetLat - currentLat;
          const dLng = targetLng - currentLng;
          const distanceToTarget = Math.sqrt(dLat * dLat + dLng * dLng);

          // If very close to target, snap to it
          if (distanceToTarget < FALLBACK_SPEED * 2) {
            movedCount++;
            return {
              ...u,
              latitude: targetLat,
              longitude: targetLng,
              position: [targetLat, targetLng],
              status: 'ON_SCENE',
              lastUpdated: Date.now(),
            };
          }

          // Move at constant speed towards target
          const ratio = FALLBACK_SPEED / distanceToTarget;
          const nextLat = currentLat + dLat * ratio;
          const nextLng = currentLng + dLng * ratio;

          movedCount++;
          return {
            ...u,
            latitude: nextLat,
            longitude: nextLng,
            position: [nextLat, nextLng],
            status: 'EN_ROUTE',
            lastUpdated: Date.now(),
          };
        }

        return u;
      });

      if (movedCount > 0) {
        console.log(`🚗 Moved ${movedCount} units this tick`);
      }

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
