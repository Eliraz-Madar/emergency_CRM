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

export const addIncidentNote = async (incidentId, note) => {
  const res = await api.post(`/incidents/${incidentId}/note/`, { note });
  return res.data;
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

export const updateFieldMetrics = async (payload, fieldId) => {
  const res = await api.patch(`/field-commands/${fieldId}/metrics/`, payload);
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
// FIELD INCIDENT COMMAND DASHBOARD API
// ============================================

// Get major incident with all data
export const getFieldIncident = async (fieldId = null) => {
  const params = fieldId ? { fieldId } : undefined;
  const res = await api.get("/field/incident/", { params });
  return res.data;
};

// Get sectors for current incident
export const getFieldIncidentSectors = async (fieldId = null) => {
  const params = fieldId ? { fieldId } : undefined;
  const res = await api.get("/field/sectors/", { params });
  return res.data;
};

// Get task groups for current incident
export const getFieldIncidentTaskGroups = async (fieldId = null) => {
  const params = fieldId ? { fieldId } : undefined;
  const res = await api.get("/field/task-groups/", { params });
  return res.data;
};

// Get operational timeline events
export const getFieldIncidentEvents = async (fieldId = null) => {
  const params = fieldId ? { fieldId } : undefined;
  const res = await api.get("/field/events/", { params });
  return res.data;
};

// Update sector
export const updateFieldSector = async (sectorId, updates, fieldId = null) => {
  const params = fieldId ? { fieldId } : undefined;
  const res = await api.patch(`/field/sectors/${sectorId}/`, updates, { params });
  return res.data;
};

// Update task group
export const updateFieldTaskGroup = async (taskGroupId, updates, fieldId = null) => {
  const params = fieldId ? { fieldId } : undefined;
  const res = await api.patch(`/field/task-groups/${taskGroupId}/`, updates, { params });
  return res.data;
};

// Update casualty estimates
export const updateFieldCasualties = async (updates, fieldId = null) => {
  const params = fieldId ? { fieldId } : undefined;
  const res = await api.patch("/field/casualty-update/", updates, { params });
  return res.data;
};

// Add event to timeline
export const addFieldEvent = async (eventData, fieldId = null) => {
  const params = fieldId ? { fieldId } : undefined;
  const res = await api.post("/field/add-event/", eventData, { params });
  return res.data;
};

// Simulate update to field incident
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

