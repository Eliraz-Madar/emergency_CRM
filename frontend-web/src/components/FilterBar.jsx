import React, { useState } from 'react';
import { useDashboardStore } from '../store/dashboard.js';

/**
 * Filter and Search Component
 */
export function FilterBar() {
  const { filters, updateFilters, setSortBy, sortBy } = useDashboardStore();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const severityOptions = ['LOW', 'MED', 'HIGH', 'CRITICAL'];
  // Full real Incident.Status set (backend/api/models.py). IN_PROGRESS is a
  // legacy value predating the OPEN→PENDING→EN_ROUTE→ON_SCENE→RESOLVED→CLOSED
  // pipeline — kept for old rows and the mobile-dispatch bridge, labeled to
  // signal that.
  const statusOptions = ['OPEN', 'PENDING', 'EN_ROUTE', 'ON_SCENE', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
  const statusLabels = { IN_PROGRESS: 'IN_PROGRESS (legacy)' };
  // Agency vocabulary, standardized to exactly these three — matches
  // MapView.jsx's incidentForm/dispatchAgency dropdowns exactly.
  const channelOptions = ['POLICE', 'EMS', 'FIRE'];

  const toggleFilter = (filterType, value) => {
    const current = filters[filterType];
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    updateFilters({ [filterType]: updated });
  };

  return (
    <div className="filter-bar">
      <div className="filter-primary">
        <input
          type="text"
          placeholder="Search incidents by title, description, location..."
          value={filters.searchText}
          onChange={(e) => updateFilters({ searchText: e.target.value })}
          className="search-input"
        />
        <button
          className="filter-toggle"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? '▼' : '▶'} Filters
        </button>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="sort-select"
        >
          <option value="severity">Sort by Severity</option>
          <option value="time">Sort by Time</option>
          <option value="status">Sort by Status</option>
        </select>
      </div>

      {showAdvanced && (
        <div className="filter-advanced">
          <div className="filter-group">
            <label>Severity:</label>
            <div className="filter-chips">
              {severityOptions.map((severity) => (
                <button
                  key={severity}
                  className={`filter-chip ${
                    filters.severities.includes(severity) ? 'active' : ''
                  }`}
                  onClick={() => toggleFilter('severities', severity)}
                >
                  {severity}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <label>Status:</label>
            <div className="filter-chips">
              {statusOptions.map((status) => (
                <button
                  key={status}
                  className={`filter-chip ${
                    filters.statuses.includes(status) ? 'active' : ''
                  }`}
                  onClick={() => toggleFilter('statuses', status)}
                >
                  {statusLabels[status] || status}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <label>Agency:</label>
            <div className="filter-chips">
              {channelOptions.map((channel) => (
                <button
                  key={channel}
                  className={`filter-chip ${
                    filters.channels.includes(channel) ? 'active' : ''
                  }`}
                  onClick={() => toggleFilter('channels', channel)}
                >
                  {channel}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
