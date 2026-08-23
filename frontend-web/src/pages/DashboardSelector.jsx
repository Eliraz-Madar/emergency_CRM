/**
 * Dashboard Selector
 *
 * Entry point for choosing between two operational dashboards:
 * 1. Regional / Multi-Incident Dashboard - for dispatch and coordination of multiple incidents
 * 2. Field Incident Command Dashboard - for command-level management of single major incident
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFieldCommand, getFieldCommands } from '../api/client';
import '../styles/dashboard-selector.css';

const DashboardSelector = () => {
  const navigate = useNavigate();
  const [fieldId, setFieldId] = useState('field-1');
  const [isFieldManager, setIsFieldManager] = useState(false);
  const [fieldValidationError, setFieldValidationError] = useState('');
  const [fieldOptions, setFieldOptions] = useState([]);
  const [fieldOptionsError, setFieldOptionsError] = useState('');

  useEffect(() => {
    try {
      const storedFieldId = localStorage.getItem('fieldId');
      const storedRole = localStorage.getItem('userRole');
      if (storedFieldId) setFieldId(storedFieldId);
      if (storedRole === 'FIELD_MANAGER') setIsFieldManager(true);
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    const loadFieldCommands = async () => {
      try {
        const fields = await getFieldCommands();
        const all = Array.isArray(fields) ? fields : [];
        // A closed field command can no longer be opened via this picker —
        // GET /api/field-commands/ itself stays unfiltered (other consumers
        // rely on the full list), this is purely a client-side exclusion.
        // "CLOSED" matches FieldCommand.Status.CLOSED exactly
        // (backend/api/models.py).
        const normalized = all.filter((field) => field.status !== 'CLOSED');
        setFieldOptions(normalized);
        if (!normalized.find((field) => field.id === fieldId) && normalized[0]?.id) {
          handleFieldChange(normalized[0].id);
        }
      } catch (error) {
        console.error('Failed to load field commands:', error);
        setFieldOptionsError('Failed to load field commands.');
      }
    };

    loadFieldCommands();
  }, []);

  const handleFieldChange = (value) => {
    setFieldId(value);
    try {
      localStorage.setItem('fieldId', value);
    } catch {
      // ignore storage errors
    }
  };

  const handleRoleToggle = (checked) => {
    setIsFieldManager(checked);
    try {
      localStorage.setItem('userRole', checked ? 'FIELD_MANAGER' : 'VIEWER');
    } catch {
      // ignore storage errors
    }
  };

  const validateAndNavigate = (path) => {
    // The fieldId dropdown is already populated from the backend list,
    // so a second async round-trip validation is unnecessary and can hang
    // when the SSE stream holds Django's dev-server threads.
    navigate(path);
  };

  return (
    <div className="dashboard-selector">
      <div className="selector-container">
        {/* Header */}
        <div className="selector-header">
          <h1>🎯 Emergency Response Command System</h1>
          <p>Select operational dashboard</p>
        </div>

        {/* Operator Configuration */}
        <div className="selector-context">
          <div className="context-header">
            <span className="context-header-icon">🏢</span>
            <div>
              <h3 className="context-title">Select Control Center</h3>
              <p className="context-subtitle">Choose your assigned field command post before entering a dashboard</p>
            </div>
          </div>

          <div className="context-fields">
            {/* Field Selection */}
            <div className="context-field-group">
              <label htmlFor="fieldId" className="context-label">
                <span className="context-label-icon">📍</span>
                Active Control Center
              </label>
              <div className="context-select-wrapper">
                <select
                  id="fieldId"
                  className="context-select"
                  value={fieldId}
                  onChange={(e) => handleFieldChange(e.target.value)}
                >
                  {fieldOptions.length ? (
                    fieldOptions.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.name || field.id}
                      </option>
                    ))
                  ) : (
                    <option value={fieldId}>{fieldId}</option>
                  )}
                </select>
                <span className="context-select-arrow">▾</span>
              </div>
              {fieldOptionsError && (
                <div className="context-error">{fieldOptionsError}</div>
              )}
              {fieldValidationError && (
                <div className="context-error">{fieldValidationError}</div>
              )}
            </div>

            {/* Access Level Toggle */}
            <div className="context-field-group">
              <span className="context-label">
                <span className="context-label-icon">🎖️</span>
                Operator Access Level
              </span>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={isFieldManager}
                  onChange={(e) => handleRoleToggle(e.target.checked)}
                />
                <span className="toggle-slider" />
                <span className="toggle-text">
                  {isFieldManager ? 'Field Manager' : 'Viewer'}
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Dashboard Options */}
        <div className="dashboard-options">
          {/* Field War-Room Dashboard */}
          <div
            className="dashboard-card regional-card"
            onClick={() => validateAndNavigate('/regional')}
          >
            <div className="card-icon">🎯</div>
            <h2>Field War-Room Dashboard</h2>
            <p className="card-subtitle">Command Center Operations</p>

            <div className="card-description">
              <p>
                <strong>High-level command center</strong> for strategic coordination across multiple incidents and scenarios.
              </p>
              <ul className="features-list">
                <li>Multi-incident command overview</li>
                <li>Strategic resource allocation</li>
                <li>Simulation-synchronized display</li>
                <li>Real-time operational intelligence</li>
                <li>War-room map with live sectors</li>
              </ul>
            </div>

            <div className="card-use-case">
              <strong>Best For:</strong> Executive oversight, strategic planning, simulation training,
              multi-agency coordination at command level
            </div>

            <button className="card-button">Open War-Room Dashboard</button>
          </div>

          {/* Field Incident Dashboard */}
          <div
            className="dashboard-card field-card"
            onClick={() => validateAndNavigate('/field-incident')}
          >
            <div className="card-icon">🎖️</div>
            <h2>Field Incident Command</h2>
            <p className="card-subtitle">Single Major Incident</p>

            <div className="card-description">
              <p>
                Command-level management of <strong>large-scale incidents</strong> requiring
                multi-agency coordination.
              </p>
              <ul className="features-list">
                <li>Sector-based operational view</li>
                <li>Task group management</li>
                <li>Casualty tracking & estimation</li>
                <li>Hazard assessment by sector</li>
                <li>Operational timeline & decision trail</li>
              </ul>
            </div>

            <div className="card-use-case">
              <strong>Best For:</strong> Earthquakes, building collapses, missile strikes,
              large-scale disasters requiring command coordination
            </div>

            <button className="card-button">Open Field Command Dashboard</button>
          </div>
        </div>

        {/* Info Section */}
        {/* <div className="selector-info">
          <div className="info-card">
            <h3>Architectural Differences</h3>
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Aspect</th>
                  <th>Regional</th>
                  <th>Field Command</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="aspect-label">Focus</td>
                  <td>Strategic command center</td>
                  <td>Single major incident</td>
                </tr>
                <tr>
                  <td className="aspect-label">View Level</td>
                  <td>Executive oversight</td>
                  <td>Tactical command operations</td>
                </tr>
                <tr>
                  <td className="aspect-label">Primary Entity</td>
                  <td>Incidents</td>
                  <td>Sectors & Task Groups</td>
                </tr>
                <tr>
                  <td className="aspect-label">Data Model</td>
                  <td>Incident → Tasks → Units</td>
                  <td>
                    MajorIncident → Sectors<br />
                    MajorIncident → TaskGroups
                  </td>
                </tr>
                <tr>
                  <td className="aspect-label">Real-Time</td>
                  <td>SSE updates via polling</td>
                  <td>SSE simulation stream</td>
                </tr>
                <tr>
                  <td className="aspect-label">Timeline</td>
                  <td>Event log only</td>
                  <td>Operational decision trail</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div> */}

        {/* Footer */}
        <footer className="selector-footer">
          <p>💡 Both dashboards reuse the same real-time infrastructure and map components</p>
          <p>🔄 Scalable architecture supports adding more dashboard types</p>
        </footer>
      </div>
    </div>
  );
};

export default DashboardSelector;
