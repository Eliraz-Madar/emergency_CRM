/**
 * Dashboard Selector
 *
 * Entry point for choosing between two operational dashboards:
 * 1. Regional / Multi-Incident Dashboard - for dispatch and coordination of multiple incidents
 * 2. Field Incident Command Dashboard - for command-level management of single major incident
 */

import { useNavigate } from 'react-router-dom';
import '../styles/dashboard-selector.css';

const DashboardSelector = () => {
  const navigate = useNavigate();

  return (
    <div className="dashboard-selector">
      <div className="selector-container">
        {/* Header */}
        <div className="selector-header">
          <h1>🎯 Emergency Response Command System</h1>
          <p>Select operational dashboard</p>
        </div>

        {/* Dashboard Options */}
        <div className="dashboard-options">
          {/* Regional Dashboard */}
          <div
            className="dashboard-card regional-card"
            onClick={() => navigate('/regional')}
          >
            <div className="card-icon">📍</div>
            <h2>Regional Dashboard</h2>
            <p className="card-subtitle">Multi-Incident Dispatch</p>
            
            <div className="card-description">
              <p>
                Coordinate <strong>multiple incidents</strong> across a geographic region.
              </p>
              <ul className="features-list">
                <li>Dispatch incident list</li>
                <li>Unit availability tracking</li>
                <li>Multi-incident status monitoring</li>
                <li>Real-time event log</li>
                <li>Regional map overview</li>
              </ul>
            </div>

            <div className="card-use-case">
              <strong>Best For:</strong> Daily operations, disaster response across multiple sites,
              standard dispatch coordination
            </div>

            <button className="card-button">Open Regional Dashboard</button>
          </div>

          {/* Field Incident Dashboard */}
          <div
            className="dashboard-card field-card"
            onClick={() => navigate('/field-incident')}
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
        <div className="selector-info">
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
                  <td>Multiple incidents</td>
                  <td>Single major incident</td>
                </tr>
                <tr>
                  <td className="aspect-label">View Level</td>
                  <td>Dispatch coordination</td>
                  <td>Command decision-making</td>
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
        </div>

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
