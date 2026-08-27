import { useEffect, useState } from 'react';
import { getUnitTasks } from '../api/client.js';

/**
 * Regional dashboard — the card shown in the right column when a vehicle
 * marker is selected on the map. Vehicle details plus the tasks currently
 * assigned to that unit (a freshly-claimed unit with no dispatch has none —
 * tasks only appear once a dispatcher assigns it to an incident).
 */

const TASK_STATUS_META = {
  DONE: { label: 'Done', color: '#10b981' },
  IN_PROGRESS: { label: 'In progress', color: '#3b82f6' },
  PENDING: { label: 'Pending', color: '#f59e0b' },
};

const STATUS_LABEL = {
  ASSIGNED: 'Awaiting acceptance',
  EN_ROUTE: 'On the way',
  ON_SCENE: 'On scene',
};

export function SelectedUnitPanel({ unit, destination }) {
  const [tasks, setTasks] = useState([]);
  const [tasksError, setTasksError] = useState(false);

  useEffect(() => {
    if (!unit?.id) {
      setTasks([]);
      return undefined;
    }
    let cancelled = false;
    setTasksError(false);
    getUnitTasks(unit.id)
      .then((data) => {
        if (cancelled) return;
        // Only tasks that still represent a live assignment — a DONE/CANCELLED
        // task, or one on a closed incident, is history, not a current link.
        const active = (Array.isArray(data) ? data : []).filter(
          (t) => t.status !== 'DONE'
            && t.status !== 'CANCELLED'
            && t.incident_status !== 'CLOSED',
        );
        setTasks(active);
      })
      .catch(() => { if (!cancelled) { setTasks([]); setTasksError(true); } });
    return () => { cancelled = true; };
  }, [unit?.id]);

  if (!unit) return null;

  return (
    <div
      style={{
        background: 'rgba(8, 18, 35, 0.92)',
        border: '1px solid #2563eb',
        borderRadius: '10px',
        padding: '14px',
        marginBottom: '12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div>
          <div style={{ fontSize: '0.95rem', fontWeight: '700' }}>Selected Vehicle</div>
          <div style={{ color: '#94a3b8', fontSize: '0.82rem' }}>Click a unit on the map to inspect it</div>
        </div>
        <span style={{ background: '#2563eb', color: '#fff', borderRadius: '999px', padding: '4px 10px', fontSize: '0.75rem' }}>
          {unit.type || 'Unit'}
        </span>
      </div>
      <div style={{ color: '#e2e8f0', fontSize: '0.95rem', fontWeight: '600' }}>{unit.name || `Unit ${unit.id}`}</div>
      <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }}>
        <div style={{ background: '#0f172a', padding: '10px', borderRadius: '10px', border: '1px solid #334155' }}>
          <div style={{ color: '#94a3b8', fontSize: '0.72rem', textTransform: 'uppercase' }}>Assigned</div>
          <div style={{ marginTop: '4px', color: '#fff', fontWeight: '700' }}>{unit.assignedTo ? 'Yes' : 'No'}</div>
        </div>
        <div style={{ background: '#0f172a', padding: '10px', borderRadius: '10px', border: '1px solid #334155' }}>
          <div style={{ color: '#94a3b8', fontSize: '0.72rem', textTransform: 'uppercase' }}>Destination</div>
          <div style={{ marginTop: '4px', color: '#fff', fontWeight: '700' }}>{destination}</div>
        </div>
      </div>
      <div style={{ marginTop: '10px', color: '#94a3b8', fontSize: '0.85rem' }}>
        Status: {STATUS_LABEL[unit.status] || unit.status || 'Unknown'}
      </div>
      {unit.status === 'EN_ROUTE' && Number.isFinite(unit.etaMin) && (
        <div style={{ marginTop: '6px', display: 'flex', gap: '14px', color: '#e2e8f0', fontSize: '0.85rem' }}>
          <span>ETA: <strong>{Math.max(1, Math.round(unit.etaMin))} min</strong></span>
          {Number.isFinite(unit.distanceKm) && (
            <span>Distance: <strong>{unit.distanceKm.toFixed(1)} km</strong></span>
          )}
        </div>
      )}

      {/* ── Assigned tasks ── */}
      <div style={{ marginTop: '12px', borderTop: '1px solid #1e293b', paddingTop: '10px' }}>
        <div style={{ color: '#94a3b8', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
          Tasks ({tasks.length})
        </div>
        {tasksError ? (
          <div style={{ color: '#f87171', fontSize: '0.8rem' }}>Could not load tasks.</div>
        ) : tasks.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: '0.8rem' }}>No tasks assigned.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '190px', overflowY: 'auto' }}>
            {tasks.map((task) => {
              const meta = TASK_STATUS_META[task.status] || TASK_STATUS_META.PENDING;
              return (
                <div
                  key={task.id}
                  style={{ background: '#0f172a', border: '1px solid #1f2937', borderRadius: '8px', padding: '7px 9px' }}
                >
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: '0.82rem', color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {task.title || 'Task'}
                    </span>
                    <span style={{
                      fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase',
                      color: meta.color, background: `${meta.color}22`, borderRadius: '999px', padding: '2px 7px', whiteSpace: 'nowrap',
                    }}>{meta.label}</span>
                  </div>
                  {task.incident_title && (
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
                      {task.incident_title}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default SelectedUnitPanel;
