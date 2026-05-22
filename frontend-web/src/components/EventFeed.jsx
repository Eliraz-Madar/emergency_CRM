import React from 'react';
import { useDashboardStore } from '../store/dashboard.js';
import { useFieldIncidentStore } from '../store/fieldIncident.js';
import { formatTime } from '../utils/time.js';

/**
 * Event Feed / Activity Log Component
 * Only shows events linked to the currently selected incident (if any).
 * During simulation mode the filter is lifted — all synthetic events are shown.
 */
export function EventFeed() {
  const events = useDashboardStore((state) => state.events);
  const selectedIncidentId = useDashboardStore((s) => s.selectedIncidentId);
  const isSimulation = useFieldIncidentStore((s) => s.mode === 'SIMULATION');

  // Client-side safety net: filter to the active incident unless in simulation
  // or nothing is selected. 'system' events are always shown as global context.
  const filteredEvents = (selectedIncidentId && !isSimulation)
    ? events.filter(
        (e) =>
          e.entity_type === 'system' ||
          String(e.entity_id) === String(selectedIncidentId),
      )
    : events;

  // Sort newest-first (backend already does this, but real-time SSE events
  // are prepended/appended locally so we sort here as a safety net).
  const sortedEvents = [...filteredEvents].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
  );

  const getLevelIcon = (level) => {
    const icons = {
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌',
    };
    return icons[level] || '•';
  };

  const getLevelColor = (level) => {
    const colors = {
      info: '#3b82f6',
      warn: '#f59e0b',
      error: '#ef4444',
    };
    return colors[level] || '#6b7280';
  };

  return (
    <div className="event-feed">
      <div className="feed-header">
        <h3>Event Log</h3>
        <span className="event-count">{sortedEvents.length}</span>
        {selectedIncidentId && !isSimulation && (
          <span style={{
            fontSize: '0.7rem',
            color: '#60a5fa',
            marginLeft: '6px',
            fontStyle: 'italic',
          }}>
            filtered
          </span>
        )}
      </div>

      {sortedEvents.length === 0 ? (
        <div className="empty-state">
          <p>{selectedIncidentId && !isSimulation ? 'No events for this incident' : 'No events yet'}</p>
        </div>
      ) : (
        <ul className="events-list">
          {sortedEvents.map((event) => (
            <li key={event.id} className={`event-item event-${event.level}`}>
              <div className="event-marker" style={{
                backgroundColor: getLevelColor(event.level),
              }} />
              <div className="event-content">
                <div className="event-message">
                  <span className="event-icon">{getLevelIcon(event.level)}</span>
                  <span className="event-text">{event.message}</span>
                </div>
                <div className="event-meta">
                  <span className="event-entity">{event.entity_type}#{event.entity_id}</span>
                  <span className="event-time">{formatTime(event.timestamp)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
