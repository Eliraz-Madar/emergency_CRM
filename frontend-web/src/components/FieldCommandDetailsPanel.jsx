import { useState } from 'react';
import { SidePanel } from './SidePanel.jsx';

/**
 * FieldCommand detail panel — extracted from Dashboard.jsx's inline
 * "Field Command Overview" markup, now rendered inside the shared
 * SidePanel shell (see IncidentDetailsPanel.jsx for the same pattern).
 *
 * One deliberate behavior change beyond a pure extraction, flagged here:
 * the original inline block was ALWAYS mounted (showing an empty-state
 * message when nothing was selected), because it lived in-flow and cost
 * nothing to leave sitting there. Wrapped in SidePanel's position: fixed
 * shell, staying always-mounted would mean an empty floating panel
 * permanently covering the map whenever nothing is selected — clearly
 * wrong, and it would also make the new close button meaningless (nothing
 * to close). So this component now returns null when nothing is selected,
 * exactly mirroring IncidentDetailsPanel's `if (!incident) return null`
 * — the panel only exists while there's something to show.
 *
 * Content is split into tabs (Overview / Assign / Close), same pattern as
 * IncidentDetailsPanel's Dispatch/Events/Major Incident/Settings tabs —
 * replaces a single long scrolling column where the read-only status
 * lists (Assigned Incidents/Forces) and the actionable lists (Link
 * Incident, Assign Global Forces) were easy to mistake for one mixed list.
 */
