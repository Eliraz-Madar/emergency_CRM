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

  // Safety check: ensure sectors is an array
  const safeSectors = Array.isArray(sectors) ? sectors : [];

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

      {safeSectors.length === 0 ? (
        <p className="no-data">No sectors data available</p>
      ) : (
        <div className="sectors-grid">
          {safeSectors.map((sector, idx) => {
            // Safety check: ensure sector is an object
            if (!sector || typeof sector !== 'object') return null;

            const sectorKey = sector.id || sector.name || `sector-${idx}`;

            return (
              <div
                key={sectorKey}
                className={`sector-card ${selectedSector === sector.name ? 'selected' : ''
                  }`}
                onClick={() =>
                  setSelectedSector(
                    selectedSector === sector.name ? null : sector.name
                  )
                }
                style={{
                  borderLeft: `4px solid ${hazardColors[sector.hazard_level] || hazardColors.LOW}`,
                }}
              >
                {/* Sector Header */}
                <div className="sector-header">
                  <h4>{sector.name || 'Unnamed Sector'}</h4>
                  <div className="sector-badges">
                    <span className="hazard-badge">
                      {hazardIcons[sector.hazard_level] || '✓'} {sector.hazard_level || 'LOW'}
                    </span>
                    <span className="status-badge">
                      {statusIcons[sector.status] || '🟢'} {sector.status || 'ACTIVE'}
                    </span>
                  </div>
                </div>

                {/* Sector Details */}
                <div className="sector-details">
                  <div className="detail-row">
                    <span className="detail-label">Hazard:</span>
                    <span className="detail-value">{sector.hazard_description || 'No hazard information'}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Access:</span>
                    <span className="detail-value">{(sector.access_status || 'UNRESTRICTED').replace(/_/g, ' ')}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Estimated Survivors:</span>
                    <span className="detail-value">{sector.estimated_survivors ?? 'Unknown'}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Primary Responder:</span>
                    <span className="detail-value">{sector.primary_responder || 'Incident Command'}</span>
                  </div>

                  {/* Hazard Level Visual */}
                  <div className="hazard-visual">
                    <div
                      className="hazard-bar"
                      style={{
                        backgroundColor: hazardColors[sector.hazard_level] || hazardColors.LOW,
                        width: `${{ LOW: 25, MEDIUM: 50, HIGH: 75, CRITICAL: 100 }[
                          sector.hazard_level
                          ] || 25
                          }%`,
                      }}
                    ></div>
                  </div>
                </div>
              </div>
            )
          })}
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
