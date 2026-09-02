import { useState } from 'react';
import { FieldCommandSummaryView } from '../FieldCommandSummaryView.jsx';

/**
 * Field dashboard — "Central Command" panel.
 *
 * Shows what the central/war-room command has handed this post: linked
 * incidents (each with its live casualty figures) and tasks. One tab visible
 * at a time so the panel stays compact and never needs the whole left column
 * to scroll to see it. The rows themselves come from the shared
 * FieldCommandSummaryView, so this and the regional dashboard's field-command
 * panel can't drift apart.
 *
 * Forces are deliberately NOT a tab here — units are committed to incidents,
 * not to the post itself, so a rescue post never has its own force roster to
 * show. (The war-room's own panel still lists directly-attached forces.)
 *
 * `summary` is the raw FieldCommandSerializer payload (store.fieldCommandSummary).
 */

const TABS = [
  { id: 'incidents', icon: '🚨', label: 'Incidents', key: 'incidents' },
  { id: 'missions', icon: '🎯', label: 'Tasks', key: 'missions' },
];

export default function FieldCommandAssignmentsPanel({ summary }) {
  const counts = {
    incidents: Array.isArray(summary?.incidents) ? summary.incidents.length : 0,
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
