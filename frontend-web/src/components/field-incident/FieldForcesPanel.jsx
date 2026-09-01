/**
 * Field Forces Panel — "who is on the ground and what are they doing".
 *
 * Replaces the unused Task Groups panel in the field dashboard's right column.
 * Lists every unit committed to one of this post's incidents, grouped Police /
 * Fire / Medical, each with its live status
 * (Dispatched → En route → On scene → Done) and which incident it's on.
 * Data comes from `summary.incidents[].assigned_units` (FieldCommandIncident
 * Serializer) — no separate fetch.
 */

import { getUnitTypeMeta } from '../../utils/agencyMeta.js';

const FORCES = ['POLICE', 'FIRE', 'MEDICAL'];
const forceLabel = (f) => (f === 'MEDICAL' ? 'Medical' : f.charAt(0) + f.slice(1).toLowerCase());
const forceMeta = (f) => getUnitTypeMeta({ type: f === 'MEDICAL' ? 'EMS' : f });

const forceOf = (type) => {
  const t = (type || '').toUpperCase();
  if (t === 'FIRE') return 'FIRE';
  if (t === 'EMS' || t === 'AMBULANCE' || t === 'MEDICAL') return 'MEDICAL';
  return 'POLICE';
};

// Higher number = further along; used to keep the most advanced status when a
// unit somehow shows on two incidents.
const RANK = { DISPATCHED: 0, EN_ROUTE: 1, ON_SCENE: 2, DONE: 3 };

const phaseOf = (u) => {
  if (!u.is_online) return { key: 'OFFLINE', label: 'Connection lost', color: '#94a3b8' };
  if (u.arrived) return { key: 'ON_SCENE', label: 'On scene', color: '#10b981' };
  if (u.task_status === 'IN_PROGRESS') return { key: 'EN_ROUTE', label: 'En route', color: '#f59e0b' };
  if (u.task_status === 'DONE') return { key: 'DONE', label: 'Task done', color: '#10b981' };
  return { key: 'DISPATCHED', label: 'Dispatched', color: '#38bdf8' };
};

const FieldForcesPanel = ({ summary }) => {
  const incidents = Array.isArray(summary?.incidents) ? summary.incidents : [];

  // Flatten units across incidents, dedupe by id (keep the most advanced).
  const byId = new Map();
  incidents.forEach((inc) => {
    (inc.assigned_units || []).forEach((u) => {
      const phase = phaseOf(u);
      const existing = byId.get(u.id);
      const rank = RANK[phase.key] ?? -1;
      if (!existing || rank > (existing._rank ?? -1)) {
        byId.set(u.id, { ...u, phase, incidentTitle: inc.title, _rank: rank });
      }
    });
  });
  const units = [...byId.values()];

  const byForce = FORCES.reduce((acc, f) => {
    acc[f] = units.filter((u) => forceOf(u.type) === f);
    return acc;
  }, {});

  return (
    <div className="field-forces-panel">
      <h3>👥 Forces on the Ground</h3>

      {units.length === 0 ? (
        <p className="no-data">No units dispatched to this post's incidents yet.</p>
      ) : (
        <div className="forces-groups">
          {FORCES.map((f) => {
            const meta = forceMeta(f);
            const list = byForce[f];
            if (list.length === 0) return null;
            return (
              <div key={f} className="forces-group">
                <div className="forces-group-head" style={{ color: meta.color }}>
                  <span style={{ fontSize: '1.1rem' }}>{meta.emoji}</span>
                  <span>{forceLabel(f)}</span>
                  <span className="forces-count">{list.length}</span>
                </div>
                {list.map((u) => (
                  <div key={u.id} className="forces-row" style={{ opacity: u.is_online ? 1 : 0.6 }}>
                    <div className="forces-row-main">
                      <span className="forces-unit-name">{u.name || `Unit ${u.id}`}</span>
                      <span className="forces-incident">{u.incidentTitle}</span>
                    </div>
                    <span
                      className="forces-status"
                      style={{ color: u.phase.color, borderColor: u.phase.color }}
                    >
                      {u.phase.label}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FieldForcesPanel;
