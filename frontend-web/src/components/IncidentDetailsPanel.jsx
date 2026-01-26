import React, { useState } from 'react';
import { useDashboardStore } from '../store/dashboard.js';
import { useFieldIncidentStore } from '../store/fieldIncident.js';
import * as api from '../api/client.js';

/**
 * Calculate distance between two coordinates using Haversine formula (in KM)
 */
const getDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
  if (![lat1, lon1, lat2, lon2].every((v) => Number.isFinite(v))) {
    return Infinity;
  }
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Incident Details Panel Component
 */
export function IncidentDetailsPanel() {
  const {
    getSelectedIncident,
    units,
    updateIncident,
  } = useDashboardStore();

  const {
    routineUnits,
    dispatchUnitsToIncident,
  } = useFieldIncidentStore();

  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [selectedUnitIds, setSelectedUnitIds] = useState([]);

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

  const handleDispatchUnits = () => {
    if (selectedUnitIds.length === 0) {
      showToast('Select at least one unit', 'error');
      return;
    }

    const incidentLat = incident.location_lat ?? 31.77;
    const incidentLng = incident.location_lng ?? 35.22;

    dispatchUnitsToIncident({
      incidentId: incident.id,
      targetPosition: [incidentLat, incidentLng],
      unitIds: selectedUnitIds,
    });

    setSelectedUnitIds([]);
    showToast(`${selectedUnitIds.length} unit(s) dispatched to scene`);
  };


  const toggleUnitSelection = (unitId) => {
    setSelectedUnitIds((prev) =>
      prev.includes(unitId) ? prev.filter((id) => id !== unitId) : [...prev, unitId]
    );
  };

  const assignedUnitIds = incident.assigned_unit_ids || [];
  const incidentLat = incident.location_lat ?? 31.77;
  const incidentLng = incident.location_lng ?? 35.22;

  // Calculate distances and filter to 50km radius, sorted by distance
  const unitsWithDistance = (Array.isArray(routineUnits) ? routineUnits : [])
    .filter((unit) => unit.status === 'PATROL' && !assignedUnitIds.includes(unit.id))
    .map((unit) => ({
      ...unit,
      distance: Array.isArray(unit.position) && unit.position.length >= 2
        ? getDistance(unit.position[0], unit.position[1], incidentLat, incidentLng)
        : Infinity,
    }))
    .filter((unit) => unit.distance <= 50)
    .sort((a, b) => a.distance - b.distance);

  const availableUnits = unitsWithDistance;

  const policeUnits = availableUnits.filter((u) => u.type === 'POLICE');
  const fireUnits = availableUnits.filter((u) => u.type === 'FIRE');
  const medicalUnits = availableUnits.filter((u) => u.type === 'MEDICAL');

  const assignedUnits = units.filter((unit) =>
    assignedUnitIds.includes(unit.id)
  );

  const unassignedUnits = units.filter(
    (unit) =>
      !assignedUnitIds.includes(unit.id) &&
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

      <div className="details-section dispatch-section">
        <h3 className="section-title">🚨 Dispatch Support</h3>
        <div className="dispatch-units">
          {/* Police Forces */}
          <div className="unit-category">
            <h4>👮 Police</h4>
            <div className="units-checklist">
              {policeUnits.length === 0 ? (
                <p className="empty-text">No units nearby</p>
              ) : (
                policeUnits.map((unit) => (
                  <label key={unit.id} className="unit-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedUnitIds.includes(unit.id)}
                      onChange={() => toggleUnitSelection(unit.id)}
                      disabled={isLoading}
                    />
                    <span className="unit-info">
                      <span className="unit-name">{unit.id} <span className="unit-distance">{unit.distance.toFixed(1)} km</span></span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Fire Dept */}
          <div className="unit-category">
            <h4>🚒 Fire</h4>
            <div className="units-checklist">
              {fireUnits.length === 0 ? (
                <p className="empty-text">No units nearby</p>
              ) : (
                fireUnits.map((unit) => (
                  <label key={unit.id} className="unit-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedUnitIds.includes(unit.id)}
                      onChange={() => toggleUnitSelection(unit.id)}
                      disabled={isLoading}
                    />
                    <span className="unit-info">
                      <span className="unit-name">{unit.id} <span className="unit-distance">{unit.distance.toFixed(1)} km</span></span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Medical Teams */}
          <div className="unit-category">
            <h4>🚑 Medical</h4>
            <div className="units-checklist">
              {medicalUnits.length === 0 ? (
                <p className="empty-text">No units nearby</p>
              ) : (
                medicalUnits.map((unit) => (
                  <label key={unit.id} className="unit-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedUnitIds.includes(unit.id)}
                      onChange={() => toggleUnitSelection(unit.id)}
                      disabled={isLoading}
                    />
                    <span className="unit-info">
                      <span className="unit-name">{unit.id} <span className="unit-distance">{unit.distance.toFixed(1)} km</span></span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="dispatch-action">
          <button
            className="dispatch-btn"
            onClick={handleDispatchUnits}
            disabled={isLoading || selectedUnitIds.length === 0}
          >
            🚗 DISPATCH {selectedUnitIds.length > 0 ? `(${selectedUnitIds.length})` : ''} UNITS
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
