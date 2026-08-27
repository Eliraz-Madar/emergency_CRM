import { useState } from 'react';
import { FieldCommandSummaryView } from '../FieldCommandSummaryView.jsx';

/**
 * Field dashboard — "Central Command" panel.
 *
 * Shows what the central/war-room command has handed this post: linked
 * incidents, attached forces, and missions. One tab visible at a time so the
 * panel stays compact and never needs the whole left column to scroll to see
 * it. The rows themselves come from the shared FieldCommandSummaryView, so
 * this and the regional dashboard's field-command panel can't drift apart.
 *
 * `summary` is the raw FieldCommandSerializer payload (store.fieldCommandSummary).
 */

const TABS = [
  { id: 'incidents', icon: '🚨', label: 'Incidents', key: 'incidents' },
  { id: 'forces', icon: '👥', label: 'Forces', key: 'units' },
  { id: 'missions', icon: '🎯', label: 'Missions', key: 'missions' },
];

export default function FieldCommandAssignmentsPanel({ summary }) {
  const counts = {
    incidents: Array.isArray(summary?.incidents) ? summary.incidents.length : 0,
    units: Array.isArray(summary?.units) ? summary.units.length : 0,
    missions: Array.isArray(summary?.missions) ? summary.missions.length : 0,
  };

  // Open on the first tab that actually has something; fall back to Incidents.
  const [activeTab, setActiveTab] = useState(
    () => (TABS.find((t) => counts[t.key] > 0)?.id) || 'incidents',
  );

  if (!summary) return null;

  return (
    <div className="cc-assignments-panel">
      <h3>🏢 Central Command</h3>

      <div className="cc-assignments-tabs" role="tablist">
        {TABS.map(({ id, icon, label, key }) => (
          <button
            key={id}
            role="tab"
            aria-selected={activeTab === id}
            className={`cc-assignments-tab ${activeTab === id ? 'active' : ''}`}
            onClick={() => setActiveTab(id)}
          >
            <span>{icon} {label}</span>
            <span className="cc-assignments-tab-count">{counts[key]}</span>
          </button>
        ))}
      </div>

      <div className="cc-assignments-body">
        <FieldCommandSummaryView summary={summary} sections={[activeTab]} hideHeadings />
      </div>
    </div>
  );
}
