/**
 * Task Group Command Panel
 *
 * Displays and manages task groups with progress tracking and priority.
 * Command-level view of operational objectives.
 */

import { useState } from 'react';
import { useFieldIncidentStore } from '../../store/fieldIncident';

const TaskGroupPanel = () => {
  const taskGroups = useFieldIncidentStore((s) => s.taskGroups);
  const filterCategory = useFieldIncidentStore((s) => s.filterCategory);
  const taskStatusFilter = useFieldIncidentStore((s) => s.taskStatusFilter);
  const setFilterCategory = useFieldIncidentStore((s) => s.setFilterCategory);
  const setTaskStatusFilter = useFieldIncidentStore((s) => s.setTaskStatusFilter);
  const getFilteredTaskGroups = useFieldIncidentStore((s) => s.getFilteredTaskGroups);
  const updateTaskGroup = useFieldIncidentStore((s) => s.updateTaskGroup);

  const [expandedTask, setExpandedTask] = useState(null);

  const filteredTasks = getFilteredTaskGroups();

  const categoryColors = {
    SEARCH_RESCUE: '#ef4444',
    EVACUATION: '#f97316',
    MEDICAL: '#ec4899',
    UTILITIES: '#8b5cf6',
    SECURITY: '#3b82f6',
    LOGISTICS: '#06b6d4',
    DAMAGE_ASSESSMENT: '#f59e0b',
    COMMUNICATIONS: '#14b8a6',
  };

  const priorityIcons = {
    CRITICAL: '🚨',
    HIGH: '⚠️',
    MEDIUM: '📋',
    LOW: '📌',
  };

  const statusIcons = {
    PLANNED: '📅',
    IN_PROGRESS: '▶️',
    PAUSED: '⏸️',
    COMPLETED: '✅',
  };

  const categories = Array.from(new Set(taskGroups.map((tg) => tg.category)));
  const statuses = ['all', 'in-progress', 'completed'];

  return (
    <div className="task-group-panel">
      <h3>Task Group Command</h3>

      {/* Filters */}
      <div className="filter-controls">
        <div className="filter-group">
          <label>Category:</label>
          <select
            value={filterCategory || ''}
            onChange={(e) => setFilterCategory(e.target.value || null)}
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>Status:</label>
          <select
            value={taskStatusFilter}
            onChange={(e) => setTaskStatusFilter(e.target.value)}
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status === 'all' ? 'All Status' : status.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Task Groups List */}
      <div className="task-group-container">
        {filteredTasks.length === 0 ? (
          <p className="no-data">No task groups match filters</p>
        ) : (
          <div className="task-groups-list">
            {filteredTasks.map((taskGroup, idx) => (
              <div
                key={idx}
                className={`task-group-item ${taskGroup.status.toLowerCase()}`}
                style={{
                  borderLeft: `4px solid ${categoryColors[taskGroup.category] || '#666'
                    }`,
                }}
              >
                {/* Header */}
                <div
                  className="task-group-header"
                  onClick={() =>
                    setExpandedTask(expandedTask === idx ? null : idx)
                  }
                >
                  <div className="task-title-section">
                    <span className="priority-icon">
                      {priorityIcons[taskGroup.priority]}
                    </span>
                    <h4>{taskGroup.title}</h4>
                    <span className="status-icon">
                      {statusIcons[taskGroup.status]}
                    </span>
                  </div>
                  <div className="task-progress">
                    <span className="progress-percent">
                      {taskGroup.progress_percent}%
                    </span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="progress-container">
                  <div className="progress-bar">
                    <div
                      className={`progress-fill ${taskGroup.status.toLowerCase()}`}
                      style={{ width: `${taskGroup.progress_percent}%` }}
                    ></div>
                  </div>
                </div>

                {/* Quick Info */}
                <div className="task-quick-info">
                  <span>
                    {taskGroup.completed_subtasks}/{taskGroup.total_subtasks} subtasks
                  </span>
                  <span>{taskGroup.assigned_units_count} units assigned</span>
                </div>

                {/* Expanded Details */}
                {expandedTask === idx && (
                  <div className="task-details">
                    <div className="detail-section">
                      <label>Category:</label>
                      <span>{taskGroup.category.replace(/_/g, ' ')}</span>
                    </div>

                    <div className="detail-section">
                      <label>Description:</label>
                      <span>{taskGroup.description}</span>
                    </div>

                    <div className="detail-section">
                      <label>Commander:</label>
                      <span>{taskGroup.commander_name || 'Unassigned'}</span>
                    </div>

                    <div className="detail-section">
                      <label>Sectors Involved:</label>
                      <div className="sectors-list">
                        {taskGroup.sector_ids && taskGroup.sector_ids.length > 0 ? (
                          taskGroup.sector_ids.map((sectorId) => (
                            <span key={sectorId} className="sector-tag">
                              {sectorId}
                            </span>
                          ))
                        ) : (
                          <span>No specific sectors</span>
                        )}
                      </div>
                    </div>

                    <div className="detail-section">
                      <label>Notes:</label>
                      <span className="notes-text">{taskGroup.notes}</span>
                    </div>

                    {/* Timeline */}
                    <div className="detail-section">
                      <label>Status Timeline:</label>
                      <div className="timeline-info">
                        <span>
                          Status: {taskGroup.status.replace(/_/g, ' ')}
                        </span>
                        <span>
                          Priority: {taskGroup.priority}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary Footer */}
      <div className="task-group-footer">
        <div className="footer-stat">
          <span>Total Groups:</span>
          <strong>{taskGroups.length}</strong>
        </div>
        <div className="footer-stat">
          <span>Displayed:</span>
          <strong>{filteredTasks.length}</strong>
        </div>
        <div className="footer-stat">
          <span>In Progress:</span>
          <strong>
            {taskGroups.filter((tg) => tg.status === 'IN_PROGRESS').length}
          </strong>
        </div>
      </div>
    </div>
  );
};

export default TaskGroupPanel;
