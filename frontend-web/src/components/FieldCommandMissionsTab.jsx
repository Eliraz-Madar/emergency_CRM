import { useState } from 'react';

/**
 * "Missions" tab of the war-room FieldCommandDetailsPanel.
 *
 * A mission is a titled tasking the central command gives this field command
 * post, optionally handed to one of the post's attached forces. Creating /
 * updating one hits /api/field-commands/{key}/missions/ and is logged to the
 * post's Operational Timeline server-side.
 */

const STATUS_OPTIONS = [
  { value: 'OPEN', label: 'Open', color: '#f59e0b' },
  { value: 'IN_PROGRESS', label: 'In progress', color: '#3b82f6' },
  { value: 'DONE', label: 'Done', color: '#10b981' },
];

const selectStyle = {
  width: '100%',
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: '6px',
  color: '#e2e8f0',
  fontSize: '0.78rem',
  padding: '5px 7px',
};

export function FieldCommandMissionsTab({
  missions = [],
  units = [],
  disabled = false,
  busy = false,
  onCreateMission,
  onUpdateMission,
}) {
  const [form, setForm] = useState({ title: '', details: '', assigned_unit: '' });

  const canSubmit = form.title.trim() && !disabled && !busy;

  const submit = () => {
    if (!canSubmit) return;
    onCreateMission({
      title: form.title.trim(),
      details: form.details.trim(),
      assigned_unit: form.assigned_unit ? Number(form.assigned_unit) : null,
    });
    setForm({ title: '', details: '', assigned_unit: '' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* ── Existing missions ── */}
      <div>
        <div className="cc-section-label">🎯 Missions ({missions.length})</div>
        {missions.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {missions.map((mission) => {
              const meta = STATUS_OPTIONS.find((s) => s.value === mission.status) || STATUS_OPTIONS[0];
              return (
                <div
                  key={mission.id}
                  style={{
                    border: '1px solid #1f2937', borderRadius: '8px',
                    padding: '9px 10px', background: '#0f172a',
                  }}
                >
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ flex: 1, fontSize: '0.84rem', fontWeight: 600 }}>{mission.title}</span>
                    <span style={{
                      fontSize: '0.64rem', fontWeight: 700, textTransform: 'uppercase',
                      color: meta.color, background: `${meta.color}22`,
                      borderRadius: '999px', padding: '2px 8px',
                    }}>{meta.label}</span>
                  </div>
                  {mission.details && (
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '3px' }}>{mission.details}</div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '8px' }}>
                    <select
                      value={mission.status}
                      disabled={disabled || busy}
                      onChange={(e) => onUpdateMission(mission.id, { status: e.target.value })}
                      style={selectStyle}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                    <select
                      value={mission.assigned_unit || ''}
                      disabled={disabled || busy}
                      onChange={(e) => onUpdateMission(mission.id, {
                        assigned_unit: e.target.value ? Number(e.target.value) : null,
                      })}
                      style={selectStyle}
                    >
                      <option value="">Unassigned</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>{u.name || `Unit ${u.id}`}</option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No missions yet.</div>
        )}
      </div>

      {/* ── New mission ── */}
      <div style={{ borderTop: '1px solid #1f2937', paddingTop: '12px' }}>
        <div className="cc-section-label">➕ New mission</div>
        {disabled && (
          <div style={{ fontSize: '0.76rem', color: '#f59e0b', marginBottom: '6px' }}>
            This field command is closed.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <input
            type="text"
            value={form.title}
            placeholder="Mission title (required)"
            disabled={disabled || busy}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            style={{ ...selectStyle }}
          />
          <textarea
            value={form.details}
            placeholder="Details (optional)"
            rows={2}
            disabled={disabled || busy}
            onChange={(e) => setForm((f) => ({ ...f, details: e.target.value }))}
            style={{ ...selectStyle, resize: 'vertical' }}
          />
          <select
            value={form.assigned_unit}
            disabled={disabled || busy}
            onChange={(e) => setForm((f) => ({ ...f, assigned_unit: e.target.value }))}
            style={selectStyle}
          >
            <option value="">Assign to a force (optional)</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.name || `Unit ${u.id}`} ({u.type})</option>
            ))}
          </select>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="feed-toggle"
              onClick={submit}
              disabled={!canSubmit}
              style={{
                fontSize: '0.8rem', padding: '0.45rem 0.9rem',
                opacity: canSubmit ? 1 : 0.6,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              Add Mission
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FieldCommandMissionsTab;
