import { getUnitTypeMeta } from '../utils/agencyMeta.js';
import { formatDateTime } from '../utils/time.js';
import { IncidentSeverityIcon } from './IncidentSeverityIcon.jsx';

/**
 * Read-only view of a Field Command's live state, rendered straight from the
 * FieldCommandSerializer shape (GET /api/field-commands/{id}/).
 *
 * Single source of truth for "what the central room knows about this post",
 * shared by:
 *   - FieldCommandDetailsPanel (regional / war-room dashboard) — the panel
 *     that opens when a field-command marker is selected on the map. Renders
 *     every section, stacked, inside a scrollable side panel.
 *   - FieldCommandAssignmentsPanel (the field command's own dashboard) —
 *     renders ONE section at a time behind a tab bar, so the two dashboards
 *     always show the same assigned incidents / forces / missions.
 *
 * Purely presentational: no store, no fetching. `sections` picks which blocks
 * to show and in what order.
 */

const ALL_SECTIONS = ['metrics', 'majorIncident', 'notes', 'incidents', 'forces', 'missions'];

const MISSION_STATUS_META = {
  OPEN: { label: 'Open', color: '#f59e0b' },
  IN_PROGRESS: { label: 'In progress', color: '#3b82f6' },
  DONE: { label: 'Done', color: '#10b981' },
};

// Per-incident casualty figures shown inline on each assigned-incident row —
// same five headcounts the field crews submit (IncidentFigureReport), same
// order/labels/colours the Casualty Figures grid uses. Only non-zero figures
// are rendered.
const FIGURE_META = [
  { key: 'injured', label: 'Injured', color: '#f59e0b', icon: '🩹' },
  { key: 'trapped', label: 'Trapped', color: '#ef4444', icon: '⛓️' },
  { key: 'dead', label: 'Dead', color: '#94a3b8', icon: '🕯️' },
  { key: 'treated', label: 'Treated', color: '#3b82f6', icon: '➕' },
  { key: 'evacuated', label: 'Evacuated', color: '#10b981', icon: '🚸' },
];

function IncidentFigures({ report }) {
  const nonZero = FIGURE_META.filter((f) => (Number(report?.[f.key]) || 0) > 0);
  if (nonZero.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '5px', width: '100%' }}>
      {nonZero.map((f) => (
        <span
          key={f.key}
          title={f.label}
          style={{
            fontSize: '0.68rem', fontWeight: 700, lineHeight: 1,
            color: f.color, background: `${f.color}1f`,
            border: `1px solid ${f.color}55`, borderRadius: '999px',
            padding: '2px 6px', whiteSpace: 'nowrap',
          }}
        >
          {f.icon} {Number(report[f.key]) || 0}
        </span>
      ))}
    </div>
  );
}

const rowStyle = {
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
  fontSize: '0.82rem',
  padding: '7px 9px',
  borderRadius: '7px',
  background: 'rgba(148, 163, 184, 0.08)',
  marginBottom: '5px',
};

const tagStyle = {
  fontSize: '0.64rem',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: '#cbd5e1',
  background: 'rgba(148, 163, 184, 0.16)',
  borderRadius: '999px',
  padding: '2px 7px',
  whiteSpace: 'nowrap',
};

const emptyStyle = { fontSize: '0.8rem', color: '#94a3b8', padding: '4px 2px' };

function SectionHeading({ icon, label, count }) {
  return (
    <div className="cc-section-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span>{icon} {label}</span>
      {count != null && (
        <span style={{
          fontSize: '0.66rem', fontWeight: 700, color: '#e2e8f0',
          background: 'rgba(148,163,184,0.2)', borderRadius: '999px',
          padding: '1px 7px', minWidth: '18px', textAlign: 'center',
        }}>{count}</span>
      )}
    </div>
  );
}

