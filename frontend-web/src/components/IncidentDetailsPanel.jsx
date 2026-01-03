import React, { useState } from 'react';
import { useDashboardStore } from '../store/dashboard.js';
import * as api from '../api/client.js';

/**
 * Incident Details Panel Component
 */
export function IncidentDetailsPanel() {
  const {
    getSelectedIncident,
    units,
    updateIncident,
  } = useDashboardStore();

  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const incident = getSelectedIncident();

  if (!incident) {
    return (
      <div className="incident-details-panel empty">
        <div className="empty-state">
          <div className="empty-icon">👈</div>
          <p>Select an incident to view details</p>
        </div>
      </div>
    );
  }

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleStatusChange = async (newStatus) => {
    try {
      setIsLoading(true);
      const updated = await api.updateIncidentStatus(incident.id, newStatus);
      updateIncident(incident.id, { status: updated.status });
      showToast(`Status updated to ${newStatus}`);
    } catch (error) {
      showToast('Failed to update status', 'error');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSeverityChange = async (newSeverity) => {
    try {
      setIsLoading(true);
      const updated = await api.updateIncidentSeverity(incident.id, newSeverity);
      updateIncident(incident.id, { severity: updated.severity });
      showToast(`Severity updated to ${newSeverity}`);
    } catch (error) {
      showToast('Failed to update severity', 'error');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAssignUnit = async (unitId) => {
    try {
      setIsLoading(true);
      const updated = await api.assignUnitToIncident(incident.id, unitId);
      updateIncident(incident.id, { assigned_unit_ids: updated.assigned_unit_ids });
      showToast('Unit assigned');
    } catch (error) {
      showToast('Failed to assign unit', 'error');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddNote = async () => {
    const note = prompt('Add a note to this incident:');
    if (note && note.trim()) {
      try {
        setIsLoading(true);
        await api.addIncidentNote(incident.id, note);
        showToast('Note added');
      } catch (error) {
        showToast('Failed to add note', 'error');
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const assignedUnits = units.filter((unit) =>
    incident.assigned_unit_ids.includes(unit.id)
  );

  const unassignedUnits = units.filter(
    (unit) =>
      !incident.assigned_unit_ids.includes(unit.id) &&
      unit.status === 'Available'
  );

  const statusWorkflow = ['OPEN', 'IN_PROGRESS', 'CLOSED'];
  const severityLevels = ['LOW', 'MED', 'HIGH', 'CRITICAL'];

  return (
    <div className="incident-details-panel">
      <div className="details-header">
        <h2>Incident #{incident.id}</h2>
      </div>

      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.message}
        </div>
      )}

      <div className="details-section">
        <h3 className="section-title">Overview</h3>
        <div className="details-grid">
          <div className="detail-field">
            <label>Title</label>
            <p>{incident.title}</p>
          </div>
          <div className="detail-field">
            <label>Channel</label>
            <p>{incident.channel}</p>
          </div>
          <div className="detail-field">
            <label>Location</label>
            <p>{incident.location_name}</p>
          </div>
          <div className="detail-field">
            <label>Reporter</label>
            <p>{incident.reporter}</p>
          </div>
        </div>
        <div className="detail-field">
          <label>Description</label>
          <p>{incident.description}</p>
        </div>
      </div>

      <div className="details-section">
        <h3 className="section-title">Workflow</h3>
        <div className="workflow-section">
          <div className="workflow-item">
            <label>Status</label>
            <div className="workflow-buttons">
              {statusWorkflow.map((status) => (
                <button
                  key={status}
                  className={`workflow-btn ${incident.status === status ? 'active' : ''}`}
                  onClick={() => handleStatusChange(status)}
                  disabled={isLoading}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          <div className="workflow-item">
            <label>Severity</label>
            <div className="workflow-buttons">
              {severityLevels.map((level) => (
                <button
                  key={level}
                  className={`workflow-btn severity ${incident.severity === level ? 'active' : ''}`}
                  onClick={() => handleSeverityChange(level)}
                  disabled={isLoading}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="details-section">
        <h3 className="section-title">Assigned Units ({assignedUnits.length})</h3>
        {assignedUnits.length === 0 ? (
          <p className="empty-text">No units assigned</p>
        ) : (
          <ul className="units-list">
            {assignedUnits.map((unit) => (
              <li key={unit.id} className="unit-item">
                <span className="unit-icon">🚑</span>
                <span className="unit-name">{unit.name}</span>
                <span className={`unit-status ${unit.status.toLowerCase()}`}>
                  {unit.status}
                </span>
              </li>
            ))}
          </ul>
        )}

        {unassignedUnits.length > 0 && (
          <div className="assign-unit-section">
            <label>Assign Available Unit</label>
            <div className="assign-buttons">
              {unassignedUnits.slice(0, 5).map((unit) => (
                <button
                  key={unit.id}
                  className="assign-btn"
                  onClick={() => handleAssignUnit(unit.id)}
                  disabled={isLoading}
                >
                  {unit.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="details-section">
        <h3 className="section-title">Quick Actions</h3>
        <div className="actions">
          <button className="action-btn" onClick={handleAddNote} disabled={isLoading}>
            💬 Add Note
          </button>
          <button className="action-btn" disabled={isLoading}>
            📎 Attach File
          </button>
          <button className="action-btn" disabled={isLoading}>
            🔔 Send Alert
          </button>
        </div>
      </div>

      <div className="details-footer">
        <small>
          Created: {
            incident.created_at
              ? (() => {
                const date = new Date(incident.created_at);
                return !isNaN(date.getTime()) ? date.toLocaleString() : 'Unknown';
              })()
              : 'Unknown'
          }
        </small>
        <small>
          Updated: {
            incident.updated_at
              ? (() => {
                const date = new Date(incident.updated_at);
                return !isNaN(date.getTime()) ? date.toLocaleString() : 'Unknown';
              })()
              : 'Unknown'
          }
        </small>
      </div>
    </div>
  );
}
