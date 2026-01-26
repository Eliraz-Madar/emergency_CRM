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
          {/* Field War-Room Dashboard */}
          <div
            className="dashboard-card regional-card"
            onClick={() => navigate('/regional')}
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
