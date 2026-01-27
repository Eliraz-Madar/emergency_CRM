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
export const getIncidents = async () => {
  const res = await api.get("/mock/incidents/");
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
export const getUnits = async () => {
  const res = await api.get("/mock/units/");
  return res.data;
};

// Mock Data API - Events
export const getEvents = async (limit = 50) => {
  const res = await api.get("/mock/events/", { params: { limit } });
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
export const getFieldIncident = async () => {
  const res = await api.get("/field/incident/");
  return res.data;
};

// Get sectors for current incident
export const getFieldIncidentSectors = async () => {
  const res = await api.get("/field/sectors/");
  return res.data;
};

// Get task groups for current incident
export const getFieldIncidentTaskGroups = async () => {
  const res = await api.get("/field/task-groups/");
  return res.data;
};

// Get operational timeline events
export const getFieldIncidentEvents = async () => {
  const res = await api.get("/field/events/");
  return res.data;
};

// Update sector
export const updateFieldSector = async (sectorId, updates) => {
  const res = await api.patch(`/field/sectors/${sectorId}/`, updates);
  return res.data;
};

// Update task group
export const updateFieldTaskGroup = async (taskGroupId, updates) => {
  const res = await api.patch(`/field/task-groups/${taskGroupId}/`, updates);
  return res.data;
};

// Update casualty estimates
export const updateFieldCasualties = async (updates) => {
  const res = await api.patch("/field/casualty-update/", updates);
  return res.data;
};

// Add event to timeline
export const addFieldEvent = async (eventData) => {
  const res = await api.post("/field/add-event/", eventData);
  return res.data;
};

// Simulate update to field incident
export const simulateFieldIncidentUpdate = async () => {
  const res = await api.get("/field/simulate/");
  return res.data;
};

// Connect to field incident real-time stream
export const connectToFieldIncidentStream = () => {
  const url = `${API_BASE_URL}/field/updates/stream/`;
  const eventSource = new EventSource(url);
  return eventSource;
};

export default api;