export function FieldCommandSummaryView({ summary, sections = ALL_SECTIONS, hideHeadings = false }) {
  if (!summary) return null;

  const show = (key) => sections.includes(key);
  const Heading = hideHeadings ? () => null : SectionHeading;
  const incidents = Array.isArray(summary.incidents) ? summary.incidents : [];
  const units = Array.isArray(summary.units) ? summary.units : [];
  const missions = Array.isArray(summary.missions) ? summary.missions : [];
  const notes = Array.isArray(summary.operational_notes) ? summary.operational_notes : [];

  return (
    <div className="fc-summary" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {show('metrics') && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '0.8rem', color: '#e2e8f0' }}>
          <div>Status: {summary.status || 'ACTIVE'}</div>
          <div>Phase: {summary.incident_phase || 'Containment'}</div>
          <div>Casualties: {summary.casualty_count ?? 0}</div>
          <div>Evacuated: {summary.evacuated_count ?? 0}</div>
        </div>
      )}

      {show('majorIncident') && summary.major_incident && (
        <div style={{
          padding: '10px', background: '#0f172a',
          border: '1px solid #1f2937', borderRadius: '6px',
        }}>
          <div style={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Major Incident
          </div>
          <div style={{ fontSize: '0.85rem', fontWeight: '600', color: '#f87171', marginTop: '2px' }}>
            {summary.major_incident.title}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#cbd5e1', marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <span>Type: {summary.major_incident.incident_type}</span>
            <span>Status: {summary.major_incident.status}</span>
            <span>Casualties: {summary.major_incident.estimated_casualties ?? 0}</span>
          </div>
        </div>
      )}

      {show('notes') && (
        <div>
          <Heading icon="📝" label="Operational Notes" count={notes.length || null} />
          {notes.length ? (
            <div className="fc-scroll-area" style={{ maxHeight: '160px', overflowY: 'auto' }}>
              {notes.map((note, idx) => (
                <div
                  key={`${note.timestamp || idx}`}
                  style={{
                    fontSize: '0.78rem',
                    padding: '6px 0',
                    borderBottom: idx < notes.length - 1 ? '1px solid rgba(148,163,184,0.15)' : 'none',
                  }}
                >
                  <div style={{ color: '#94a3b8', fontSize: '0.7rem', marginBottom: '2px' }}>
                    {note.timestamp ? formatDateTime(note.timestamp) : ''}
                  </div>
                  <div style={{ lineHeight: 1.35 }}>{note.message || ''}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={emptyStyle}>No notes yet.</div>
          )}
        </div>
      )}

      {show('incidents') && (
        <div>
          <Heading icon="🚨" label="Assigned Incidents" count={incidents.length} />
          {incidents.length ? (
            <div className="fc-scroll-area" style={{ maxHeight: '240px', overflowY: 'auto' }}>
              {incidents.map((incident) => (
                <div key={incident.id} style={{ ...rowStyle, flexWrap: 'wrap' }}>
                  <IncidentSeverityIcon incident={incident} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {incident.title || 'Incident'}
                  </span>
                  {incident.status && (
                    <span style={tagStyle}>{String(incident.status).replace(/_/g, ' ')}</span>
                  )}
                  <IncidentFigures report={incident.figure_report} />
                </div>
              ))}
            </div>
          ) : (
            <div style={emptyStyle}>No assigned incidents</div>
          )}
        </div>
      )}

      {show('forces') && (
        <div>
          <Heading icon="👥" label="Assigned Forces" count={units.length} />
          {units.length ? (
            <div className="fc-scroll-area" style={{ maxHeight: '240px', overflowY: 'auto' }}>
              {units.map((unit) => (
                <div key={unit.id} style={rowStyle}>
                  <span>{getUnitTypeMeta(unit).emoji}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {unit.name || `Unit ${unit.id}`}
                  </span>
                  {unit.type && <span style={tagStyle}>{unit.type}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div style={emptyStyle}>No assigned forces</div>
          )}
        </div>
      )}

      {show('missions') && (
        <div>
          <Heading icon="🎯" label="Tasks" count={missions.length} />
          {missions.length ? (
            <div className="fc-scroll-area" style={{ maxHeight: '260px', overflowY: 'auto' }}>
              {missions.map((mission) => {
                const meta = MISSION_STATUS_META[mission.status] || MISSION_STATUS_META.OPEN;
                return (
                  <div key={mission.id} style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {mission.title}
                      </span>
                      <span style={{ ...tagStyle, color: meta.color, background: `${meta.color}22` }}>
                        {meta.label}
                      </span>
                    </div>
                    {mission.details && (
                      <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>{mission.details}</div>
                    )}
                    <div style={{ fontSize: '0.72rem', color: '#cbd5e1' }}>
                      {mission.assigned_unit_name
                        ? <>👤 {mission.assigned_unit_name}{mission.assigned_unit_type ? ` · ${mission.assigned_unit_type}` : ''}</>
                        : <span style={{ color: '#64748b' }}>Unassigned</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={emptyStyle}>No tasks</div>
          )}
        </div>
      )}
    </div>
  );
}

export default FieldCommandSummaryView;
