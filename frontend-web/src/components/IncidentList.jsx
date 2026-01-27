import React from 'react';
import { useDashboardStore } from '../store/dashboard.js';

/**
 * Incident List Component - Dynamic and Interactive
 * Supports both routine mode (real incidents) and simulation mode (timeline events)
 */
export function IncidentList({
  activeFilter = 'ALL',
  setActiveFilter,
  isSimulation = false,
  simulationEvents = null
}) {
  const {
    getFilteredIncidents,
    selectedIncidentId,
    setSelectedIncident,
  } = useDashboardStore();

  // Get incidents based on mode
  const routineIncidents = getFilteredIncidents();

  // Convert simulation events to incident-like format for display
  const simulationIncidents = isSimulation && simulationEvents ?
    simulationEvents.map((evt, idx) => ({
      id: evt.id || `sim-${idx}`,
      title: evt.title || evt.message || 'Event',
      severity: evt.severity || 'MED',
      status: 'IN_PROGRESS',
      channel: getEventChannel(evt),
      location_name: evt.location || 'Field',
      created_at: evt.timestamp || evt.created_at || new Date().toISOString(),
    })) : [];

  const incidents = isSimulation ? simulationIncidents : routineIncidents;

  // Filter categories with icons
  const filterCategories = [
    { id: 'ALL', label: 'All', icon: '🎯', color: '#3b82f6' },
    { id: 'FIRE', label: 'Fire', icon: '🔥', color: '#ef4444' },
    { id: 'POLICE', label: 'Police', icon: '👮', color: '#8b5cf6' },
    { id: 'MEDICAL', label: 'Medical', icon: '🚑', color: '#10b981' },
  ];

  function getEventChannel(evt) {
    const title = (evt.title || evt.message || '').toLowerCase();
    if (title.includes('fire') || title.includes('flame') || title.includes('burn')) return 'FIRE';
    if (title.includes('police') || title.includes('security') || title.includes('crime')) return 'POLICE';
    if (title.includes('medical') || title.includes('casualt') || title.includes('injur')) return 'MEDICAL';
    return 'Civil Defense';
  }

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
    <div
      className="incident-list"
      style={{ height: 'calc(100vh - 100px)', overflowY: 'auto' }}
    >
      <div className="incident-list-header">
        <h2>Incidents ({filteredIncidents.length})</h2>
      </div>

      {/* Filter Buttons */}
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
                  <span className="incident-icon">{getStatusIcon(incident.status)}</span>
                  <span className="incident-title">{incident.title}</span>
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
