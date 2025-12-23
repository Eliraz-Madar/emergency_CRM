/**
 * Sector Map Component
 *
 * Displays sectors with hazard levels, access status, and operational status.
 * Sector-based map view for field incident command.
 */

import { useFieldIncidentStore } from '../../store/fieldIncident';

const SectorMap = () => {
  const sectors = useFieldIncidentStore((s) => s.sectors);
  const selectedSector = useFieldIncidentStore((s) => s.selectedSector);
  const setSelectedSector = useFieldIncidentStore((s) => s.setSelectedSector);

  const hazardColors = {
    LOW: '#10b981',
    MEDIUM: '#f59e0b',
    HIGH: '#f97316',
    CRITICAL: '#ef4444',
  };

  const hazardIcons = {
    LOW: '✓',
    MEDIUM: '⚠',
    HIGH: '⚠️',
    CRITICAL: '🚨',
  };

  const statusIcons = {
    ACTIVE: '🔴',
    CONTAINED: '🟡',
    CLEARED: '🟢',
  };

  return (
    <div className="sector-map">
      <h3>Operational Sectors</h3>

      {sectors.length === 0 ? (
        <p className="no-data">No sectors data available</p>
      ) : (
        <div className="sectors-grid">
          {sectors.map((sector) => (
            <div
              key={sector.name}
              className={`sector-card ${
                selectedSector === sector.name ? 'selected' : ''
              }`}
              onClick={() =>
                setSelectedSector(
                  selectedSector === sector.name ? null : sector.name
                )
              }
              style={{
                borderLeft: `4px solid ${hazardColors[sector.hazard_level]}`,
              }}
            >
              {/* Sector Header */}
              <div className="sector-header">
                <h4>{sector.name}</h4>
                <div className="sector-badges">
                  <span className="hazard-badge">
                    {hazardIcons[sector.hazard_level]} {sector.hazard_level}
                  </span>
                  <span className="status-badge">
                    {statusIcons[sector.status]} {sector.status}
                  </span>
                </div>
              </div>

              {/* Sector Details */}
              <div className="sector-details">
                <div className="detail-row">
                  <span className="detail-label">Hazard:</span>
                  <span className="detail-value">{sector.hazard_description}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Access:</span>
                  <span className="detail-value">{sector.access_status.replace(/_/g, ' ')}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Estimated Survivors:</span>
                  <span className="detail-value">{sector.estimated_survivors}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Primary Responder:</span>
                  <span className="detail-value">{sector.primary_responder}</span>
                </div>

                {/* Hazard Level Visual */}
                <div className="hazard-visual">
                  <div
                    className="hazard-bar"
                    style={{
                      backgroundColor: hazardColors[sector.hazard_level],
                      width: `${
                        { LOW: 25, MEDIUM: 50, HIGH: 75, CRITICAL: 100 }[
                          sector.hazard_level
                        ]
                      }%`,
                    }}
                  ></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sector Legend */}
      <div className="sector-legend">
        <h4>Hazard Levels</h4>
        <div className="legend-items">
          {Object.entries(hazardColors).map(([level, color]) => (
            <div key={level} className="legend-item">
              <div
                className="legend-color"
                style={{ backgroundColor: color }}
              ></div>
              <span>{level}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SectorMap;
