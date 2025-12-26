/**
 * Situation Overview Component
 *
 * Displays high-level incident status, casualty estimates, and operational metrics.
 * Command-level situational awareness for major incident response.
 */

import { useFieldIncidentStore } from '../../store/fieldIncident';

const SituationOverview = () => {
  const majorIncident = useFieldIncidentStore((s) => s.majorIncident);
  const taskGroups = useFieldIncidentStore((s) => s.taskGroups);
  const getSituationSummary = useFieldIncidentStore((s) => s.getSituationSummary);
  const getAverageTaskProgress = useFieldIncidentStore((s) => s.getAverageTaskProgress);
  const getCriticalAlerts = useFieldIncidentStore((s) => s.getCriticalAlerts);
  
  const summary = getSituationSummary();
  const avgProgress = getAverageTaskProgress();
  const alerts = getCriticalAlerts();

  if (!majorIncident || !summary) {
    return (
      <div className="situation-overview">
        <p className="no-data">No active major incident</p>
      </div>
    );
  }

  const statusColor = {
    DECLARED: '#f59e0b',
    ACTIVE: '#ef4444',
    STABILIZING: '#3b82f6',
    RECOVERY: '#10b981',
  };

  return (
    <div className="situation-overview">
      {/* Incident Header */}
      <div className="incident-header">
        <div className="incident-title-section">
          <h2>{summary.title}</h2>
          <div className="incident-meta">
            <span className="type-badge">{summary.type.replace(/_/g, ' ')}</span>
            <span
              className="status-badge"
              style={{ backgroundColor: statusColor[summary.status] }}
            >
              {summary.status.replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      </div>

      {/* Critical Alerts */}
      {alerts.length > 0 && (
        <div className="critical-alerts">
          <h3>⚠️ Critical Alerts</h3>
          <div className="alerts-list">
            {alerts.slice(0, 3).map((alert, idx) => (
              <div
                key={idx}
                className={`alert alert-${alert.severity.toLowerCase()}`}
              >
                <span className="alert-icon">🚨</span>
                <span className="alert-text">{alert.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Key Metrics Grid */}
      <div className="metrics-grid">
        {/* Casualty Metrics */}
        <div className="metric-card">
          <div className="metric-label">Estimated Casualties</div>
          <div className="metric-value">{summary.estimatedCasualties}</div>
          <div className="metric-sub">
            <span>Deaths: {summary.confirmedDeaths}</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Displaced Persons</div>
          <div className="metric-value">{summary.displacedPersons}</div>
          <div className="metric-sub">Primary concern</div>
        </div>

        {/* Sector Metrics */}
        <div className="metric-card">
          <div className="metric-label">Affected Sectors</div>
          <div className="metric-value">{summary.activeSectorCount}/{summary.sectors}</div>
          <div className="metric-sub">
            Critical: {summary.criticalHazards}
          </div>
        </div>

        {/* Task Metrics */}
        <div className="metric-card">
          <div className="metric-label">Task Group Progress</div>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${avgProgress}%` }}
            ></div>
          </div>
          <div className="metric-sub">
            {summary.tasksInProgress} in progress, {summary.tasksCompleted} completed
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Operational Scope</div>
          <div className="metric-value">{summary.taskGroups}</div>
          <div className="metric-sub">
            {(summary.affectedRadius / 1000).toFixed(1)} km radius
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="quick-stats">
        <div className="stat-row">
          <span className="stat-label">Resources Deployed:</span>
          <span className="stat-value">
            {Math.round(
              taskGroups.length > 0
                ? (taskGroups.reduce((sum, tg) => sum + (tg.assigned_units_count || 0), 0) || 0) / taskGroups.length
                : 0
            )}{' '}
            units/group avg
          </span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Incident Status:</span>
          <span className="stat-value" style={{ color: statusColor[summary.status] }}>
            {summary.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>
    </div>
  );
};

export default SituationOverview;
