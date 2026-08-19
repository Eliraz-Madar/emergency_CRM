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

// Authentication
export const login = async (username, password) => {
  const res = await api.post("/token/", { username, password });
  localStorage.setItem("token", res.data.access);
  return res.data;
};

// Mock Data API - Incidents
export const getIncidents = async (fieldId = null) => {
  const params = fieldId ? { fieldId } : undefined;
  const res = await api.get("/mock/incidents/", { params });
  return res.data;
};

export const getIncident = async (id) => {
  const res = await api.get(`/mock/incidents/${id}/`);
  return res.data;
};

export const updateIncidentStatus = async (id, status) => {
  const res = await api.patch(`/mock/incidents/${id}/status/`, { status });
  return res.data;
};

export const updateIncidentPriority = async (id, priority) => {
  const res = await api.patch(`/mock/incidents/${id}/priority/`, { priority });
  return res.data;
};

export const assignUnitToIncident = async (incidentId, unitId) => {
  const res = await api.post(`/mock/incidents/${incidentId}/assign/`, { unit_id: unitId });
  return res.data;
};

export const addIncidentNote = async (incidentId, note) => {
  const res = await api.post(`/mock/incidents/${incidentId}/note/`, { note });
  return res.data;
};

// Mock Data API - Units
export const getUnits = async (fieldId = null) => {
  const params = fieldId ? { fieldId } : undefined;
  const res = await api.get("/mock/units/", { params });
  return res.data;
};

// Real, DB-backed units (the actual Unit model) — carries a live, staleness
// aware `is_online`. Used for the map/dispatch panel, which must only ever
// show real, actively-connected units — never the seeded mock/demo roster.
// See final changes/05_user_unit_claiming_and_live_sync.md.
export const getRealUnits = async () => {
  const res = await api.get("/units/");
  return res.data;
};

// Mock Data API - Events
export const getEvents = async (limit = 50, incidentId = null) => {
  const params = { limit };
  if (incidentId) params.incident_id = incidentId;
  const res = await api.get("/mock/events/", { params });
  return res.data;
};

// Field Command API
export const getFieldCommands = async () => {
  const res = await api.get("/mock/fields/");
  return res.data;
};

export const getFieldCommand = async (fieldId) => {
  const res = await api.get(`/mock/fields/${fieldId}/`);
  return res.data;
};

export const assignUnitToField = async (fieldId, unitId) => {
  const res = await api.patch(`/mock/fields/${fieldId}/assign-unit/`, { unit_id: unitId });
  return res.data;
};

export const createFieldCommand = async (payload) => {
  const res = await api.post("/field/create/", payload);
  return res.data;
};

export const closeFieldCommand = async (fieldId) => {
  const res = await api.post("/field/close/", { field_id: fieldId });
  return res.data;
};

export const updateFieldMetrics = async (payload, fieldId = null) => {
  const params = fieldId ? { fieldId } : undefined;
  const res = await api.patch("/field/metrics/", payload, { params });
  return res.data;
};

// Mock Data API - Simulation
export const simulateUpdate = async () => {
  const res = await api.get("/mock/simulate/");
  return res.data;
};

/**
 * Connect to Server-Sent Events stream for real-time updates.
 * Returns an EventSource instance that can be listened to.
 */
export const connectToUpdatesStream = () => {
  const url = `${API_BASE_URL}/mock/updates/stream/`;
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

