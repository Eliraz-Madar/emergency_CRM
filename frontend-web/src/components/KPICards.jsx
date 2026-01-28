import React from 'react';
import { useDashboardStore } from '../store/dashboard.js';
import { useFieldIncidentStore } from '../store/fieldIncident.js';

/**
 * KPI Cards Component - displays key metrics
 * Can be overridden with simulation data via props
 */
export function KPICards({ simulationData = null }) {
  const incidents = useDashboardStore((state) => state.incidents);
  // Live units from field incident store (real-time)
  const routineUnits = useFieldIncidentStore((s) => s.routineUnits);
  const fieldUnits = useFieldIncidentStore((s) => s.units);
  const fieldMode = useFieldIncidentStore((s) => s.mode);

  // Use the correct units based on mode
  const liveUnits = fieldMode === 'SIMULATION'
    ? (Array.isArray(fieldUnits) ? fieldUnits : [])
    : (Array.isArray(routineUnits) && routineUnits.length > 0 ? routineUnits : (Array.isArray(fieldUnits) ? fieldUnits : []));

  // Count available units (status === 'PATROL' or 'AVAILABLE')
  const availableLiveUnits = liveUnits.filter((u) => u.status === 'PATROL' || u.status === 'AVAILABLE');
  const totalAvailable = availableLiveUnits.length;
  const policeCount = availableLiveUnits.filter((u) => u.type === 'POLICE').length;
  const fireCount = availableLiveUnits.filter((u) => u.type === 'FIRE').length;
  const medicalCount = availableLiveUnits.filter((u) => u.type === 'MEDICAL').length;

  // Use simulation data if provided, otherwise calculate from regular data
  let kpis;

  if (simulationData) {
    // Extract simulation KPIs from majorIncident
    kpis = [
      {
        label: 'Casualties',
        value: simulationData.estimated_casualties || 0,
        color: '#ef4444',
        icon: '🚑',
      },
      {
        label: 'Evacuated',
        value: simulationData.displaced_persons || 0,
        color: '#f59e0b',
        icon: '🏃',
      },
      {
        label: 'Confirmed Deaths',
        value: simulationData.confirmed_deaths || 0,
        color: '#dc2626',
        icon: '⚠️',
      },
      {
        label: 'Active Sectors',
        value: simulationData.active_sectors || 0,
        color: '#3b82f6',
        icon: '📍',
      },
    ];
  } else {
    // Calculate KPIs from regular dashboard data
    const totalIncidents = incidents.length;
    const activeIncidents = incidents.filter(
      (inc) => inc.status !== 'CLOSED'
    ).length;
    const criticalIncidents = incidents.filter(
      (inc) => inc.severity === 'CRITICAL'
    ).length;

    kpis = [
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
  }

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
