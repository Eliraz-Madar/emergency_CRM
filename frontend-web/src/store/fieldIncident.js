/**
 * Field Incident Command Dashboard Store
 *
 * Manages state for large-scale incident command coordination.
 * Separate from regional dashboard store - command-level decision making.
 */

import { create } from 'zustand';
import { SCENARIOS } from '../data/simulationScenarios';
import { calculateRoute, getNextPositionOnRoute, getNearestRoadPoint } from '../services/routingService';

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

// Station locations (approximate) for realistic parking
const STATIONS = {
  POLICE: [
    { name: 'Tel Aviv Police HQ', lat: 32.0752, lng: 34.7818 },
    { name: 'Jerusalem Police HQ', lat: 31.7775, lng: 35.2057 },
    { name: 'Haifa Police HQ', lat: 32.7947, lng: 34.9893 },
    { name: 'Beer Sheva Police HQ', lat: 31.2527, lng: 34.7917 },
  ],
  FIRE: [
    { name: 'Tel Aviv Fire Station', lat: 32.0655, lng: 34.7824 },
    { name: 'Jerusalem Fire Station', lat: 31.7712, lng: 35.2132 },
    { name: 'Haifa Fire Station', lat: 32.8070, lng: 34.9966 },
    { name: 'Beer Sheva Fire Station', lat: 31.2439, lng: 34.7970 },
  ],
  MEDICAL: [
    { name: 'Tel Aviv MDA', lat: 32.0692, lng: 34.7841 },
    { name: 'Jerusalem MDA', lat: 31.7758, lng: 35.2192 },
    { name: 'Haifa MDA', lat: 32.8033, lng: 34.9878 },
    { name: 'Beer Sheva MDA', lat: 31.2581, lng: 34.8036 },
  ],
};

// Routine event catalog
const ROUTINE_EVENT_TYPES = {
  FIRE: ['Brush Fire', 'Apartment Fire'],
  PUBLIC_ORDER: ['Shooting Incident', 'Violent Brawl'],
  ENGINEERING: ['Building Collapse'],
};

const randomChoice = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomStationForType = (type) => {
  const list = STATIONS[type] || ISRAEL_CITIES;
  return randomChoice(list);
};

const getStoredFieldId = () => {
  if (typeof window === 'undefined') return 'field-1';
  try {
    return localStorage.getItem('fieldId') || 'field-1';
  } catch {
    return 'field-1';
  }
};

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
const PATROL_SPEED = 0.0005; // Same as route movement speed
const RED_LIGHT_STOP_MS = [3000, 8000];
const RANDOM_STOP_MS = [8000, 20000];
const RED_LIGHT_STOP_CHANCE = 0.02; // 2% chance per tick to pause briefly
const AUTO_RELEASE_MS = [45000, 120000]; // Ambulance waits 45s–120s before release
const ROUTE_RETRY_MS = [8000, 20000];
const MAX_ROUTE_REQUESTS_PER_TICK = 5;
const NEAREST_RETRY_MS = [20000, 45000];
const MAX_NEAREST_REQUESTS_PER_TICK = 2;

const clampToIsrael = (lat, lng) => {
  const safeLat = Number.isFinite(lat) ? Math.min(Math.max(lat, LAT_MIN), LAT_MAX) : LAT_MIN;
  const safeLng = Number.isFinite(lng) ? Math.min(Math.max(lng, LNG_MIN), LNG_MAX) : LNG_MIN;
  return [safeLat, safeLng];
};

