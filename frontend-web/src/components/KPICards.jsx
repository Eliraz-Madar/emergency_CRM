import React from 'react';
import { useDashboardStore } from '../store/dashboard.js';

/**
 * KPI Cards Component - displays key metrics
 */
export function KPICards() {
  const incidents = useDashboardStore((state) => state.incidents);
  const units = useDashboardStore((state) => state.units);
  
  // Calculate KPIs
  const totalIncidents = incidents.length;
  const activeIncidents = incidents.filter(
    (inc) => inc.status !== 'CLOSED'
  ).length;
  const criticalIncidents = incidents.filter(
    (inc) => inc.severity === 'CRITICAL'
  ).length;
  const availableUnits = units.filter(
    (unit) => unit.status === 'Available'
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
      value: availableUnits,
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
          </div>
        </div>
      ))}
    </div>
  );
}
