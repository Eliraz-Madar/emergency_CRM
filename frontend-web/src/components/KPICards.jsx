import React from 'react';
import { useDashboardStore } from '../store/dashboard.js';

// Real backend Unit.type is Police/Fire/EMS/HomeFront; mirrors the same
// POLICE/FIRE/MEDICAL bucket scheme IncidentDetailsPanel.jsx's
// normalizeUnitType uses for its own unit-type filter tabs.
const normalizeUnitType = (type) => {
  const t = (type || '').toUpperCase();
  if (t === 'EMS' || t === 'AMBULANCE' || t === 'MEDICAL') return 'MEDICAL';
  if (t === 'FIRE') return 'FIRE';
  if (t === 'POLICE') return 'POLICE';
  return 'POLICE';
};

/**
 * KPI Cards Component - the header row above the map on the regional dashboard.
 *
 * "Active Incidents" and "Awaiting Dispatch" are buttons: clicking one zooms
 * the map out to show that whole set and flashes their markers. The old
 * "Critical" card is replaced by a compact list of the open field command
 * posts (click one to open its panel + jump to it on the map).
 */
export function KPICards({ fieldCommands = [], onSelectFieldCommand }) {
  const incidents = useDashboardStore((state) => state.incidents);
  const onlineUnits = useDashboardStore((state) => state.onlineUnits);
  const spotlightIncidents = useDashboardStore((state) => state.spotlightIncidents);

  // "Available" mirrors IncidentDetailsPanel.jsx's own definition: online
  // and not currently assigned to an incident.
  const availableUnits = (Array.isArray(onlineUnits) ? onlineUnits : [])
    .filter((u) => u.is_online === true && !u.assignedTo)
    .map((u) => ({ ...u, type: normalizeUnitType(u.type) }));

  const totalAvailable = availableUnits.length;
  const policeCount = availableUnits.filter((u) => u.type === 'POLICE').length;
  const fireCount = availableUnits.filter((u) => u.type === 'FIRE').length;
  const medicalCount = availableUnits.filter((u) => u.type === 'MEDICAL').length;

  // "Active" = every incident that isn't CLOSED — the exact set the map and
  // the "Incidents (N)" list header count, so the numbers always agree.
  const activeList = incidents.filter((inc) => inc.status !== 'CLOSED');
  // "Awaiting Dispatch" = active incidents nobody is handling yet.
  const awaitingList = activeList.filter(
    (inc) => inc.status === 'OPEN' || inc.status === 'PENDING',
  );

  const openFieldCommands = (Array.isArray(fieldCommands) ? fieldCommands : [])
    .filter((fc) => fc.status !== 'CLOSED');

  const spotlight = (list) => spotlightIncidents(list.map((inc) => inc.id));

  return (
    <div className="kpi-cards">
      <button
        type="button"
        className="kpi-card kpi-card-button"
        style={{ borderLeftColor: '#f59e0b' }}
        onClick={() => spotlight(activeList)}
        title="Show all active incidents on the map"
      >
        <div className="kpi-icon">🔴</div>
        <div className="kpi-content">
          <div className="kpi-value">{activeList.length}</div>
          <div className="kpi-label">Active Incidents</div>
        </div>
      </button>

      <button
        type="button"
        className="kpi-card kpi-card-button"
        style={{ borderLeftColor: '#3b82f6' }}
        onClick={() => spotlight(awaitingList)}
        title="Show incidents that aren't being handled yet"
      >
        <div className="kpi-icon">📋</div>
        <div className="kpi-content">
          <div className="kpi-value">{awaitingList.length}</div>
          <div className="kpi-label">Awaiting Dispatch</div>
        </div>
      </button>

      {/* Replaces the old "Critical" card — the open field command posts. */}
      <div className="kpi-card kpi-card-fieldcommands" style={{ borderLeftColor: '#a855f7' }}>
        <div className="kpi-icon">🎖️</div>
        <div className="kpi-content" style={{ minWidth: 0, flex: 1 }}>
          <div className="kpi-label" style={{ marginBottom: 4 }}>
            Field Command Posts ({openFieldCommands.length})
          </div>
          {openFieldCommands.length === 0 ? (
            <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>None open</div>
          ) : (
            <div className="kpi-fc-list">
              {openFieldCommands.map((fc) => (
                <button
                  key={fc.id}
                  type="button"
                  className="kpi-fc-item"
                  onClick={() => onSelectFieldCommand?.(fc.id)}
                  title={`Open ${fc.name}`}
                >
                  <span className="kpi-fc-name">{fc.name}</span>
                  <span className="kpi-fc-meta">
                    {(fc.incidents_count ?? fc.incidents?.length ?? 0)}🚨
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="kpi-card" style={{ borderLeftColor: '#10b981' }}>
        <div className="kpi-icon">🚑</div>
        <div className="kpi-content">
          <div className="kpi-value">{totalAvailable}</div>
          <div className="kpi-label">Available Units</div>
          <div className="kpi-subtext" style={{ marginTop: 2, fontSize: '0.7rem', color: '#6b7280' }}>
            Pol: {policeCount} | Fire: {fireCount} | Med: {medicalCount}
          </div>
        </div>
      </div>
    </div>
  );
}