export function FieldCommandDetailsPanel({
  selectedFieldCommand,
  fieldCommandSummary,
  fieldCommandLoading,
  fieldCommandError,
  closeFieldReason,
  setCloseFieldReason,
  closeFieldRole,
  setCloseFieldRole,
  incidents,
  sortedAssignableUnits,
  onRefresh,
  onClose,
  onCloseFieldCommand,
  onLinkIncident,
  onAssignUnit,
}) {
  const [activeTab, setActiveTab] = useState('overview');

  if (!selectedFieldCommand) return null;

  const linkableIncidents = Array.isArray(incidents)
    ? incidents.filter((inc) => !inc.field_command && inc.status !== 'CLOSED')
    : [];

  // Same POLICE/FIRE/EMS vehicle palette used everywhere else (MapView.jsx's
  // point-dispatch markers, IncidentList.jsx's row icons) — a unit's own
  // `type` field (backend Unit.UnitType: Police/Fire/EMS/HomeFront) or an
  // incident's `channel` field key into it. Previously this panel hardcoded
  // 🚓 as a generic "forces" icon (wrong for EMS/Fire units) and 🚨 as a
  // generic incident icon regardless of type.
  const UNIT_TYPE_META = {
    POLICE: { emoji: '🚓', color: '#3b82f6' },
    FIRE: { emoji: '🚒', color: '#ef4444' },
    EMS: { emoji: '🚑', color: '#10b981' },
    HOMEFRONT: { emoji: '🏠', color: '#6b7280' },
  };
  const getUnitMeta = (unit) =>
    UNIT_TYPE_META[(unit?.type || '').toUpperCase()] || { emoji: '🚨', color: '#94a3b8' };
  const getIncidentMeta = (incident) =>
    UNIT_TYPE_META[(incident?.channel || '').toUpperCase()] || { emoji: '🚨', color: '#94a3b8' };

  return (
    <SidePanel title="Field Command Overview" onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem 0', flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{selectedFieldCommand.name || selectedFieldCommand.id}</div>
          <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
            Incidents: {fieldCommandSummary?.incidents?.length ?? selectedFieldCommand.incidents_count ?? 0} | Forces: {fieldCommandSummary?.units?.length ?? selectedFieldCommand.units_count ?? 0}
          </div>
        </div>
        <button
          className="feed-toggle"
          onClick={onRefresh}
          style={{ fontSize: '0.75rem', flexShrink: 0 }}
        >
          ⟳ Refresh
        </button>
      </div>

      {fieldCommandError && (
        <div style={{ color: '#ef4444', fontSize: '0.8rem', padding: '6px 1rem 0', flexShrink: 0 }}>
          {fieldCommandError}
        </div>
      )}

      {fieldCommandLoading && (
        <div style={{ color: '#e2e8f0', fontSize: '0.8rem', padding: '8px 1rem 0', flexShrink: 0 }}>
          Loading field command data...
        </div>
      )}

      {/* ── Tab Bar ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1e293b', flexShrink: 0, marginTop: '10px' }}>
        {[
          { id: 'overview', label: '📋 Overview' },
          { id: 'assign',   label: '🔗 Assign'   },
          { id: 'close',    label: '⚙ Close'     },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            style={{
              flex: 1,
              padding: '9px 0',
              background: activeTab === id ? 'rgba(59,130,246,0.10)' : 'transparent',
              color: activeTab === id ? '#60a5fa' : '#6b7280',
              border: 'none',
              borderBottom: activeTab === id ? '2px solid #3b82f6' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '0.82rem',
              fontWeight: '600',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* assign tab: the two columns below each scroll independently, so the
          outer wrapper must not also scroll (same "don't double-scroll"
          rule IncidentDetailsPanel.jsx applies to its Events tab). */}
      <div
        className={activeTab === 'assign' ? '' : 'cc-list-scrollable'}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: activeTab === 'assign' ? 'hidden' : 'auto',
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column',
        }}
      >

        {/* ── Overview tab: read-only status ── */}
        {activeTab === 'overview' && (
          <>
            {fieldCommandSummary && (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '0.8rem', color: '#e2e8f0' }}>
                  <div>Status: {fieldCommandSummary.status || 'ACTIVE'}</div>
                  <div>Phase: {fieldCommandSummary.incident_phase || 'Containment'}</div>
                  <div>Casualties: {fieldCommandSummary.casualty_count ?? 0}</div>
                  <div>Evacuated: {fieldCommandSummary.evacuated_count ?? 0}</div>
                </div>

                {/* Linked Major Incident — no dedicated MajorIncident panel/
                    selection mechanism exists anywhere in the app, so this is
                    informational only, unlike IncidentDetailsPanel's
                    clickable jump-to-FieldCommand link. */}
                {fieldCommandSummary.major_incident && (
                  <div style={{
                    marginTop: '12px', padding: '10px', background: '#0f172a',
                    border: '1px solid #1f2937', borderRadius: '6px',
                  }}>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Major Incident
                    </div>
                    <div style={{ fontSize: '0.85rem', fontWeight: '600', color: '#f87171', marginTop: '2px' }}>
                      {fieldCommandSummary.major_incident.title}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#cbd5e1', marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      <span>Type: {fieldCommandSummary.major_incident.incident_type}</span>
                      <span>Status: {fieldCommandSummary.major_incident.status}</span>
                      <span>Casualties: {fieldCommandSummary.major_incident.estimated_casualties ?? 0}</span>
                    </div>
                  </div>
                )}

                <div style={{ marginTop: '14px' }}>
                  <div className="cc-section-label text-xs uppercase text-slate-500 font-bold mb-2">📝 Operational Notes</div>
                  {fieldCommandSummary.operational_notes?.length ? (
                    <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                      {fieldCommandSummary.operational_notes.map((note, idx) => (
                        <div key={`${note.timestamp || idx}`} style={{ fontSize: '0.78rem', padding: '4px 0' }}>
                          <div style={{ color: '#94a3b8' }}>{note.timestamp || ''}</div>
                          <div>{note.message || ''}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>No notes yet.</div>
                  )}
                </div>

                <div style={{ marginTop: '14px' }}>
                  <div className="cc-section-label text-xs uppercase text-slate-500 font-bold mb-2">🚨 Assigned Incidents</div>
                  {fieldCommandSummary.incidents?.length ? (
                    <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                      {fieldCommandSummary.incidents.map((incident) => (
                        <div key={incident.id} style={{ fontSize: '0.8rem', padding: '4px 0' }}>
                          {getIncidentMeta(incident).emoji} {incident.title || 'Incident'}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No assigned incidents</div>
                  )}
                </div>

                <div style={{ marginTop: '14px' }}>
                  <div className="cc-section-label text-xs uppercase text-slate-500 font-bold mb-2">👥 Assigned Forces</div>
                  {fieldCommandSummary.units?.length ? (
                    <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                      {fieldCommandSummary.units.map((unit) => (
                        <div key={unit.id} style={{ fontSize: '0.8rem', padding: '4px 0' }}>
                          {getUnitMeta(unit).emoji} {unit.name || `Unit ${unit.id}`} ({unit.type})
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No assigned forces</div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* ── Assign tab: two independently-scrolling columns (Incidents | Units)
              instead of two stacked lists — each column keeps its own scroll
              area so scrolling one never affects the other. ── */}
        {activeTab === 'assign' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '10px', flexShrink: 0 }}>
              Link incidents / units
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', flex: 1, minHeight: 0 }}>
              {/* Incidents column */}
              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, border: '1px solid #1f2937', borderRadius: '6px', padding: '8px' }}>
                <div className="cc-section-label text-xs uppercase text-slate-500 font-bold mb-2" style={{ flexShrink: 0 }}>Incidents</div>
                <div className="cc-list-scrollable" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                  {/* Closed incidents are never linkable — they're done,
                      not a target for further field-command coordination. */}
                  {linkableIncidents.length ? (
                    linkableIncidents.map((inc) => (
                      <div key={inc.id} style={{ marginBottom: '8px' }}>
                        <div
                          style={{ fontSize: '0.76rem', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.3, marginBottom: '3px' }}
                        >
                          {getIncidentMeta(inc).emoji} {inc.title || `Incident ${inc.id}`}
                        </div>
                        <button
                          className="feed-toggle"
                          style={{ width: '100%', fontSize: '0.68rem', padding: '0.2rem 0.4rem' }}
                          onClick={() => onLinkIncident(inc.id)}
                        >
                          Link
                        </button>
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>No unlinked incidents</div>
                  )}
                </div>
              </div>

              {/* Units column */}
              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, border: '1px solid #1f2937', borderRadius: '6px', padding: '8px' }}>
                <div className="cc-section-label text-xs uppercase text-slate-500 font-bold mb-2" style={{ flexShrink: 0 }}>Units (nearest first)</div>
                <div className="cc-list-scrollable" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                  {sortedAssignableUnits.length ? (
                    sortedAssignableUnits.map((unit) => (
                      <div key={unit.id} style={{ marginBottom: '8px' }}>
                        <div
                          style={{ fontSize: '0.76rem', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.3, marginBottom: '3px' }}
                        >
                          {getUnitMeta(unit).emoji} {unit.name || `Unit ${unit.id}`}
                          {' '}
                          <span style={{ color: '#64748b' }}>
                            ({Number.isFinite(unit.distanceKm) ? `${unit.distanceKm.toFixed(1)} km` : 'No GPS'})
                          </span>
                        </div>
                        <button
                          className="feed-toggle"
                          style={{ width: '100%', fontSize: '0.68rem', padding: '0.2rem 0.4rem' }}
                          onClick={() => onAssignUnit(unit.id)}
                        >
                          Assign
                        </button>
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>No unassigned forces available</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Close tab ── */}
        {activeTab === 'close' && (
          <div>
            <div className="cc-section-label text-xs uppercase text-slate-500 font-bold mb-2">Close Field Command Post</div>
            <textarea
              value={closeFieldReason}
              onChange={(e) => setCloseFieldReason(e.target.value)}
              placeholder="Closure reason (required)..."
              rows={3}
              style={{
                width: '100%',
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#e2e8f0',
                fontSize: '0.8rem',
                padding: '6px 8px',
                resize: 'vertical',
                marginBottom: '6px',
              }}
            />
            <select
              value={closeFieldRole}
              onChange={(e) => setCloseFieldRole(e.target.value)}
              style={{ width: '100%', padding: '5px', borderRadius: '6px', marginBottom: '8px', fontSize: '0.78rem' }}
            >
              <option value="COMMAND_CENTER">Closed by: Command Center</option>
              <option value="FIELD_OPERATOR">Closed by: Field Operator</option>
            </select>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="feed-toggle"
                onClick={onCloseFieldCommand}
                disabled={fieldCommandLoading || !closeFieldReason.trim()}
                style={{
                  backgroundColor: '#ef4444',
                  borderColor: '#ef4444',
                  fontSize: '0.8rem',
                  padding: '0.5rem 0.75rem',
                  opacity: !closeFieldReason.trim() ? 0.6 : 1,
                  cursor: !closeFieldReason.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                Close Camp
              </button>
            </div>
          </div>
        )}
      </div>
    </SidePanel>
  );
}
