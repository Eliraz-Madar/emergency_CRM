import { getIncidentSeverityMeta } from '../utils/incidentMeta.js';

/**
 * The one incident marker used in every incident list across both dashboards:
 * a filled dot in the incident's severity colour with a soft halo ring.
 * Replaces the mix of per-agency emoji / per-status glyphs that used to make
 * every row look different — now the leading mark reads purely as "how bad".
 *
 * Fully self-contained inline styles so it drops into both CSS-class lists
 * (regional IncidentList) and inline-styled rows (FieldCommandSummaryView).
 */
export function IncidentSeverityIcon({ incident, size = 11, title }) {
  const meta = getIncidentSeverityMeta(incident);
  return (
    <span
      role="img"
      aria-label={`${meta.label} severity`}
      title={title ?? `${meta.label} severity`}
      style={{
        display: 'inline-block',
        flexShrink: 0,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        background: meta.color,
        boxShadow: `0 0 0 2px ${meta.color}33, 0 1px 2px rgba(0, 0, 0, 0.35)`,
      }}
    />
  );
}

export default IncidentSeverityIcon;
