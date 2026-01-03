/**
 * Operational Timeline Component
 *
 * Displays event log with severity indicators and timestamps.
 * Provides operational decision trail for major incident response.
 */

import { useFieldIncidentStore } from '../../store/fieldIncident';

const OperationalTimeline = ({ onShowDetails }) => {
  const events = useFieldIncidentStore((s) => s.events);

  const eventTypeIcons = {
    STATUS_CHANGE: '📊',
    ASSIGNMENT: '👤',
    UPDATE: '📝',
    HAZARD_ALERT: '⚠️',
    CASUALTY_UPDATE: '🚑',
    EVACUATION: '🚨',
    RESOURCE_ARRIVAL: '🚚',
    COMMUNICATION: '📢',
  };

  const severityColors = {
    INFO: '#3b82f6',
    WARNING: '#f59e0b',
    CRITICAL: '#ef4444',
  };

  const formatTime = (timestamp) => {
    if (typeof timestamp === 'number') {
      return new Date(timestamp * 1000).toLocaleTimeString();
    }
    if (typeof timestamp === 'string') {
      return new Date(timestamp).toLocaleTimeString();
    }
    return 'Unknown';
  };

  return (
    <div className="operational-timeline">
      <h3>📋 Operational Timeline</h3>

      {events.length === 0 ? (
        <p className="no-data">No events recorded</p>
      ) : (
        <div className="timeline-container">
          {events.map((event, idx) => (
            <div key={idx} className="timeline-event">
              {/* Timeline Connector */}
              <div className="timeline-connector">
                <div
                  className="timeline-dot"
                  style={{ backgroundColor: severityColors[event.severity] || '#666' }}
                  title={event.severity}
                >
                  {eventTypeIcons[event.event_type] || '•'}
                </div>
                {idx < events.length - 1 && <div className="timeline-line"></div>}
              </div>

              {/* Event Content */}
              <div className="timeline-content">
                <div className="event-header">
                  <h4>{event.title}</h4>
                  <span
                    className="severity-badge"
                    style={{ backgroundColor: severityColors[event.severity] }}
                  >
                    {event.severity}
                  </span>
                  {onShowDetails && (
                    <button
                      className="event-info-btn"
                      onClick={() => onShowDetails(event)}
                      title="Show event details"
                    >
                      ℹ️
                    </button>
                  )}
                </div>

                <div className="event-metadata">
                  <span className="event-type">
                    {event.event_type.replace(/_/g, ' ')}
                  </span>
                  <span className="event-time">
                    {formatTime(event.created_at)}
                  </span>
                  {event.created_by && (
                    <span className="event-creator">by {event.created_by}</span>
                  )}
                </div>

                {event.description && (
                  <p className="event-description">{event.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Timeline Legend */}
      <div className="timeline-legend">
        <h4>Event Types</h4>
        <div className="legend-grid">
          {Object.entries(eventTypeIcons).map(([type, icon]) => (
            <div key={type} className="legend-item">
              <span className="legend-icon">{icon}</span>
              <span>{type.replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default OperationalTimeline;
