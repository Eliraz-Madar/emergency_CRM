/**
 * Casualty Figures Panel — the field war-room's LIVE headcount.
 *
 * Every crew submits {injured, dead, trapped, treated, evacuated} per incident
 * from the mobile app (Incidents → Figures). The backend keeps one row per
 * (incident, crew) and this panel shows the post-wide totals — the sum across
 * every incident this command coordinates. The per-incident breakdown now
 * lives inline on each row of the Central Command "Incidents" tab, next to the
 * event it belongs to, rather than as a second list down here.
 * Data is `summary.figure_totals` from FieldCommandSerializer; it refreshes on
 * the same `field_command_note_added` SSE the rest of the dashboard already
 * listens to, so the numbers finally move when a report comes in.
 */

const FIGURES = [
  { key: 'injured',   label: 'Injured',   color: '#f59e0b', icon: '🩹' },
  { key: 'trapped',   label: 'Trapped',   color: '#ef4444', icon: '⛓️' },
  { key: 'dead',      label: 'Dead',      color: '#94a3b8', icon: '🕯️' },
  { key: 'treated',   label: 'Treated',   color: '#3b82f6', icon: '➕' },
  { key: 'evacuated', label: 'Evacuated', color: '#10b981', icon: '🚸' },
];

const zero = { injured: 0, dead: 0, trapped: 0, treated: 0, evacuated: 0 };
const sumAll = (t) => FIGURES.reduce((n, f) => n + (Number(t?.[f.key]) || 0), 0);

const CasualtyFiguresPanel = ({ summary }) => {
  const totals = summary?.figure_totals || zero;
  const anyReported = sumAll(totals) > 0;

  return (
    <div className="casualty-figures-panel">
      <h3>🔢 Casualty Figures</h3>
      <p className="cf-sub">Live from field crews · all incidents</p>

      <div className="cf-grid">
        {FIGURES.map((f) => (
          <div key={f.key} className="cf-cell" style={{ borderColor: `${f.color}55` }}>
            <div className="cf-cell-top">
              <span className="cf-icon">{f.icon}</span>
              <span className="cf-label">{f.label}</span>
            </div>
            <div className="cf-value" style={{ color: f.color }}>
              {Number(totals[f.key]) || 0}
            </div>
          </div>
        ))}
      </div>

      {!anyReported && <p className="cf-none">No figures reported yet.</p>}
    </div>
  );
};

export default CasualtyFiguresPanel;
