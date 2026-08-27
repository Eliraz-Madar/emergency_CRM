import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// No login is enforced for this dashboard — the backend has no way to know
// who's calling otherwise, so closure/role-sensitive requests declare that
// they're acting as command center via this header (see
// api/permissions.py::effective_role). Only attached where the backend
// actually reads it — everything else (plain GETs, priority/note/assign
// writes with no role check) stays a simple, preflight-free request.
const actorRoleHeaders = (role = "COMMAND_CENTER") => ({
  headers: { "X-Actor-Role": role },
});

// Authentication
export const login = async (username, password) => {
  const res = await api.post("/token/", { username, password });
  localStorage.setItem("token", res.data.access);
  return res.data;
};

// Incidents — real, DB-backed IncidentViewSet.
export const getIncidents = async () => {
  const res = await api.get("/incidents/");
  return res.data;
};

export const getIncident = async (id) => {
  const res = await api.get(`/incidents/${id}/`);
  return res.data;
};

export const createIncident = async (payload) => {
  const res = await api.post("/incidents/", payload);
  return res.data;
};

// Closing (status: "CLOSED") requires `reason` and `closedByRole`
// ("UNIT" | "COMMAND_CENTER") in the same request — the backend rejects a
// bare status update with no reason. Non-closing status changes ignore them.
export const updateIncidentStatus = async (id, status, reason = null, closedByRole = null) => {
  const body = { status };
  if (status === "CLOSED") {
    body.closed_reason = reason;
    body.closed_by_role = closedByRole;
  }
  const res = await api.patch(`/incidents/${id}/`, body, actorRoleHeaders(closedByRole || "COMMAND_CENTER"));
  return res.data;
};

export const updateIncidentPriority = async (id, priority) => {
  const res = await api.patch(`/incidents/${id}/`, { priority });
  return res.data;
};

export const assignUnitToIncident = async (incidentId, unitId) => {
  const res = await api.post(`/incidents/${incidentId}/assign-unit/`, { unit_id: unitId });
  return res.data;
};

const formatDispatchError = async (response) => {
  let detail = "Unknown error";
  try {
    const data = await response.json();
    if (typeof data?.detail === "string") {
      detail = data.detail;
    } else if (Array.isArray(data?.detail) && data.detail[0]) {
      detail = data.detail[0];
    } else {
      const firstValue = data && typeof data === "object" ? Object.values(data)[0] : null;
      if (typeof firstValue === "string") detail = firstValue;
      else if (Array.isArray(firstValue) && firstValue[0]) detail = firstValue[0];
      else detail = JSON.stringify(data);
    }
  } catch {
    try {
      const text = await response.text();
      if (text) detail = text;
    } catch {
      // keep default message
    }
  }
  return `HTTP ${response.status} ${response.statusText}: ${detail}`;
};

// Robust unit dispatch helper for tactical flows. Defaults to the real
// incident assign endpoint and validates HTTP status explicitly.
//
// details.mode:
// - "incident" (default): POST /incidents/{id}/assign-unit/ once per unit
// - "mobile": POST /mobile/dispatch/ with a unit list payload
export const dispatchUnitsToIncident = async (incidentId, unitIds, details = {}) => {
  const uniqueUnitIds = Array.from(new Set((unitIds || []).filter((id) => id != null)));
  if (!incidentId) throw new Error("dispatchUnitsToIncident requires incidentId.");
  if (uniqueUnitIds.length === 0) throw new Error("dispatchUnitsToIncident requires at least one unit id.");

  const mode = details.mode === "mobile" ? "mobile" : "incident";
  const token = localStorage.getItem("token");
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  if (mode === "mobile") {
    const units = Array.isArray(details.units)
      ? details.units.filter((u) => uniqueUnitIds.includes(u?.mock_unit_num ?? u?.id)).map((u) => ({
        mock_unit_num: u.mock_unit_num ?? u.id,
        name: u.name,
        type: u.type,
      }))
      : uniqueUnitIds.map((id) => ({ mock_unit_num: id }));

    const response = await fetch(`${API_BASE_URL}/mobile/dispatch/`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        incident_id: incidentId,
        incident_title: details.incidentTitle || `Incident ${incidentId}`,
        location_lat: details.locationLat,
        location_lng: details.locationLng,
        priority: details.priority || "HIGH",
        units,
      }),
    });

    if (!response.ok) {
      throw new Error(`dispatchUnitsToIncident failed: ${await formatDispatchError(response)}`);
    }

    return response.json();
  }

  const results = [];
  for (const unitId of uniqueUnitIds) {
    const response = await fetch(`${API_BASE_URL}/incidents/${incidentId}/assign-unit/`, {
      method: "POST",
      headers,
      body: JSON.stringify({ unit_id: unitId }),
    });

    if (!response.ok) {
      throw new Error(
        `dispatchUnitsToIncident failed for unit ${unitId}: ${await formatDispatchError(response)}`,
      );
    }

    results.push(await response.json());
  }

  return {
    incidentId,
    dispatchedUnitIds: uniqueUnitIds,
    results,
  };
};

