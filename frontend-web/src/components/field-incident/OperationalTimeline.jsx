/**
 * Operational Timeline Component
 *
 * Displays event log with severity indicators and timestamps.
 * Provides operational decision trail for major incident response.
 */

import { useState } from 'react';
import { useFieldIncidentStore } from '../../store/fieldIncident';
import { formatTime } from '../../utils/time.js';

const OperationalTimeline = ({ onShowDetails }) => {
  const events = useFieldIncidentStore((s) => s.events);
  const [showLegend, setShowLegend] = useState(false);
  const [severityFilter, setSeverityFilter] = useState('ALL');

  // Safety check: ensure events is an array
  const safeEvents = Array.isArray(events) ? events : [];

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
    WARNING: '#ef4444',
    CRITICAL: '#ef4444',
  };

  /**
   * Helper function to extract just the time from an event
   * Returns HH:MM format or empty string if date is invalid
   * IMPORTANT: This returns static data, no re-renders with moving time
   */
  const getEventTime = (event) => {
    let date = null;

    // Try different date field names
    if (event.timestamp) {
      date = typeof event.timestamp === 'number'
        ? new Date(event.timestamp * 1000)
        : new Date(event.timestamp);
    } else if (event.created_at) {
      date = typeof event.created_at === 'number'
        ? new Date(event.created_at * 1000)
        : new Date(event.created_at);
    } else if (event.time) {
      date = typeof event.time === 'number'
        ? new Date(event.time * 1000)
        : new Date(event.time);
    }

    // Validate and return HH:MM format (24-hour clock)
    if (date && !isNaN(date.getTime())) {
      return formatTime(date).slice(0, 5); // "HH:MM" — drop seconds for timeline brevity
    }

    // Return empty string for invalid dates
    return '';
  };

  /**
   * Filter events by severity
   */
  const getTimestamp = (event) => {
    const raw = event.created_at ?? event.timestamp ?? event.time ?? 0;
    const ms = typeof raw === 'number' ? raw * 1000 : new Date(raw).getTime();
    return isNaN(ms) ? 0 : ms;
  };

  const filteredEvents = (severityFilter === 'ALL'
    ? safeEvents
    : safeEvents.filter((event) => event?.severity === severityFilter)
  ).slice().sort((a, b) => getTimestamp(b) - getTimestamp(a));

  return (
    <div className="operational-timeline">
      {/* Header with Title, Filter Chips, and Legend Toggle */}
      <div className="timeline-header">
        <h3>📋 Operational Timeline</h3>

        {/* Severity Filter Chips */}
        <div className="filter-chips">
          {['ALL', 'CRITICAL', 'WARNING', 'INFO'].map((severity) => (
            <button
              key={severity}
              className={`filter-chip ${severityFilter === severity ? 'active' : ''}`}
              onClick={() => setSeverityFilter(severity)}
              style={
                severityFilter === severity && severity !== 'ALL'
                  ? { backgroundColor: severityColors[severity], color: 'white' }
                  : {}
              }
            >
              {severity}
            </button>
          ))}
        </div>

        <button
          className="legend-toggle-btn"
          onClick={() => setShowLegend(!showLegend)}
          title="Toggle event type legend"
        >
          📖 Legend
        </button>
      </div>

      {/* Legend Section (Collapsible) */}
      {showLegend && (
        <div className="timeline-legend-popup">
          <div className="legend-content">
            <h4>Event Type Legend</h4>
            <div className="legend-grid">
              {Object.entries(eventTypeIcons).map(([type, icon]) => (
                <div key={type} className="legend-item">
                  <span className="legend-icon">{icon}</span>
                  <span>{type.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
            <div className="legend-severity">
              <h4>Severity Levels</h4>
              <div className="severity-grid">
                <div className="severity-item">
                  <span className="severity-dot" style={{ backgroundColor: severityColors['CRITICAL'] }}></span>
                  <span>Critical / Warning</span>
                </div>
                <div className="severity-item">
                  <span className="severity-dot" style={{ backgroundColor: severityColors['INFO'] }}></span>
                  <span>Info</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {filteredEvents.length === 0 ? (
        <p className="no-data">
          {safeEvents.length === 0 ? 'No events recorded' : 'No events match the selected filter'}
        </p>
      ) : (
        <div className="timeline-container">
          {filteredEvents.map((event, idx) => {
            // Safety check: ensure event is an object
            if (!event || typeof event !== 'object') return null;

            return (
              <div
                key={event.id || idx}
                className="timeline-event"
                onClick={() => onShowDetails && onShowDetails(event)}
              >
                {/* Timeline Connector */}
                <div className="timeline-connector">
                  <div
                    className="timeline-dot"
                    style={{ backgroundColor: severityColors[event.severity] || '#666' }}
                    title={event.severity || 'Unknown'}
                  >
                    {eventTypeIcons[event.event_type] || '•'}
                  </div>
                  {idx < filteredEvents.length - 1 && <div className="timeline-line"></div>}
                </div>

                {/* Event Content */}
                <div className="timeline-content">
                  <div className="event-header">
                    <h4>{event.title || 'Untitled Event'}</h4>
                    <span
                      className="severity-badge"
                      style={{ backgroundColor: severityColors[event.severity] || '#666' }}
                    >
                      {event.severity || 'INFO'}
                    </span>
                  </div>

                  <div className="event-metadata">
                    <span className="event-type">
                      {(event.event_type || 'UPDATE').replace(/_/g, ' ')}
                    </span>
                    <span className="event-time">
                      {getEventTime(event)}
                    </span>
                    {event.created_by && (
                      <span className="event-creator">by {event.created_by}</span>
                    )}
                  </div>

                  {event.description && (
                    <div className="event-description">
                      {event.description.split('\n').map((line, i) => {
                        const colon = line.indexOf(': ');
                        if (colon > 0) {
                          return (
                            <p key={i} className="event-description-line">
                              <strong>{line.slice(0, colon + 1)}</strong>{line.slice(colon + 1)}
                            </p>
                          );
                        }
                        return <p key={i} className="event-description-line">{line}</p>;
                      })}
                    </div>
                  )}

                  {Array.isArray(event.media) && event.media.length > 0 && (
                    <div className="event-media">
                      <span className="event-media-label">Pictures:</span>
                      {event.media.map((m) =>
                        m.media_type === 'video' ? (
                          <video
                            key={m.id}
                            src={m.file_url}
                            className="event-media-thumb"
                            controls
                            preload="metadata"
                          />
                        ) : (
                          <a key={m.id} href={m.file_url} target="_blank" rel="noreferrer">
                            <img
                              src={m.file_url}
                              alt="Field attachment"
                              className="event-media-thumb"
                            />
                          </a>
                        )
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  );
};

export default OperationalTimeline;
