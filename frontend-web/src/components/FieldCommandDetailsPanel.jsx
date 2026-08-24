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
 * The other unavoidable, purely cosmetic consequence of adopting the
 * shared shell: SidePanel's header only has room for icon/title/subtitle
 * on the left and the close button on the right — there's no slot for a
 * second header action button. The "⟳ Refresh" button (previously sharing
 * the header row with the title) now sits as the first line of the body
 * instead. Same button, same handler, same label — just relocated by a
 * few dozen pixels to make room for the new close button.
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
  if (!selectedFieldCommand) return null;

  return (
    <SidePanel title="Field Command Overview" onClose={onClose}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="feed-toggle"
            onClick={onRefresh}
            style={{ fontSize: '0.75rem' }}
          >
            ⟳ Refresh
          </button>
        </div>
        {fieldCommandError && (
          <div style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: '6px' }}>
            {fieldCommandError}
          </div>
        )}
        <div style={{ marginTop: '10px' }}>
          <div style={{ fontWeight: 600 }}>{selectedFieldCommand.name || selectedFieldCommand.id}</div>
          <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
            Incidents: {fieldCommandSummary?.incidents?.length ?? selectedFieldCommand.incidents_count ?? 0} | Forces: {fieldCommandSummary?.units?.length ?? selectedFieldCommand.units_count ?? 0}
          </div>

          {fieldCommandLoading && (
            <div style={{ color: '#e2e8f0', fontSize: '0.8rem', marginTop: '8px' }}>
              Loading field command data...
            </div>
          )}

          {fieldCommandSummary && (
            <>
              <div style={{ marginTop: '10px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '0.8rem', color: '#e2e8f0' }}>
                  <div>Status: {fieldCommandSummary.status || 'ACTIVE'}</div>
                  <div>Phase: {fieldCommandSummary.incident_phase || 'Containment'}</div>
                  <div>Casualties: {fieldCommandSummary.casualty_count ?? 0}</div>
                  <div>Evacuated: {fieldCommandSummary.evacuated_count ?? 0}</div>
                </div>
              </div>

              {/* Linked Major Incident — no dedicated MajorIncident panel/
                  selection mechanism exists anywhere in the app, so this is
                  informational only, unlike IncidentDetailsPanel's
                  clickable jump-to-FieldCommand link. */}
              {fieldCommandSummary.major_incident && (
                <div style={{
                  marginTop: '10px', padding: '10px', background: '#0f172a',
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

              <div style={{ marginTop: '10px' }}>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px' }}>Operational Notes</div>
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
              <div style={{ marginTop: '10px' }}>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px' }}>Assigned Incidents</div>
                {fieldCommandSummary.incidents?.length ? (
                  <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                    {fieldCommandSummary.incidents.map((incident) => (
                      <div key={incident.id} style={{ fontSize: '0.8rem', padding: '4px 0' }}>
                        {incident.title || 'Incident'}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No assigned incidents</div>
                )}
              </div>

              <div style={{ marginTop: '10px' }}>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px' }}>Assigned Forces</div>
                {fieldCommandSummary.units?.length ? (
                  <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                    {fieldCommandSummary.units.map((unit) => (
                      <div key={unit.id} style={{ fontSize: '0.8rem', padding: '4px 0' }}>
                        {unit.name || `Unit ${unit.id}`} ({unit.type})
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No assigned forces</div>
                )}
              </div>

              <div style={{ marginTop: '12px' }}>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px' }}>Close Field Command Post</div>
                <textarea
                  value={closeFieldReason}
                  onChange={(e) => setCloseFieldReason(e.target.value)}
                  placeholder="Closure reason (required)..."
                  rows={2}
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
            </>
          )}

          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px' }}>Link Incident</div>
            {/* Closed incidents are never linkable — they're done,
                not a target for further field-command coordination. */}
            {Array.isArray(incidents) && incidents.filter((inc) => !inc.field_command && inc.status !== 'CLOSED').length ? (
              <div style={{ maxHeight: '140px', overflowY: 'auto' }}>
                {incidents.filter((inc) => !inc.field_command && inc.status !== 'CLOSED').slice(0, 10).map((inc) => (
                  <div key={inc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '0.8rem' }}>{inc.title || `Incident ${inc.id}`}</span>
                    <button
                      className="feed-toggle"
                      style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
                      onClick={() => onLinkIncident(inc.id)}
                    >
                      Link
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>No unlinked incidents</div>
            )}
          </div>

          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px' }}>Assign Global Forces (nearest first)</div>
            {sortedAssignableUnits.length ? (
              <div style={{ maxHeight: '140px', overflowY: 'auto' }}>
                {sortedAssignableUnits.slice(0, 10).map((unit) => (
                  <div key={unit.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '0.8rem' }}>
                      {unit.name || `Unit ${unit.id}`} ({Number.isFinite(unit.distanceKm) ? `${unit.distanceKm.toFixed(1)} km` : 'No GPS'})
                    </span>
                    <button
                      className="feed-toggle"
                      style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
                      onClick={() => onAssignUnit(unit.id)}
                    >
                      Assign
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No unassigned forces available</div>
            )}
          </div>
        </div>
      </div>
    </SidePanel>
  );
}
