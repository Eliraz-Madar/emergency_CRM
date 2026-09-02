/**
 * Incident SEVERITY visual meta — one canonical mapping from an incident's
 * priority/severity level to a colour + label, used by every incident list in
 * both dashboards so the "how urgent is this" marker looks identical
 * everywhere (regional war-room incident list, the field Central Command
 * panel, the war-room's field-command panel, …).
 *
 * Keyed by Incident.Priority (backend/api/models.py): LOW / MED / HIGH /
 * CRITICAL. "MEDIUM" is accepted as a legacy alias for "MED". The colour
 * scale runs green → amber → red → deep-red and matches the regional map's
 * incident-pin colours.
 */

const SEVERITY_META = {
  CRITICAL: { level: 'CRITICAL', label: 'Critical', color: '#dc2626' },
  HIGH:     { level: 'HIGH',     label: 'High',     color: '#ef4444' },
  MED:      { level: 'MED',      label: 'Medium',   color: '#f59e0b' },
  MEDIUM:   { level: 'MED',      label: 'Medium',   color: '#f59e0b' },
  LOW:      { level: 'LOW',      label: 'Low',      color: '#10b981' },
};

const SEVERITY_FALLBACK = { level: 'UNKNOWN', label: 'Unknown', color: '#6b7280' };

/**
 * `{ level, label, color }` for an incident-shaped object. Reads `priority`
 * first, then `severity` (older rows / some serializers use that name).
 */
export function getIncidentSeverityMeta(incident) {
  const raw = String(incident?.priority ?? incident?.severity ?? '').toUpperCase();
  return SEVERITY_META[raw] || SEVERITY_FALLBACK;
}

/** Just the colour — convenience for severity bars / badges / map pins. */
export function getIncidentSeverityColor(incident) {
  return getIncidentSeverityMeta(incident).color;
}
