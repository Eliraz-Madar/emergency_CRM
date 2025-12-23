/**
 * Field Incident Command Dashboard
 *
 * Single major incident management dashboard for large-scale events.
 * Command-level coordination of sectors, task groups, and resources.
 * 
 * Different from Regional Dashboard:
 * - Single incident focus (not list of incidents)
 * - Sector-based operational view
 * - Task group command hierarchy
 * - Casualty tracking and estimation
 * - Operational timeline for decision trail
 */

import { useEffect } from 'react';
import { useFieldIncidentStore } from '../store/fieldIncident';
import {
  getFieldIncident,
  connectToFieldIncidentStream,
  simulateFieldIncidentUpdate,
} from '../api/client';
import SituationOverview from '../components/field-incident/SituationOverview';
import SectorMap from '../components/field-incident/SectorMap';
import TaskGroupPanel from '../components/field-incident/TaskGroupPanel';
import OperationalTimeline from '../components/field-incident/OperationalTimeline';
import '../styles/field-incident-dashboard.css';

const FieldIncidentDashboard = () => {
  const setMajorIncident = useFieldIncidentStore((s) => s.setMajorIncident);
  const setSectors = useFieldIncidentStore((s) => s.setSectors);
  const setTaskGroups = useFieldIncidentStore((s) => s.setTaskGroups);
  const setEvents = useFieldIncidentStore((s) => s.setEvents);
  const setConnectionStatus = useFieldIncidentStore((s) => s.setConnectionStatus);
  const setLoading = useFieldIncidentStore((s) => s.setLoading);
  const setError = useFieldIncidentStore((s) => s.setError);
  const addEvent = useFieldIncidentStore((s) => s.addEvent);
  const updateMajorIncident = useFieldIncidentStore((s) => s.updateMajorIncident);
  const updateSector = useFieldIncidentStore((s) => s.updateSector);
  const updateTaskGroup = useFieldIncidentStore((s) => s.updateTaskGroup);
  const connectionStatus = useFieldIncidentStore((s) => s.connectionStatus);
  const loading = useFieldIncidentStore((s) => s.loading);
  const error = useFieldIncidentStore((s) => s.error);

  // Load initial data
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getFieldIncident();

        setMajorIncident(data.major_incident);
        setSectors(data.sectors);
        setTaskGroups(data.task_groups);
        setEvents(data.events);
        setLoading(false);
      } catch (err) {
        console.error('Failed to load field incident data:', err);
        setError(err.message || 'Failed to load data');
        setLoading(false);
      }
    };

    loadInitialData();
  }, [setMajorIncident, setSectors, setTaskGroups, setEvents, setLoading, setError]);

  // Connect to real-time updates
  useEffect(() => {
    let eventSource = null;
    let reconnectTimeout = null;

    const connect = () => {
      try {
        eventSource = connectToFieldIncidentStream();

        eventSource.onopen = () => {
          setConnectionStatus('CONNECTED');
        };

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === 'connected') {
              setConnectionStatus('CONNECTED');
            } else if (data.type === 'incident_update') {
              // Apply updates from server simulation
              const update = data.data;

              if (update.estimated_casualties) {
                updateMajorIncident({
                  estimated_casualties: update.estimated_casualties,
                });
              }

              if (update.sector_updates) {
                Object.entries(update.sector_updates).forEach(([idx, sectorUpdate]) => {
                  // Re-fetch sector data to get accurate index mapping
                  // In production, this would be handled by proper indexing
                });
              }

              if (update.task_updates) {
                Object.entries(update.task_updates).forEach(([idx, taskUpdate]) => {
                  updateTaskGroup(parseInt(idx), taskUpdate);
                });
              }

              if (update.new_event) {
                addEvent(update.new_event);
              }
            } else if (data.type === 'heartbeat') {
              // Keep-alive signal
            }
          } catch (err) {
            console.error('Failed to parse event data:', err);
          }
        };

        eventSource.onerror = () => {
          setConnectionStatus('OFFLINE');
          eventSource.close();

          // Attempt reconnect after 5 seconds
          reconnectTimeout = setTimeout(connect, 5000);
        };
      } catch (err) {
        console.error('Failed to connect to field incident stream:', err);
        setConnectionStatus('OFFLINE');
        reconnectTimeout = setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      if (eventSource) {
        eventSource.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  }, [setConnectionStatus, updateMajorIncident, updateSector, updateTaskGroup, addEvent]);

  // Simulate updates for demo (remove in production)
  useEffect(() => {
    const simulationInterval = setInterval(async () => {
      try {
        await simulateFieldIncidentUpdate();
      } catch (err) {
        console.error('Simulation update failed:', err);
      }
    }, 3000);

    return () => clearInterval(simulationInterval);
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="field-incident-dashboard">
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: '1.5rem' }}>
          Loading field incident data...
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="field-incident-dashboard">
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: '1.2rem', color: '#ef4444' }}>
          <div>⚠️ Error loading field incident data</div>
          <div style={{ fontSize: '1rem', marginTop: '1rem' }}>{error}</div>
          <button 
            onClick={() => window.location.reload()} 
            style={{ marginTop: '2rem', padding: '0.5rem 1rem', fontSize: '1rem', cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field-incident-dashboard">
      {/* Header */}
      <header className="dashboard-header">
        <div className="header-content">
          <h1>🎯 Field Incident Command Dashboard</h1>
          <div className="header-status">
            <span
              className={`connection-status ${connectionStatus.toLowerCase()}`}
              title={`Connection: ${connectionStatus}`}
            >
              {connectionStatus === 'CONNECTED' && '🟢'}
              {connectionStatus === 'OFFLINE' && '🔴'}
              {connectionStatus === 'DEGRADED' && '🟡'}
              {connectionStatus}
            </span>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <main className="dashboard-main">
        {/* Left Column: Situation Overview */}
        <section className="dashboard-section overview-section">
          <SituationOverview />
        </section>

        {/* Center Column: Sectors and Tasks */}
        <section className="dashboard-section operations-section">
          <div className="operations-column">
            <div className="operations-card sectors-card">
              <SectorMap />
            </div>
            <div className="operations-card timeline-card">
              <OperationalTimeline />
            </div>
          </div>
        </section>

        {/* Right Column: Task Groups */}
        <section className="dashboard-section tasks-section">
          <TaskGroupPanel />
        </section>
      </main>

      {/* Footer */}
      <footer className="dashboard-footer">
        <div className="footer-info">
          <span>🎖️ Field Incident Command System</span>
          <span className="timestamp">
            Updated: {new Date().toLocaleTimeString()}
          </span>
        </div>
      </footer>
    </div>
  );
};

export default FieldIncidentDashboard;
