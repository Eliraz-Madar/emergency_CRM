/**
 * Agency-type visual meta (emoji + accent colour) for Units and Incidents.
 *
 * Single source for the POLICE / FIRE / EMS / HOMEFRONT palette. A Unit keys
 * in by its `type` (backend Unit.UnitType: "Police"/"Fire"/"EMS"/"HomeFront",
 * caller-uppercased); an Incident keys in by its `channel` ("POLICE"/"FIRE"/
 * "EMS"). Used by the Field Command panels (FieldCommandDetailsPanel,
 * FieldCommandSummaryView) and the regional map / incident list
 * (MapView.jsx, IncidentList.jsx).
 *
 * Callers that want a domain-specific "unknown" marker (e.g. the map's
 * point-dispatch diamond uses a ⚡ bolt, not the generic 🚨) pass their own
 * `fallback` as the second argument.
 */

const AGENCY_META = {
  POLICE: { emoji: '🚓', color: '#3b82f6' },
  FIRE: { emoji: '🚒', color: '#ef4444' },
  EMS: { emoji: '🚑', color: '#10b981' },
  // Legacy alias — some older unit rows / scenario data use "AMBULANCE".
  AMBULANCE: { emoji: '🚑', color: '#10b981' },
  HOMEFRONT: { emoji: '🏠', color: '#6b7280' },
};

// Unknown / missing type — a neutral generic marker, never a crash.
const FALLBACK_META = { emoji: '🚨', color: '#94a3b8' };

export const getUnitTypeMeta = (unit, fallback = FALLBACK_META) =>
  AGENCY_META[(unit?.type || '').toUpperCase()] || fallback;

export const getIncidentChannelMeta = (incident, fallback = FALLBACK_META) =>
  AGENCY_META[(incident?.channel || '').toUpperCase()] || fallback;
