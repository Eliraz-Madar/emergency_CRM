import React from 'react';
import { useDashboardStore } from '../store/dashboard.js';
import { getIncidentChannelMeta } from '../utils/agencyMeta.js';

/**
 * Incident List Component - Dynamic and Interactive
 * Regional dashboard only — always real, DB-backed incidents.
 */
export function IncidentList({
  activeFilter = 'ALL',
  setActiveFilter,
}) {
  const {
    getFilteredIncidents,
    selectedIncidentId,
    setSelectedIncident,
  } = useDashboardStore();
  // Total active (non-CLOSED) incidents — the same figure the map and the
  // KPI "Active Incidents" card show. Used to make the header honest when a
  // filter is narrowing the list.
  const activeTotal = useDashboardStore(
    (s) => s.incidents.filter((i) => i.status !== 'CLOSED').length,
  );

  const incidents = getFilteredIncidents();

  // Filter categories with icons
  const filterCategories = [
    { id: 'ALL', label: 'All', icon: '🎯', color: '#3b82f6' },
    { id: 'FIRE', label: 'Fire', icon: '🔥', color: '#ef4444' },
    { id: 'POLICE', label: 'Police', icon: '👮', color: '#8b5cf6' },
    { id: 'EMS', label: 'EMS', icon: '🚑', color: '#10b981' },
  ];

  // Apply active filter
  const filteredIncidents = activeFilter === 'ALL'
    ? incidents
    : incidents.filter(inc => {
      const channel = inc.channel?.toUpperCase() || '';
      return channel.includes(activeFilter);
    });

  const getSeverityColor = (severity) => {
    const colors = {
      CRITICAL: '#ef4444',
      HIGH: '#f59e0b',
      MED: '#eab308',
      LOW: '#3b82f6',
    };
    return colors[severity] || '#6b7280';
  };

  const hasAssignedUnits = (incident) => {
    const assignedUnits = Array.isArray(incident?.assignedUnits)
      ? incident.assignedUnits.length
      : 0;
    const assignedIds = Array.isArray(incident?.assigned_unit_ids)
      ? incident.assigned_unit_ids.length
      : 0;
    return assignedUnits > 0 || assignedIds > 0;
  };

  const getStatusIcon = (status) => {
    const icons = {
      OPEN: '📌',
      IN_PROGRESS: '⚙️',
      CLOSED: '✓',
    };
    return icons[status] || '•';
  };

  // Same "Dispatch Force to Point" detection and shared agency palette
  // (utils/agencyMeta.js) as MapView.jsx's incident markers, so a
  // point-dispatch row here matches the diamond marker shown for the same
  // incident on the map. Unknown channel → an amber ⚡ bolt, not 🚨.
  const isPointDispatch = (incident) =>
    incident?.description === 'Force dispatched directly from the map.';

  const getDispatchAgencyMeta = (incident) =>
    getIncidentChannelMeta(incident, { emoji: '⚡', color: '#f59e0b' });

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
        <h2>
          Incidents ({filteredIncidents.length}
          {filteredIncidents.length !== activeTotal ? ` of ${activeTotal}` : ''})
        </h2>
      </div>

      <div className="incident-filter-bar">
        {filterCategories.map((filter) => (
          <button
            key={filter.id}
            className={`filter-button ${activeFilter === filter.id ? 'active' : ''}`}
            onClick={() => setActiveFilter && setActiveFilter(filter.id)}
            style={{
              borderColor: activeFilter === filter.id ? filter.color : 'transparent',
              backgroundColor: activeFilter === filter.id ? filter.color + '20' : 'transparent',
              color: activeFilter === filter.id ? filter.color : '#94a3b8',
            }}
          >
            <span className="filter-icon">{filter.icon}</span>
            <span className="filter-label">{filter.label}</span>
          </button>
        ))}
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
              className={`incident-item ${selectedIncidentId === incident.id ? 'selected' : ''
                }`}
              onClick={() => setSelectedIncident(incident.id)}
            >
              <div className="incident-severity-bar" style={{
                backgroundColor: getSeverityColor(incident.priority || incident.severity),
              }} />
              <div className="incident-content">
                <div className="incident-header">
                  <span
                    className="incident-icon"
                    title={isPointDispatch(incident) ? 'Direct point dispatch' : undefined}
                    style={isPointDispatch(incident) ? { color: getDispatchAgencyMeta(incident).color } : undefined}
                  >
                    {isPointDispatch(incident) ? getDispatchAgencyMeta(incident).emoji : getStatusIcon(incident.status)}
                  </span>
                  <span className="incident-title">
                    {incident.title}
                    {hasAssignedUnits(incident) && (
                      <span title="Units assigned" style={{ marginLeft: '6px', color: '#fbbf24' }}>★</span>
                    )}
                  </span>
                  <span className="incident-severity" style={{
                    backgroundColor: getSeverityColor(incident.priority || incident.severity) + '20',
                    color: getSeverityColor(incident.priority || incident.severity),
                  }}>
                    {incident.priority || incident.severity}
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
