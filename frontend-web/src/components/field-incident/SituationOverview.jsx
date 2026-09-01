/**
 * Situation Overview — now just the identity header for the left rail:
 * the field command's name + its incident type and status badges, pinned to
 * the top of the column above the Central Command and Casualty Figures panels.
 *
 * The old casualty-estimate / displaced-persons / incident-status metric block
 * was removed: those numbers were the static MajorIncident estimate and never
 * moved. The LIVE casualty picture is now CasualtyFiguresPanel (fed by the
 * mobile crews' figure reports).
 */

import { useFieldIncidentStore } from '../../store/fieldIncident';

const STATUS_COLOR = {
  DECLARED: '#f59e0b',
  ACTIVE: '#ef4444',
  STABILIZING: '#3b82f6',
  RECOVERY: '#10b981',
  ROUTINE: '#10b981',
  'ACTIVE MONITORING': '#10b981',
  INITIALIZING: '#f59e0b',
  CLOSED: '#78350f',
};

const SituationOverview = () => {
  const majorIncident = useFieldIncidentStore((s) => s.majorIncident);
  const mode = useFieldIncidentStore((s) => s.mode);
  const getSituationSummary = useFieldIncidentStore((s) => s.getSituationSummary);

  const summary = getSituationSummary();

  if (!majorIncident || !summary) {
    return (
      <div className="situation-overview">
        <p className="no-data">No active field command</p>
      </div>
    );
  }

  const isRoutine = mode === 'ROUTINE';
  const titleColor = isRoutine ? '#10b981' : '#dc2626';
  const displayTitle = isRoutine ? 'ROUTINE SECURITY OPERATIONS' : (summary.title || 'Field Command');
  const displayStatus = isRoutine ? 'ACTIVE MONITORING' : (summary.status || 'ACTIVE');
  const displayType = isRoutine ? 'ROUTINE' : (summary.type || 'INCIDENT');

  return (
    <div className="situation-overview">
      <div className="incident-header">
        <div className="incident-title-section">
          <h2 style={{ color: titleColor }}>{displayTitle}</h2>
          <div className="incident-meta">
            <span
              className="type-badge"
              style={{ backgroundColor: isRoutine ? '#065f46' : undefined }}
            >
              {String(displayType).replace(/_/g, ' ')}
            </span>
            <span
              className="status-badge"
              style={{ backgroundColor: STATUS_COLOR[displayStatus] || STATUS_COLOR.ACTIVE }}
            >
              {String(displayStatus).replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SituationOverview;