// Real, DB-backed units (the actual Unit model) — carries a live, staleness
// aware `is_online`. Used for the map/dispatch panel, which must only ever
// show real, actively-connected units — never the seeded mock/demo roster.
// See final changes/05_user_unit_claiming_and_live_sync.md.
export const getUnits = async () => {
  const res = await api.get("/units/");
  return res.data;
};

export const getRealUnits = getUnits;

// Tasks assigned to one real Unit (strict FK match) — the regional
// dashboard's selected-vehicle panel.
export const getUnitTasks = async (unitId) => {
  const res = await api.get(`/units/${unitId}/tasks/`);
  return res.data;
};

// Real event feed — backed by IncidentEvent rows written by the Incident/Unit
// viewsets. Only ever contains events tied to a real Incident.
export const getEvents = async (limit = 50, incidentId = null) => {
  const params = { limit };
  if (incidentId) params.incident_id = incidentId;
  const res = await api.get("/events/", { params });
  return res.data;
};

// Field Command API — real, DB-backed FieldCommand model.
export const getFieldCommands = async () => {
  const res = await api.get("/field-commands/");
  return res.data;
};

export const getFieldCommand = async (fieldId) => {
  const res = await api.get(`/field-commands/${fieldId}/`);
  return res.data;
};

export const assignUnitToField = async (fieldId, unitId) => {
  const res = await api.post(`/field-commands/${fieldId}/assign-unit/`, { unit_id: unitId });
  return res.data;
};

// Links a regular Incident to a Field Command Post (operator-initiated).
export const assignIncidentToField = async (fieldId, incidentId) => {
  const res = await api.post(`/field-commands/${fieldId}/assign-incident/`, { incident_id: incidentId });
  return res.data;
};

export const createFieldCommand = async (payload) => {
  const res = await api.post("/field-commands/", payload);
  return res.data;
};

// Closing requires `reason` and `closedByRole` ("FIELD_OPERATOR" | "COMMAND_CENTER").
export const closeFieldCommand = async (fieldId, reason, closedByRole) => {
  const res = await api.post(`/field-commands/${fieldId}/close/`, {
    closed_reason: reason,
    closed_by_role: closedByRole,
  }, actorRoleHeaders(closedByRole || "COMMAND_CENTER"));
  return res.data;
};

// Field command missions (central-room taskings). Both calls return the
// full FieldCommandSerializer shape so callers can refresh the panel with
// no extra GET. payload for create: { title, details?, assigned_unit?, status? }.
export const createFieldMission = async (fieldId, payload) => {
  const res = await api.post(
    `/field-commands/${fieldId}/missions/`, payload,
    actorRoleHeaders("COMMAND_CENTER"),
  );
  return res.data;
};

export const updateFieldMission = async (fieldId, missionId, payload) => {
  const res = await api.patch(
    `/field-commands/${fieldId}/missions/${missionId}/`, payload,
    actorRoleHeaders("COMMAND_CENTER"),
  );
  return res.data;
};

/**
 * Connect to the real-time updates stream (Server-Sent Events). Despite the
 * old "/mock/" path this used to live under, this relays genuine broadcasts
 * from real writes (Incident/Unit/Task changes, dispatch, unit claims) — see
 * api/views.py::_broadcast_realtime, which every real viewset calls. It has
 * nothing to do with MockDataService and was NOT removed with the rest of
 * the mock endpoints. Returns an EventSource instance that can be listened to.
 */
