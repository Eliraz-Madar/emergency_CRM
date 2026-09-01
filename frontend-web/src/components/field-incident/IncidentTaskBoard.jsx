/**
 * Incident Task Board — the field control room's operational view.
 *
 * Replaces the old "Operational Sectors" panel. Shows every force-typed task
 * the war room assigned to this post's incidents, grouped Police / Fire /
 * Medical, with its status. The field operator can advance a task here; a
 * mobile crew of that force does the same from the app (Phase 3). Data comes
 * straight from the FieldCommand summary (`summary.missions`) — no separate
 * fetch.
 */

import { getUnitTypeMeta } from '../../utils/agencyMeta.js';

const FORCES = ['POLICE', 'FIRE', 'MEDICAL'];
const forceLabel = (f) => (f === 'MEDICAL' ? 'Medical' : f.charAt(0) + f.slice(1).toLowerCase());
const forceMeta = (f) => getUnitTypeMeta({ type: f === 'MEDICAL' ? 'EMS' : f });

const STATUS_META = {
  OPEN: { label: 'Open', color: '#f59e0b' },
  IN_PROGRESS: { label: 'On it', color: '#3b82f6' },
  DONE: { label: 'Done', color: '#10b981' },
};

const IncidentTaskBoard = ({ summary, onStatusChange, busyId, disabled = false }) => {
  const tasks = (Array.isArray(summary?.missions) ? summary.missions : [])
    .filter((m) => m.force_type); // force-typed = a field task, not a plain post note

  const byForce = FORCES.reduce((acc, f) => {
    acc[f] = tasks.filter((t) => t.force_type === f);
    return acc;
  }, {});

  return (
    <div className="incident-task-board">
      <h3>🗂 Field Tasks</h3>

      {tasks.length === 0 ? (
        <p className="no-data">
          No tasks assigned yet — the war room assigns tasks by force from an incident's Tasks tab.
        </p>
      ) : (
        <div className="task-board-groups">
          {FORCES.map((f) => {
            const meta = forceMeta(f);
            const list = byForce[f];
            return (
              <div key={f} className="task-board-group">
                <div className="task-board-group-head" style={{ color: meta.color }}>
                  <span style={{ fontSize: '1.1rem' }}>{meta.emoji}</span>
                  <span>{forceLabel(f)}</span>
                  <span className="task-board-count">{list.length}</span>
                </div>
                {list.length === 0 ? (
                  <div className="task-board-empty">No tasks</div>
                ) : (
                  list.map((t) => {
                    const sm = STATUS_META[t.status] || STATUS_META.OPEN;
                    return (
                      <div key={t.id} className="task-board-row">
                        <div className="task-board-row-main">
                          <span
                            className="task-board-title"
                            style={{
                              textDecoration: t.status === 'DONE' ? 'line-through' : 'none',
                              opacity: t.status === 'DONE' ? 0.6 : 1,
                            }}
                          >
                            {t.title}
                          </span>
                          {t.incident_title && (
                            <span className="task-board-incident">{t.incident_title}</span>
                          )}
                        </div>
                        <select
                          value={t.status}
                          disabled={disabled || busyId === t.id}
                          onChange={(e) => onStatusChange?.(t.id, e.target.value)}
                          className="task-board-status"
                          style={{ color: sm.color, borderColor: sm.color }}
                        >
                          {Object.entries(STATUS_META).map(([v, m]) => (
                            <option key={v} value={v}>{m.label}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default IncidentTaskBoard;
