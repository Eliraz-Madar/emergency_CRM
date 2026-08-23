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
 * KPI Cards Component - displays key metrics for the regional dashboard.
 * Units are sourced exclusively from useDashboardStore's onlineUnits — real,
 * backend-sourced (GET /api/units/, kept fresh by SSE pushes). No field-
 * incident/simulation store involved.
 */
export function KPICards() {
  const incidents = useDashboardStore((state) => state.incidents);
  const onlineUnits = useDashboardStore((state) => state.onlineUnits);

  // "Available" mirrors IncidentDetailsPanel.jsx's own definition: online
  // and not currently assigned to an incident.
  const availableUnits = (Array.isArray(onlineUnits) ? onlineUnits : [])
    .filter((u) => u.is_online === true && !u.assignedTo)
    .map((u) => ({ ...u, type: normalizeUnitType(u.type) }));

  const totalAvailable = availableUnits.length;
  const policeCount = availableUnits.filter((u) => u.type === 'POLICE').length;
  const fireCount = availableUnits.filter((u) => u.type === 'FIRE').length;
  const medicalCount = availableUnits.filter((u) => u.type === 'MEDICAL').length;

  const totalIncidents = incidents.length;
  const activeIncidents = incidents.filter(
    (inc) => inc.status !== 'CLOSED'
  ).length;
  const criticalIncidents = incidents.filter(
    (inc) => inc.severity === 'CRITICAL'
  ).length;

  const kpis = [
    {
      label: 'Total Incidents',
      value: totalIncidents,
      color: '#3b82f6',
      icon: '📋',
    },
    {
      label: 'Active Incidents',
      value: activeIncidents,
      color: '#f59e0b',
      icon: '🔴',
    },
    {
      label: 'Critical',
      value: criticalIncidents,
      color: '#ef4444',
      icon: '⚠️',
    },
    {
      label: 'Available Units',
      value: totalAvailable,
      breakdown: `Pol: ${policeCount} | Fire: ${fireCount} | Med: ${medicalCount}`,
      color: '#10b981',
      icon: '🚑',
    },
  ];

  return (
    <div className="kpi-cards">
      {kpis.map((kpi, idx) => (
        <div key={idx} className="kpi-card" style={{ borderLeftColor: kpi.color }}>
          <div className="kpi-icon">{kpi.icon}</div>
          <div className="kpi-content">
            <div className="kpi-value">{kpi.value}</div>
            <div className="kpi-label">{kpi.label}</div>
            {kpi.label === 'Available Units' && kpi.breakdown && (
              <div className="kpi-subtext" style={{ marginTop: 4, fontSize: '0.85rem', color: '#6b7280' }}>
                {kpi.breakdown}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