export const connectToUpdatesStream = () => {
  const url = `${API_BASE_URL}/updates/stream/`;
  const eventSource = new EventSource(url);
  return eventSource;
};

// ============================================
// REAL MAJOR INCIDENT API (the "go live" flow)
// ============================================
// Backed by backend/api/views.py's major_incident_* endpoints — entirely
// separate from the FIELD INCIDENT COMMAND DASHBOARD API below, which stays
// the mock/training-simulation backend (backend/simulated/).

// Promotes a real Incident to a MajorIncident. incidentType must be one of
// MajorIncident.IncidentType (EARTHQUAKE/MISSILE_STRIKE/BUILDING_COLLAPSE/
// FLOOD/HAZMAT/WILDFIRE) — the backend copies title/description/location
// from the Incident itself, so that's the only new input this call needs.
export const goLiveIncident = async (incidentId, incidentType) => {
  const res = await api.post(
    "/major-incidents/go-live/",
    { incident_id: incidentId, incident_type: incidentType },
    actorRoleHeaders("COMMAND_CENTER"),
  );
  return res.data;
};

export const getMajorIncidentSectors = async (majorIncidentId) => {
  const res = await api.get(`/major-incidents/${majorIncidentId}/sectors/`);
  return res.data;
};

// name + hazardLevel only — no lat/lng (Sector.location_lat/lng are nullable
// for this phase, see backend/api/models.py).
export const createMajorIncidentSector = async (majorIncidentId, { name, hazardLevel }) => {
  const res = await api.post(
    `/major-incidents/${majorIncidentId}/sectors/`,
    { name, hazard_level: hazardLevel },
    actorRoleHeaders("COMMAND_CENTER"),
  );
  return res.data;
};

export const getMajorIncidentTaskGroups = async (majorIncidentId) => {
  const res = await api.get(`/major-incidents/${majorIncidentId}/task-groups/`);
  return res.data;
};

export const createMajorIncidentTaskGroup = async (majorIncidentId, { title, category, sectorIds }) => {
  const body = { title, category };
  if (Array.isArray(sectorIds) && sectorIds.length > 0) {
    body.sector_ids = sectorIds;
  }
  const res = await api.post(
    `/major-incidents/${majorIncidentId}/task-groups/`,
    body,
    actorRoleHeaders("COMMAND_CENTER"),
  );
  return res.data;
};

// Latest submitted Perimeter for a MajorIncident, or null if none exists yet.
export const getMajorIncidentPerimeter = async (majorIncidentId) => {
  const res = await api.get(`/major-incidents/${majorIncidentId}/perimeter/`);
  return res.data;
};

// points: ordered array of {lat, lng} (min 3) — field-operator-only.
export const submitMajorIncidentPerimeter = async (majorIncidentId, points) => {
  const res = await api.post(
    `/major-incidents/${majorIncidentId}/perimeter/`,
    { points, submitted_by_role: "FIELD_OPERATOR" },
    actorRoleHeaders("FIELD_OPERATOR"),
  );
  return res.data;
};

// ============================================
// FIELD INCIDENT COMMAND DASHBOARD API (training simulation)
// ============================================

// Legacy fabricating endpoint — only still called by the field store's
// loadFieldIncident() on an SSE reconnect while in ROUTINE/SIMULATION (drill)
// mode. Real posts re-sync via getFieldCommand(). See FieldIncidentDashboard.jsx.
export const getFieldIncident = async (fieldId = null) => {
  const params = fieldId ? { fieldId } : undefined;
  const res = await api.get("/field/incident/", { params });
  return res.data;
};

// Advances the seeded training scenario one step (drill mode only).
export const simulateFieldIncidentUpdate = async (fieldId = null) => {
  const params = fieldId ? { fieldId } : undefined;
  const res = await api.get("/field/simulate/", { params });
  return res.data;
};

// Connect to field incident real-time stream
export const connectToFieldIncidentStream = () => {
  const url = `${API_BASE_URL}/field/updates/stream/`;
  const eventSource = new EventSource(url);
  return eventSource;
};

export default api;

