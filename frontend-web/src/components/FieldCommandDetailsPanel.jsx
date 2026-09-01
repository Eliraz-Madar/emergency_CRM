import { useState } from 'react';
import { SidePanel } from './SidePanel.jsx';
import { FieldCommandSummaryView } from './FieldCommandSummaryView.jsx';
import { getIncidentChannelMeta } from '../utils/agencyMeta.js';

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
  onRefresh,
  onClose,
  onCloseFieldCommand,
  onLinkIncident,
}) {
  const [activeTab, setActiveTab] = useState('overview');

  if (!selectedFieldCommand) return null;

  // A post opened by escalating a single incident ("Go Live") belongs to that
  // incident alone — no more incidents can ever be linked to it, so there is
  // nothing for the Assign tab to do.
  const eventScoped = Boolean(
    fieldCommandSummary?.major_incident || selectedFieldCommand?.major_incident,
  );
  // guard against a stale 'assign' selection carried over from another post
  const currentTab = eventScoped && activeTab === 'assign' ? 'overview' : activeTab;

  const tabs = [
    { id: 'overview', label: '📋 Overview' },
    ...(eventScoped ? [] : [{ id: 'assign', label: '🔗 Assign' }]),
    { id: 'close', label: '⚙ Close' },
  ];

  const linkableIncidents = Array.isArray(incidents)
    ? incidents.filter((inc) => !inc.field_command && inc.status !== 'CLOSED')
    : [];

  // Shared POLICE/FIRE/EMS/HOMEFRONT palette — see utils/agencyMeta.js.
  // The read-only Overview lists get the same icons via FieldCommandSummaryView;
  // getUnitTypeMeta / getIncidentChannelMeta below are for the Assign tab's
  // linkable lists.

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
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            style={{
              flex: 1,
              padding: '9px 0',
              background: currentTab === id ? 'rgba(59,130,246,0.10)' : 'transparent',
              color: currentTab === id ? '#60a5fa' : '#6b7280',
              border: 'none',
              borderBottom: currentTab === id ? '2px solid #3b82f6' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '0.82rem',
              fontWeight: '600',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* the assign tab manages its own inner scroll area, so the outer
          wrapper must not also scroll (same "don't double-scroll" rule
          IncidentDetailsPanel.jsx applies to its Events tab). */}
      <div
        className={currentTab === 'assign' ? '' : 'cc-list-scrollable'}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: currentTab === 'assign' ? 'hidden' : 'auto',
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column',
        }}
      >

        {/* ── Overview tab: read-only status ──
            Rendered by the shared FieldCommandSummaryView so this panel and
            the field command's own dashboard (FieldIncidentDashboard) never
            drift apart. All sections shown here; the field dashboard reuses
            the same component with a narrower `sections` list. */}
        {currentTab === 'overview' && (
          <FieldCommandSummaryView summary={fieldCommandSummary} />
        )}

        {/* ── Assign tab: link incidents to this post. Units are NOT assigned
              to a field command — they're dispatched to incidents, and the
              post coordinates them through the incidents it owns. ── */}
        {currentTab === 'assign' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '4px', flexShrink: 0 }}>
              Link incidents
            </div>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: '10px', flexShrink: 0 }}>
              Forces are dispatched to incidents, not to the post.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, border: '1px solid #1f2937', borderRadius: '6px', padding: '8px', flex: 1 }}>
              <div className="cc-section-label text-xs uppercase text-slate-500 font-bold mb-2" style={{ flexShrink: 0 }}>Unlinked incidents</div>
              <div className="cc-list-scrollable" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {/* Closed incidents are never linkable — they're done,
                    not a target for further field-command coordination. */}
                {linkableIncidents.length ? (
                  linkableIncidents.map((inc) => (
                    <div key={inc.id} style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div
                        style={{ flex: 1, fontSize: '0.76rem', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.3 }}
                      >
                        {getIncidentChannelMeta(inc).emoji} {inc.title || `Incident ${inc.id}`}
                      </div>
                      <button
                        className="feed-toggle"
                        style={{ fontSize: '0.68rem', padding: '0.2rem 0.6rem', flexShrink: 0 }}
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
          </div>
        )}

        {/* ── Close tab ── */}
        {currentTab === 'close' && (
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
