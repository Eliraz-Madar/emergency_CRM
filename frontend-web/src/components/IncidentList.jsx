import React from 'react';
import { useDashboardStore } from '../store/dashboard.js';

/**
 * Incident List Component
 */
export function IncidentList() {
  const {
    getFilteredIncidents,
    selectedIncidentId,
    setSelectedIncident,
  } = useDashboardStore();

  const filteredIncidents = getFilteredIncidents();

  const getSeverityColor = (severity) => {
    const colors = {
      CRITICAL: '#ef4444',
      HIGH: '#f59e0b',
      MED: '#eab308',
      LOW: '#3b82f6',
    };
    return colors[severity] || '#6b7280';
  };

  const getStatusIcon = (status) => {
    const icons = {
      OPEN: '📌',
      IN_PROGRESS: '⚙️',
      CLOSED: '✓',
    };
    return icons[status] || '•';
  };

  const formatTime = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <div className="incident-list">
      <div className="incident-list-header">
        <h2>Incidents ({filteredIncidents.length})</h2>
      </div>

      {filteredIncidents.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📭</div>
          <p>No incidents matching your filters</p>
        </div>
      ) : (
        <ul className="incidents">
          {filteredIncidents.map((incident) => (
            <li
              key={incident.id}
              className={`incident-item ${
                selectedIncidentId === incident.id ? 'selected' : ''
              }`}
              onClick={() => setSelectedIncident(incident.id)}
            >
              <div className="incident-severity-bar" style={{
                backgroundColor: getSeverityColor(incident.severity),
              }} />
              <div className="incident-content">
                <div className="incident-header">
                  <span className="incident-icon">{getStatusIcon(incident.status)}</span>
                  <span className="incident-title">{incident.title}</span>
                  <span className="incident-severity" style={{
                    backgroundColor: getSeverityColor(incident.severity) + '20',
                    color: getSeverityColor(incident.severity),
                  }}>
                    {incident.severity}
                  </span>
                </div>
                <div className="incident-meta">
                  <span className="incident-channel">{incident.channel}</span>
                  <span className="incident-location">{incident.location_name}</span>
                  <span className="incident-time">{formatTime(incident.created_at)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
