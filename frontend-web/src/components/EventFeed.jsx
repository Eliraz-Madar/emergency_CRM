import React from 'react';
import { useDashboardStore } from '../store/dashboard.js';

/**
 * Event Feed / Activity Log Component
 */
export function EventFeed() {
  const events = useDashboardStore((state) => state.events);

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

  const formatTime = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="event-feed">
      <div className="feed-header">
        <h3>Event Log</h3>
        <span className="event-count">{events.length}</span>
      </div>

      {events.length === 0 ? (
        <div className="empty-state">
          <p>No events yet</p>
        </div>
      ) : (
        <ul className="events-list">
          {events.map((event) => (
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