const randomMsBetween = (minMax) => {
  const [min, max] = minMax;
  return Math.floor(min + Math.random() * (max - min));
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

    const type = types[Math.floor(Math.random() * types.length)];
    const station = randomStationForType(type);
    const isParked = Math.random() < 0.35;

    // Separate target waypoint near same or nearby city
    const targetCity = Math.random() > 0.7 ? randomChoice(ISRAEL_CITIES) : city;
    const rKmTarget = 1 + Math.random() * 3;
    const thetaTarget = Math.random() * 2 * Math.PI;
    const [tLatOff, tLngOff] = kmOffsetToDeg(targetCity.lat, rKmTarget, thetaTarget);
    const [tLat, tLng] = clampToIsrael(targetCity.lat + tLatOff, targetCity.lng + tLngOff);

    return {
      id: `routine-${idx + 1}`,
      name: `Unit ${idx + 1}`,
      type,
      status: isParked ? 'AVAILABLE' : 'PATROL',
      homeStation: station,
      isParked,
      position: isParked ? [station.lat, station.lng] : [lat, lng],
      latitude: isParked ? station.lat : lat,
      longitude: isParked ? station.lng : lng,
      targetPosition: isParked ? [station.lat, station.lng] : [tLat, tLng],
      patrolRoute: null,
      patrolIndex: 0,
      patrolRoutePending: false,
      routePending: false,
      patrolRetryAt: 0,
      routeRetryAt: 0,
      onRoad: false,
      onRoadPending: false,
      roadRetryAt: 0,
      homeStationSnap: null,
      stopUntil: null,
      onSceneAt: null,
      autoReleaseAt: null,
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
  mode: 'ROUTINE', // 'ROUTINE', 'SIMULATION', or 'LIVE'
  simulationType: null, // 'FIRE', 'TSUNAMI', 'EARTHQUAKE', 'MISSILE', or null
  simulationStep: 0, // Current step index in the simulation
  fieldId: getStoredFieldId(), // TODO(auth): load from user profile/session

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
  setMode: (mode) => set({ mode }),
  setFieldId: (fieldId) => set({ fieldId }),

  setLiveIncident: (incident) =>
    set((state) => {
      if (!incident) return { mode: 'ROUTINE' };

      const existingIncidents = state.incidents || [];
      const incidentIndex = existingIncidents.findIndex(i => i.id === incident.id);
      let updatedIncidents;
      if (incidentIndex >= 0) {
        updatedIncidents = [...existingIncidents];
        updatedIncidents[incidentIndex] = { ...incident };
      } else {
        updatedIncidents = [{ ...incident }, ...existingIncidents];
      }

      return {
        mode: 'LIVE',
        majorIncident: incident,
        incidents: updatedIncidents,
        loading: false,
        error: null,
      };
    }),

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

    // Voice notification on dispatch
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const isPlural = unitIds.length > 1;
      const friendlyUnitId = (id) => (typeof id === 'string' ? id.replace(/^routine-/, '') : id);
      const unitLabel = isPlural
        ? 'Units are en route to the incident.'
        : `Unit ${friendlyUnitId(unitIds[0])} is en route to the incident.`;
      const utterance = new SpeechSynthesisUtterance(unitLabel);
      utterance.lang = 'en-US';
      window.speechSynthesis.speak(utterance);
    }

    // Find target incident or use payload targetPosition
    const target = (state.incidents || []).find((i) => i.id === incidentId);
    const payloadTarget = isPayloadObject && Array.isArray(incidentIdOrPayload.targetPosition)
      ? incidentIdOrPayload.targetPosition
      : null;

    const targetLat = target
      ? (target.latitude ?? target.location_lat ?? target.lat)
      : (payloadTarget ? payloadTarget[0] : undefined);
    const targetLng = target
      ? (target.longitude ?? target.location_lng ?? target.lng)
      : (payloadTarget ? payloadTarget[1] : undefined);

    if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) {
      console.warn('Target incident not found and no valid targetPosition provided:', incidentId, payloadTarget);
      return;
    }

    console.log('🎯 Target location:', targetLat, targetLng);

    const findClosestRouteIndex = (routePoints, lat, lng) => {
      let bestIndex = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < routePoints.length; i += 1) {
        const p = routePoints[i];
        if (!p || p.length < 2) continue;
        const dLat = p[0] - lat;
        const dLng = p[1] - lng;
        const dist = dLat * dLat + dLng * dLng;
        if (dist < bestDist) {
          bestDist = dist;
          bestIndex = i;
        }
      }
      return bestIndex;
    };

    // Calculate routes for all dispatched units
    const routePromises = unitIds.map(async (unitId) => {
      // Get FRESH state to ensure we have the latest unit position
      const currentState = get();
      const unit = (currentState.units || []).find((u) => u.id === unitId);
      if (!unit) return { unitId, route: null };

      // Get CURRENT unit position - must be precise!
      // Prefer position array (updated by patrol), then fallback to lat/lng fields
      const hasPosition = Array.isArray(unit.position) && unit.position.length >= 2;
      const unitLat = hasPosition && Number.isFinite(unit.position[0])
        ? unit.position[0]
        : (Number.isFinite(unit.latitude) ? unit.latitude : unit.location_lat);
      const unitLng = hasPosition && Number.isFinite(unit.position[1])
        ? unit.position[1]
        : (Number.isFinite(unit.longitude) ? unit.longitude : unit.location_lng);

      console.log(`🚗 Dispatching unit ${unitId} - position: [${unitLat}, ${unitLng}] (hasPosition=${hasPosition})`);

      // Validate coordinates exist and are finite
      if (!Number.isFinite(unitLat) || !Number.isFinite(unitLng)) {
        console.warn(`🚗 Unit ${unitId} has invalid coordinates:`, { lat: unitLat, lng: unitLng, unit });
        return { unitId, route: null };
      }

      console.log(`🚗 Unit ${unitId} starting from CURRENT position: [${unitLat.toFixed(6)}, ${unitLng.toFixed(6)}]`);

      try {
        const snappedStart = await getNearestRoadPoint(unitLat, unitLng);
        const snappedTarget = await getNearestRoadPoint(targetLat, targetLng);

        const startLat = snappedStart ? snappedStart[0] : unitLat;
        const startLng = snappedStart ? snappedStart[1] : unitLng;
        const destLat = snappedTarget ? snappedTarget[0] : targetLat;
        const destLng = snappedTarget ? snappedTarget[1] : targetLng;

        const apiRoute = await calculateRoute(startLat, startLng, destLat, destLng, { allowFallback: false });

        // Ensure route starts from the CLOSEST point to current position
        let route = apiRoute;
        if (apiRoute && apiRoute.length > 0) {
          const closestIndex = findClosestRouteIndex(apiRoute, unitLat, unitLng);
          const closestPoint = apiRoute[closestIndex];
          route = apiRoute.slice(closestIndex);
          console.log(`📍 Route for ${unitId} snapped to closest index ${closestIndex} at [${closestPoint[0].toFixed(6)}, ${closestPoint[1].toFixed(6)}]`);
        }

        console.log(`✅ Route calculated for unit ${unitId}:`, route?.length, 'waypoints');
        return {
          unitId,
          route,
          startLat: startLat,
          startLng: startLng,
          targetLat: destLat,
          targetLng: destLng,
        };
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

        // Use the exact dispatch-time position if available (prevents jumping back to stale state)
        const unitLat = Number.isFinite(routeData?.startLat)
          ? routeData.startLat
          : (u.latitude ?? (Array.isArray(u.position) ? u.position[0] : undefined));
        const unitLng = Number.isFinite(routeData?.startLng)
          ? routeData.startLng
          : (u.longitude ?? (Array.isArray(u.position) ? u.position[1] : undefined));
        const assignedTarget = (Number.isFinite(routeData?.targetLat) && Number.isFinite(routeData?.targetLng))
          ? [routeData.targetLat, routeData.targetLng]
          : u.assignedTarget;

        const nextLat = hasRoute ? routeData.route[0]?.[0] : unitLat;
        const nextLng = hasRoute ? routeData.route[0]?.[1] : unitLng;

        console.log(`📍 Unit ${u.id} assigned route with ${routeData?.route?.length ?? 0} waypoints`);
        console.log(`📍 Unit ${u.id} KEEPING current position: [${unitLat}, ${unitLng}]`);
        if (hasRoute) {
          console.log(`📍 Route starts at: [${routeData.route[0][0].toFixed(6)}, ${routeData.route[0][1].toFixed(6)}]`);
          console.log(`📍 Route ends at: [${routeData.route[routeData.route.length - 1][0].toFixed(6)}, ${routeData.route[routeData.route.length - 1][1].toFixed(6)}]`);
        }

        // CRITICAL: Only update the dispatch-related fields
        // Do NOT spread ...u which would overwrite the current position
        // Instead, explicitly preserve all current fields
        return {
          ...u, // Keep current fields
          status: 'EN_ROUTE',
          assignedTo: incidentId,
          // TODO(auth/field): attach assignedFieldId here to restrict control to the target field
          assignedTarget,
          route: routeData?.route || null,
          routeIndex: 0,
          routePending: !hasRoute,
          routeRetryAt: !hasRoute ? Date.now() + randomMsBetween(ROUTE_RETRY_MS) : 0,
          patrolRoute: null,
          patrolIndex: 0,
          patrolRoutePending: false,
          patrolRetryAt: 0,
          onRoad: !!hasRoute,
          stopUntil: null,
          onSceneAt: null,
          autoReleaseAt: null,
          // Normalize position to the freshest lat/lng so MapView doesn't jump to stale position
          latitude: Number.isFinite(nextLat) ? nextLat : u.latitude,
          longitude: Number.isFinite(nextLng) ? nextLng : u.longitude,
          position: (Number.isFinite(nextLat) && Number.isFinite(nextLng)) ? [nextLat, nextLng] : u.position,
        };
      });

      // Also update routineUnits to keep them in sync
      // CRITICAL: Use units as source of truth if routineUnits missing
      const routineUnitsSource = (state.routineUnits && state.routineUnits.length > 0) ? state.routineUnits : state.units;
      const updatedRoutineUnits = (routineUnitsSource || []).map((u) => {
        if (!unitIds.includes(u.id)) return u;

        const routeData = routes.find((r) => r.unitId === u.id);
        const hasRoute = routeData?.route && Array.isArray(routeData.route) && routeData.route.length > 0;
        const unitLat = Number.isFinite(routeData?.startLat)
          ? routeData.startLat
          : (u.latitude ?? (Array.isArray(u.position) ? u.position[0] : undefined));
        const unitLng = Number.isFinite(routeData?.startLng)
          ? routeData.startLng
          : (u.longitude ?? (Array.isArray(u.position) ? u.position[1] : undefined));
        const assignedTarget = (Number.isFinite(routeData?.targetLat) && Number.isFinite(routeData?.targetLng))
          ? [routeData.targetLat, routeData.targetLng]
          : u.assignedTarget;

        const nextLat = hasRoute ? routeData.route[0]?.[0] : unitLat;
        const nextLng = hasRoute ? routeData.route[0]?.[1] : unitLng;

        return {
          ...u,
          status: 'EN_ROUTE',
          assignedTo: incidentId,
          assignedTarget,
          route: routeData?.route || null,
          routeIndex: 0,
          routePending: !hasRoute,
          routeRetryAt: !hasRoute ? Date.now() + randomMsBetween(ROUTE_RETRY_MS) : 0,
          patrolRoute: null,
          patrolIndex: 0,
          patrolRoutePending: false,
          patrolRetryAt: 0,
          onRoad: !!hasRoute,
          stopUntil: null,
          onSceneAt: null,
          autoReleaseAt: null,
          // Keep unit where it is, but normalize position to freshest lat/lng if available
          latitude: Number.isFinite(nextLat) ? nextLat : u.latitude,
          longitude: Number.isFinite(nextLng) ? nextLng : u.longitude,
          position: (Number.isFinite(nextLat) && Number.isFinite(nextLng)) ? [nextLat, nextLng] : u.position,
        };
      });

      // Add dispatched units to incident.assignedUnits immutably
      const dispatchedUnits = updatedUnits.filter((u) => unitIds.includes(u.id));

      console.log(`✅ After dispatch - EN_ROUTE units:`, dispatchedUnits.map(u => `${u.id}@[${u.position[0]},${u.position[1]}]`));
      console.log(`✅ updatedRoutineUnits EN_ROUTE:`, updatedRoutineUnits.filter(u => unitIds.includes(u.id)).map(u => `${u.id}@[${u.position[0]},${u.position[1]}]`));

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

  tickRoutinePatrol: () => {
    const state = get();
    if (state.mode !== 'ROUTINE') {
      return;
    }

    const now = Date.now();
    const baseUnits = (Array.isArray(state.routineUnits) && state.routineUnits.length > 0)
      ? state.routineUnits
      : (Array.isArray(state.units) && state.units.length > 0)
        ? state.units
        : createRoutineUnits();

    const routeRequests = [];
    const nearestRequests = [];

    const updatedUnits = baseUnits.map((unit, idx) => {
      // Skip units that are EN_ROUTE or ON_SCENE - they are handled by moveUnits
      if (unit.status === 'EN_ROUTE' || unit.status === 'ON_SCENE') {
        return unit;
      }

      const hasPos = Array.isArray(unit.position) && unit.position.length >= 2;
      const [currentLat, currentLng] = hasPos ? unit.position : randomLandPoint();

      // Keep parked units at their home station (realistic idle)
      if (unit.isParked) {
        const station = unit.homeStation || randomStationForType(unit.type);
        const parkedLat = Array.isArray(unit.homeStationSnap) ? unit.homeStationSnap[0] : station.lat;
        const parkedLng = Array.isArray(unit.homeStationSnap) ? unit.homeStationSnap[1] : station.lng;
        const shouldDepart = Math.random() < 0.02; // occasional patrol departure
        if (shouldDepart) {
          const nextTarget = randomLandPoint();
          return {
            ...unit,
            id: unit.id || `routine-${idx}`,
            isParked: false,
            status: 'PATROL',
            targetPosition: nextTarget,
            patrolRoute: null,
            patrolIndex: 0,
            patrolRoutePending: false,
            patrolRetryAt: now + randomMsBetween(ROUTE_RETRY_MS),
            stopUntil: null,
            lastUpdated: now,
          };
        }

        if (!unit.onRoad) {
          if (!unit.onRoadPending && (!Number.isFinite(unit.roadRetryAt) || now >= unit.roadRetryAt)) {
            if (nearestRequests.length < MAX_NEAREST_REQUESTS_PER_TICK) {
              nearestRequests.push({
                unitId: unit.id || `routine-${idx}`,
                lat: station.lat,
                lng: station.lng,
              });
            }
          }
          return {
            ...unit,
            id: unit.id || `routine-${idx}`,
            position: [parkedLat, parkedLng],
            latitude: parkedLat,
            longitude: parkedLng,
            targetPosition: [parkedLat, parkedLng],
            status: 'AVAILABLE',
            onRoadPending: true,
            roadRetryAt: now + randomMsBetween(NEAREST_RETRY_MS),
            lastUpdated: now,
          };
        }

        return {
          ...unit,
          id: unit.id || `routine-${idx}`,
          position: [parkedLat, parkedLng],
          latitude: parkedLat,
          longitude: parkedLng,
          targetPosition: [parkedLat, parkedLng],
          status: 'AVAILABLE',
          onRoad: true,
          onRoadPending: false,
          roadRetryAt: 0,
          lastUpdated: now,
        };
      }

      // If unit is off-road, snap to nearest road before moving
      if (!unit.onRoad) {
        if (!unit.onRoadPending && (!Number.isFinite(unit.roadRetryAt) || now >= unit.roadRetryAt)) {
          if (nearestRequests.length < MAX_NEAREST_REQUESTS_PER_TICK) {
            nearestRequests.push({
              unitId: unit.id || `routine-${idx}`,
              lat: currentLat,
              lng: currentLng,
            });
          }
        }

        return {
          ...unit,
          id: unit.id || `routine-${idx}`,
          position: [currentLat, currentLng],
          latitude: currentLat,
          longitude: currentLng,
          onRoadPending: true,
          roadRetryAt: now + randomMsBetween(NEAREST_RETRY_MS),
          lastUpdated: now,
        };
      }

      // Handle stops (red lights / random pauses)
      if (Number.isFinite(unit.stopUntil) && unit.stopUntil > now) {
        return {
          ...unit,
          id: unit.id || `routine-${idx}`,
          position: [currentLat, currentLng],
          latitude: currentLat,
          longitude: currentLng,
          lastUpdated: now,
        };
      }

      // If there is a patrol route, move along it
      if (unit.patrolRoute && Array.isArray(unit.patrolRoute) && unit.patrolRoute.length > 0) {
        const nextPos = getNextPositionOnRoute(
          unit.patrolRoute,
          currentLat,
          currentLng,
          unit.patrolIndex ?? 0,
          PATROL_SPEED
        );

        if (nextPos.lat !== null && nextPos.lng !== null && Number.isFinite(nextPos.lat) && Number.isFinite(nextPos.lng)) {
          const [clampedLat, clampedLng] = clampToIsrael(nextPos.lat, nextPos.lng);

          // Random short stop (red light)
          const shouldStop = Math.random() < RED_LIGHT_STOP_CHANCE;
          const stopUntil = shouldStop ? now + randomMsBetween(RED_LIGHT_STOP_MS) : null;

          if (nextPos.arrived) {
            const nextTarget = randomLandPoint();
            const shouldPark = Math.random() < 0.25;
            const station = unit.homeStation || randomStationForType(unit.type);
            return {
              ...unit,
              id: unit.id || `routine-${idx}`,
              position: shouldPark ? [station.lat, station.lng] : [clampedLat, clampedLng],
              latitude: shouldPark ? station.lat : clampedLat,
              longitude: shouldPark ? station.lng : clampedLng,
              patrolRoute: null,
              patrolIndex: 0,
              patrolRoutePending: false,
              patrolRetryAt: now + randomMsBetween(ROUTE_RETRY_MS),
              onRoad: true,
              onRoadPending: false,
              roadRetryAt: 0,
              targetPosition: shouldPark ? [station.lat, station.lng] : nextTarget,
              isParked: shouldPark,
              status: shouldPark ? 'AVAILABLE' : 'PATROL',
              stopUntil: shouldPark ? null : (now + randomMsBetween(RANDOM_STOP_MS)),
              lastUpdated: now,
            };
          }

          return {
            ...unit,
            id: unit.id || `routine-${idx}`,
            position: [clampedLat, clampedLng],
            latitude: clampedLat,
            longitude: clampedLng,
            patrolIndex: nextPos.index,
            onRoad: true,
            onRoadPending: false,
            roadRetryAt: 0,
            stopUntil,
            lastUpdated: now,
          };
        }
      }

      // No patrol route yet: pick/keep a target and request a route
      const hasTarget = Array.isArray(unit.targetPosition) && unit.targetPosition.length >= 2;
      const [targetLat, targetLng] = hasTarget ? unit.targetPosition : randomLandPoint();

      if (!unit.patrolRoutePending && (!Number.isFinite(unit.patrolRetryAt) || now >= unit.patrolRetryAt)) {
        if (routeRequests.length < MAX_ROUTE_REQUESTS_PER_TICK) {
          routeRequests.push({
            unitId: unit.id || `routine-${idx}`,
            fromLat: currentLat,
            fromLng: currentLng,
            toLat: targetLat,
            toLng: targetLng,
          });
        }
      }

      return {
        ...unit,
        id: unit.id || `routine-${idx}`,
        position: [currentLat, currentLng],
        latitude: currentLat,
        longitude: currentLng,
        targetPosition: [targetLat, targetLng],
        patrolRoutePending: true,
        patrolRetryAt: now + randomMsBetween(ROUTE_RETRY_MS),
        onRoad: unit.onRoad,
        onRoadPending: unit.onRoadPending,
        roadRetryAt: unit.roadRetryAt,
        lastUpdated: now,
      };
    });

    // Merge: keep EN_ROUTE/ON_SCENE units from current state, update patrol units
    set((state) => {
      const currentUnits = state.units || [];
      const mergedUnits = currentUnits.map(u => {
        if (u.status === 'EN_ROUTE' || u.status === 'ON_SCENE') {
          return u;
        }
        const updated = updatedUnits.find(upd => upd.id === u.id);
        return updated || u;
      });

      const currentRoutineUnits = state.routineUnits || [];
      const mergedRoutineUnits = currentRoutineUnits.map(u => {
        if (u.status === 'EN_ROUTE' || u.status === 'ON_SCENE') {
          return u;
        }
        const updated = updatedUnits.find(upd => upd.id === u.id);
        return updated || u;
      });

      return { routineUnits: mergedRoutineUnits, units: mergedUnits };
    });

    // Async: calculate patrol routes and set them when ready
    if (routeRequests.length > 0) {
      Promise.all(
        routeRequests.map(async (req) => {
          try {
            const route = await calculateRoute(req.fromLat, req.fromLng, req.toLat, req.toLng, { allowFallback: false });
            return { ...req, route };
          } catch {
            return { ...req, route: null };
          }
        })
      ).then((routes) => {
        if (!routes || routes.length === 0) return;
        set((state) => {
          const updated = (list) => (list || []).map((u) => {
            const routeData = routes.find(r => r.unitId === u.id);
            if (!routeData) return u;
            const hasRoute = Array.isArray(routeData.route) && routeData.route.length > 0;
            const nextLat = hasRoute ? routeData.route[0]?.[0] : (u.latitude ?? (Array.isArray(u.position) ? u.position[0] : undefined));
            const nextLng = hasRoute ? routeData.route[0]?.[1] : (u.longitude ?? (Array.isArray(u.position) ? u.position[1] : undefined));
            return {
              ...u,
              patrolRoute: hasRoute ? routeData.route : null,
              patrolIndex: 0,
              patrolRoutePending: false,
              onRoad: !!hasRoute,
              latitude: Number.isFinite(nextLat) ? nextLat : u.latitude,
              longitude: Number.isFinite(nextLng) ? nextLng : u.longitude,
              position: (Number.isFinite(nextLat) && Number.isFinite(nextLng)) ? [nextLat, nextLng] : u.position,
            };
          });

          return {
            units: updated(state.units),
            routineUnits: updated(state.routineUnits),
          };
        });
      });
    }

    if (nearestRequests.length > 0) {
      Promise.all(
        nearestRequests.map(async (req) => {
          const snapped = await getNearestRoadPoint(req.lat, req.lng);
          return { ...req, snapped };
        })
      ).then((snaps) => {
        if (!snaps || snaps.length === 0) return;
        set((state) => {
          const updated = (list) => (list || []).map((u) => {
            const snap = snaps.find(s => s.unitId === u.id);
            if (!snap) return u;
            const hasSnap = Array.isArray(snap.snapped) && snap.snapped.length === 2;
            if (!hasSnap) {
              return {
                ...u,
                onRoad: false,
                onRoadPending: false,
                roadRetryAt: Date.now() + randomMsBetween(NEAREST_RETRY_MS),
              };
            }

            const [sLat, sLng] = snap.snapped;
            const stillParked = !!u.isParked;
            return {
              ...u,
              onRoad: true,
              onRoadPending: false,
              roadRetryAt: 0,
              homeStationSnap: stillParked ? [sLat, sLng] : u.homeStationSnap,
              isParked: stillParked,
              status: stillParked ? 'AVAILABLE' : 'PATROL',
              position: [sLat, sLng],
              latitude: sLat,
              longitude: sLng,
            };
          });

          return {
            units: updated(state.units),
            routineUnits: updated(state.routineUnits),
          };
        });
      });
    }
  },

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

  releaseUnits: (unitIds = []) =>
    set((state) => {
      const releaseSet = new Set(unitIds);

      const releaseUnit = (u) => {
        if (!releaseSet.has(u.id)) return u;
        const [nextLat, nextLng] = randomLandPoint();
        return {
          ...u,
          status: 'PATROL',
          assignedTo: null,
          route: null,
          routeIndex: 0,
          routePending: false,
          routeRetryAt: 0,
          patrolRoute: null,
          patrolIndex: 0,
          patrolRoutePending: true,
          patrolRetryAt: Date.now() + randomMsBetween(ROUTE_RETRY_MS),
          onRoad: false,
          onRoadPending: false,
          roadRetryAt: Date.now() + randomMsBetween(NEAREST_RETRY_MS),
          stopUntil: null,
          onSceneAt: null,
          autoReleaseAt: null,
          position: [nextLat, nextLng],
          latitude: nextLat,
          longitude: nextLng,
          targetPosition: randomLandPoint(),
          lastUpdated: Date.now(),
        };
      };

      return {
        units: (state.units || []).map(releaseUnit),
        routineUnits: (state.routineUnits || []).map(releaseUnit),
      };
    }),

  addEvent: (newEvent) =>
    set((state) => {
      // Check if event with same title and description already exists
      const isDuplicate = state.events.some(
        (e) => e.title === newEvent.title && e.description === newEvent.description
      );

      if (isDuplicate) {
        console.log('⚠️ Duplicate event detected, skipping:', newEvent.title);
        return {}; // Do nothing if duplicate
      }

      console.log('📋 addEvent called with:', { title: newEvent.title, type: newEvent.type, subtype: newEvent.subtype, lat: newEvent.location_lat, lng: newEvent.location_lng });

      // Ensure event has a timestamp
      const eventWithTime = {
        ...newEvent,
        id: newEvent.id || `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        created_at: newEvent.created_at || new Date().toISOString(),
      };

      // If this is a routine event (has type and subtype), also add to incidents array
      let updatedIncidents = state.incidents || [];

      if (newEvent.type && newEvent.subtype) {
        // This is a routine event - convert it to incident format for map display
        const newIncident = {
          id: eventWithTime.id,
          title: newEvent.title || `${newEvent.type}: ${newEvent.subtype}`,
          description: newEvent.description,
          event_type: newEvent.event_type || newEvent.type,
          status: newEvent.status || 'OPEN',
          priority: newEvent.priority || 'MED',
          severity: newEvent.severity || newEvent.priority || 'MED',
          location_lat: newEvent.location_lat,
          location_lng: newEvent.location_lng,
          latitude: newEvent.location_lat, // Alias for compatibility
          longitude: newEvent.location_lng, // Alias for compatibility
          created_at: eventWithTime.created_at,
          assignedUnits: [],
        };

        // Add to incidents if doesn't already exist
        if (!updatedIncidents.find(i => i.id === newIncident.id)) {
          updatedIncidents = [newIncident, ...updatedIncidents].slice(0, 100); // Keep last 100 incidents
          console.log(`✅ Added routine event to incidents array: ${newIncident.title} at [${newEvent.location_lat}, ${newEvent.location_lng}]`);
          console.log(`📊 Total incidents now: ${updatedIncidents.length}`);
        } else {
          console.log('⚠️ Incident with this ID already exists:', newIncident.id);
        }
      } else {
        console.log('ℹ️ Event has no type/subtype, not adding to incidents');
      }

      return {
        events: [eventWithTime, ...state.events].slice(0, 50), // Keep last 50 events
        incidents: updatedIncidents,
      };
    }),

  // Movement Engine - called every tick to update unit positions
  moveUnits: () => {
    const state = get();
    if (!Array.isArray(state.units) || state.units.length === 0) {
      return;
    }

    const now = Date.now();
    const routeRequests = [];
    const nearestRequests = [];

    const updatedUnits = state.units.map((u) => {
      // Ambulance auto-release logic when ON_SCENE
      if (u.status === 'ON_SCENE' && u.type === 'MEDICAL') {
        const autoReleaseAt = Number.isFinite(u.autoReleaseAt)
          ? u.autoReleaseAt
          : now + randomMsBetween(AUTO_RELEASE_MS);

        if (now >= autoReleaseAt) {
          const [nextLat, nextLng] = randomLandPoint();
          return {
            ...u,
            status: 'PATROL',
            assignedTo: null,
            route: null,
            routeIndex: 0,
            routePending: false,
            routeRetryAt: 0,
            patrolRoute: null,
            patrolIndex: 0,
            patrolRoutePending: true,
            patrolRetryAt: now + randomMsBetween(ROUTE_RETRY_MS),
            onRoad: false,
            onRoadPending: false,
            roadRetryAt: now + randomMsBetween(NEAREST_RETRY_MS),
            stopUntil: null,
            onSceneAt: null,
            autoReleaseAt: null,
            position: [nextLat, nextLng],
            latitude: nextLat,
            longitude: nextLng,
            targetPosition: randomLandPoint(),
            lastUpdated: now,
          };
        }

        return {
          ...u,
          onSceneAt: u.onSceneAt || now,
          autoReleaseAt,
        };
      }

      if (u.status === 'EN_ROUTE' && u.assignedTo) {
        const target = (state.incidents || []).find((i) => i.id === u.assignedTo);
        if (!target) {
          console.warn(`Unit ${u.id} assigned to non-existent incident ${u.assignedTo}`);
          return u;
        }

        const hasPosition = Array.isArray(u.position) && u.position.length >= 2;
        const currentLat = hasPosition && Number.isFinite(u.position[0])
          ? u.position[0]
          : u.latitude;
        const currentLng = hasPosition && Number.isFinite(u.position[1])
          ? u.position[1]
          : u.longitude;

        const targetLat = Array.isArray(u.assignedTarget)
          ? u.assignedTarget[0]
          : (target.latitude ?? target.location_lat ?? target.lat);
        const targetLng = Array.isArray(u.assignedTarget)
          ? u.assignedTarget[1]
          : (target.longitude ?? target.location_lng ?? target.lng);

        if (!Number.isFinite(currentLat) || !Number.isFinite(currentLng)) {
          console.warn(`Unit ${u.id} has invalid current position: [${currentLat}, ${currentLng}]`);
          return u;
        }

        if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) {
          console.warn(`Unit ${u.id} target has invalid position: [${targetLat}, ${targetLng}]`);
          return u;
        }

        // If unit is off-road, snap to nearest road before routing
        if (!u.onRoad) {
          if (!u.onRoadPending && (!Number.isFinite(u.roadRetryAt) || now >= u.roadRetryAt)) {
            if (nearestRequests.length < MAX_NEAREST_REQUESTS_PER_TICK) {
              nearestRequests.push({
                unitId: u.id,
                lat: currentLat,
                lng: currentLng,
              });
            }
          }
          return {
            ...u,
            onRoadPending: true,
            roadRetryAt: now + randomMsBetween(NEAREST_RETRY_MS),
          };
        }

        // If unit has no route, request one (road-only)
        if (!u.route || !Array.isArray(u.route) || u.route.length === 0) {
          if (!u.routePending && (!Number.isFinite(u.routeRetryAt) || now >= u.routeRetryAt)) {
            if (routeRequests.length < MAX_ROUTE_REQUESTS_PER_TICK) {
              routeRequests.push({
                unitId: u.id,
                fromLat: currentLat,
                fromLng: currentLng,
                toLat: targetLat,
                toLng: targetLng,
              });
            }
          }
          return { ...u, routePending: true, routeRetryAt: now + randomMsBetween(ROUTE_RETRY_MS) };
        }

        const currentIndex = u.routeIndex ?? 0;
        const nextPos = getNextPositionOnRoute(
          u.route,
          currentLat,
          currentLng,
          currentIndex,
          PATROL_SPEED
        );

        if (nextPos.lat !== null && nextPos.lng !== null && Number.isFinite(nextPos.lat) && Number.isFinite(nextPos.lng)) {
          const arrived = nextPos.arrived;
          return {
            ...u,
            latitude: nextPos.lat,
            longitude: nextPos.lng,
            position: [nextPos.lat, nextPos.lng],
            routeIndex: nextPos.index,
            status: arrived ? 'ON_SCENE' : 'EN_ROUTE',
            onSceneAt: arrived ? (u.onSceneAt || now) : null,
            autoReleaseAt: arrived && u.type === 'MEDICAL'
              ? (u.autoReleaseAt || now + randomMsBetween(AUTO_RELEASE_MS))
              : u.autoReleaseAt,
            onRoad: true,
            lastUpdated: now,
          };
        }

        return u;
      }

      return u;
    });

    // Update BOTH units and routineUnits to keep them in sync
    set({ units: updatedUnits, routineUnits: updatedUnits });

    // Async: calculate missing EN_ROUTE routes
    if (routeRequests.length > 0) {
      Promise.all(
        routeRequests.map(async (req) => {
          try {
            const route = await calculateRoute(req.fromLat, req.fromLng, req.toLat, req.toLng, { allowFallback: false });
            return { ...req, route };
          } catch {
            return { ...req, route: null };
          }
        })
      ).then((routes) => {
        if (!routes || routes.length === 0) return;
        set((state) => {
          const updated = (list) => (list || []).map((u) => {
            const routeData = routes.find(r => r.unitId === u.id);
            if (!routeData) return u;
            const hasRoute = Array.isArray(routeData.route) && routeData.route.length > 0;
            const nextLat = hasRoute ? routeData.route[0]?.[0] : (u.latitude ?? (Array.isArray(u.position) ? u.position[0] : undefined));
            const nextLng = hasRoute ? routeData.route[0]?.[1] : (u.longitude ?? (Array.isArray(u.position) ? u.position[1] : undefined));
            return {
              ...u,
              route: hasRoute ? routeData.route : null,
              routeIndex: 0,
              routePending: false,
              routeRetryAt: hasRoute ? 0 : (u.routeRetryAt || now + randomMsBetween(ROUTE_RETRY_MS)),
              onRoad: !!hasRoute,
              latitude: Number.isFinite(nextLat) ? nextLat : u.latitude,
              longitude: Number.isFinite(nextLng) ? nextLng : u.longitude,
              position: (Number.isFinite(nextLat) && Number.isFinite(nextLng)) ? [nextLat, nextLng] : u.position,
            };
          });

          return {
            units: updated(state.units),
            routineUnits: updated(state.routineUnits),
          };
        });
      });
    }

    if (nearestRequests.length > 0) {
      Promise.all(
        nearestRequests.map(async (req) => {
          const snapped = await getNearestRoadPoint(req.lat, req.lng);
          return { ...req, snapped };
        })
      ).then((snaps) => {
        if (!snaps || snaps.length === 0) return;
        set((state) => {
          const updated = (list) => (list || []).map((u) => {
            const snap = snaps.find(s => s.unitId === u.id);
            if (!snap) return u;
            const hasSnap = Array.isArray(snap.snapped) && snap.snapped.length === 2;
            if (!hasSnap) {
              return {
                ...u,
                onRoad: false,
                onRoadPending: false,
                roadRetryAt: Date.now() + randomMsBetween(NEAREST_RETRY_MS),
              };
            }

            const [sLat, sLng] = snap.snapped;
            return {
              ...u,
              onRoad: true,
              onRoadPending: false,
              roadRetryAt: 0,
              position: [sLat, sLng],
              latitude: sLat,
              longitude: sLng,
            };
          });

          return {
            units: updated(state.units),
            routineUnits: updated(state.routineUnits),
          };
        });
      });
    }
  },

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

// Cross-tab sync (Field <-> War-Room)
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  const fieldSyncChannel = new BroadcastChannel('field-incident-sync');
  const tabId = `tab-${Math.random().toString(36).slice(2)}`;
  let applyingRemote = false;

  fieldSyncChannel.onmessage = (event) => {
    if (!event?.data || event.data.source === tabId) return;
    const payload = event.data.payload;
    if (!payload || typeof payload !== 'object') return;

    applyingRemote = true;
    useFieldIncidentStore.setState(payload);
    applyingRemote = false;
  };

  useFieldIncidentStore.subscribe((state) => {
    if (applyingRemote) return;
    const payload = {
      mode: state.mode,
      simulationType: state.simulationType,
      simulationStep: state.simulationStep,
      majorIncident: state.majorIncident,
      sectors: state.sectors,
      taskGroups: state.taskGroups,
      events: state.events,
      incidents: state.incidents,
      units: state.units,
      routineUnits: state.routineUnits,
    };
    fieldSyncChannel.postMessage({ source: tabId, payload });
  });
}
