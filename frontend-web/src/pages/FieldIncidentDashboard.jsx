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

import { useEffect, useState } from 'react';
import { useFieldIncidentStore } from '../store/fieldIncident';
import {
  getFieldIncident,
  connectToFieldIncidentStream,
  simulateFieldIncidentUpdate,
  resetFieldIncident,
} from '../api/client';
import SituationOverview from '../components/field-incident/SituationOverview';
import SectorMap from '../components/field-incident/SectorMap';
import TaskGroupPanel from '../components/field-incident/TaskGroupPanel';
import OperationalTimeline from '../components/field-incident/OperationalTimeline';
import '../styles/field-incident-dashboard.css';

const FieldIncidentDashboard = () => {
  const [selectedTimelineEvent, setSelectedTimelineEvent] = useState(null);
  const [selectedScenario, setSelectedScenario] = useState('EARTHQUAKE');
  const [isDrillActive, setIsDrillActive] = useState(false);

  const activeDrillId = useFieldIncidentStore((s) => s.activeDrillId);
  const setMajorIncident = useFieldIncidentStore((s) => s.setMajorIncident);
  const setSectors = useFieldIncidentStore((s) => s.setSectors);
  const setTaskGroups = useFieldIncidentStore((s) => s.setTaskGroups);
  const setEvents = useFieldIncidentStore((s) => s.setEvents);
  const setConnectionStatus = useFieldIncidentStore((s) => s.setConnectionStatus);
  const setLoading = useFieldIncidentStore((s) => s.setLoading);
  const setError = useFieldIncidentStore((s) => s.setError);
  const setActiveDrillId = useFieldIncidentStore((s) => s.setActiveDrillId);
  const setIsDrillActiveStore = useFieldIncidentStore((s) => s.setIsDrillActive);
  const clearAllDrillData = useFieldIncidentStore((s) => s.clearAllDrillData);
  const addEvent = useFieldIncidentStore((s) => s.addEvent);
  const updateMajorIncident = useFieldIncidentStore((s) => s.updateMajorIncident);
  const updateSector = useFieldIncidentStore((s) => s.updateSector);
  const updateTaskGroup = useFieldIncidentStore((s) => s.updateTaskGroup);
  const connectionStatus = useFieldIncidentStore((s) => s.connectionStatus);
  const loading = useFieldIncidentStore((s) => s.loading);
  const error = useFieldIncidentStore((s) => s.error);

  // SAFE "Reset-Then-Load" function
  // Ensures immediate zero state before any data operations
  const resetThenLoad = async (drillId) => {
    try {
      // STEP 1: IMMEDIATE ZERO STATE (The "Purge")
      // Clear ALL drill data atomically using the store action
      clearAllDrillData();
      setLoading(true);
      setConnectionStatus('DISCONNECTED');

      console.log(`[RESET-THEN-LOAD] Zero state applied for drill ${drillId}`);

      // STEP 2: SCOPED DATA FETCHING
      // After zero state is guaranteed, fetch drill-specific data
      const data = await getFieldIncident();

      // STEP 3: LOAD ONLY DRILL-SCOPED DATA
      // The backend filters by drill context, so we only receive this drill's data
      if (data && data.major_incident) {
        setMajorIncident(data.major_incident);
      }
      if (data && data.sectors) {
        setSectors(data.sectors);
      }
      if (data && data.task_groups) {
        setTaskGroups(data.task_groups);
      }
      if (data && data.events) {
        setEvents(data.events);
      }

      setConnectionStatus('CONNECTED');
      setLoading(false);

      console.log(`[RESET-THEN-LOAD] Data loaded for drill ${drillId}`);
    } catch (err) {
      console.error('Failed to load drill data:', err);
      setError('Failed to load drill data');
      setLoading(false);
    }
  };

  // Handle drill reset with STRICT ISOLATION
  const handleStartDrill = async () => {
    if (!window.confirm(`Are you sure you want to START A NEW DRILL (${selectedScenario})? This will wipe current data.`)) {
      return;
    }

    // STEP 1: HARD RESET STATE (must happen FIRST, before any API call)
    // Clear ALL drill data atomically using the store action
    clearAllDrillData();
    setIsDrillActive(false);
    setConnectionStatus('DISCONNECTED');
    setLoading(true);

    console.log('[HARD-RESET] All incident data cleared for new drill');

    try {
      // STEP 2: FETCH NEW DRILL DATA (after hard reset is guaranteed)
      // API will initiate new drill context and return fresh data
      const newData = await resetFieldIncident(selectedScenario);

      // STEP 3: SET DRILL CONTEXT (before loading data)
      if (newData.drill_id) {
        setActiveDrillId(newData.drill_id);
        console.log(`[DRILL-CONTEXT] Active drill set to: ${newData.drill_id}`);
      }

      // STEP 4: LOAD FRESH DATA FROM API
      // Only data from the new drill context will be loaded
      if (newData.major_incident) {
        setMajorIncident(newData.major_incident);
      }
      if (newData.sectors) {
        setSectors(newData.sectors);
      }
      if (newData.task_groups) {
        setTaskGroups(newData.task_groups);
      }
      if (newData.events) {
        setEvents(newData.events);
      }

      // STEP 5: UPDATE UI STATE
      setConnectionStatus('CONNECTING');
      setIsDrillActive(true);
      setIsDrillActiveStore(true);
      setLoading(false);

      console.log(`[DRILL-LOADED] New drill data loaded: ${selectedScenario}`);
      alert(`🚨 DRILL STARTED: ${selectedScenario}\nAll units reset. Operational timer started.`);
    } catch (err) {
      console.error('Failed to start drill:', err);
      setError('Failed to start simulation drill');
      setLoading(false);
    }
  };

  // Load Routine Mode - Populate dashboard with 20 mock events (4 hours of history)
  const loadRoutineMode = () => {
    // Generate 20 mock routine events from the last 4 hours
    const now = Date.now();
    const fourHoursAgo = now - (4 * 60 * 60 * 1000);
    const routineEventTypes = [
      'Car Accident - Ayalon North',
      'Brush Fire - Negev',
      'Suspicious Object - Jerusalem',
      'Medical Emergency - Tel Aviv Central',
      'Structural Hazard - Haifa Port',
      'Gas Leak - Beer Sheva',
      'Electrical Fire - Ramat Gan',
      'Vehicle Collision - Highway 6',
      'Water Main Break - Netanya',
      'Hazardous Materials - Ashdod',
      'Building Alarm - Tel Aviv',
      'Cardiac Emergency - Rishon LeZion',
      'Traffic Congestion - Jerusalem',
      'Minor Fire - Rehovot',
      'Noise Complaint - Bnei Brak',
      'Lost Person - Eilat',
      'Animal Control - Herzliya',
      'Minor Injury - Petach Tikva',
      'Welfare Check - Modiin',
      'Equipment Maintenance - Ashkelon',
    ];

    const mockEvents = routineEventTypes.map((title, index) => {
      const timestamp = fourHoursAgo + (index * (240 * 60 * 1000 / 20)); // Spread across 4 hours
      return {
        id: `routine-${index}`,
        title: title,
        event_type: 'ROUTINE_OPERATION',
        severity: index % 2 === 0 ? 'LOW' : 'MEDIUM',
        description: `Routine monitoring event: ${title}`,
        created_at: timestamp,
        created_by: 'Automated System',
      };
    });

    const routineIncident = {
      id: 'routine-monitoring',
      title: 'Routine Operations Center',
      status: 'MONITORING',
      description: 'Nationwide routine monitoring. No major active directives.',
      estimated_casualties: 0,
    };

    // Update store immediately
    setEvents(mockEvents);
    setMajorIncident(routineIncident);
    setActiveDrillId(null);
    setIsDrillActive(false);
    setIsDrillActiveStore(false);
    setConnectionStatus('ROUTINE');
  };

  const enterRoutineMode = () => {
    console.log("Entering Routine Mode...");

    // 1. Generate 20 Mock Routine Events
    const routineEvents = Array.from({ length: 20 }).map((_, i) => ({
      id: `routine-${i}`,
      title: `Routine Event #${i + 1}: ${['Traffic Accident', 'Brush Fire', 'Suspicious Object', 'Medical Emergency'][i % 4]}`,
      event_type: ['ACCIDENT', 'FIRE', 'SECURITY', 'MEDICAL'][i % 4],
      severity: 'LOW',
      description: 'Routine operation reported. Units dispatched.',
      created_at: new Date(Date.now() - (i * 1000 * 60 * 10)).toISOString(), // 10 min intervals
      created_by: 'Dispatcher'
    }));

    // 2. Create Routine Incident Context
    const routineIncident = {
      title: "Routine Security Operations",
      status: "MONITORING",
      incident_type: "ROUTINE",
      description: "Nationwide routine monitoring active. No major directives.",
      estimated_casualties: 0,
      confirmed_deaths: 0,
      displaced_persons: 0
    };

    // 3. FORCE STORE UPDATES (Batch update)
    clearAllDrillData(); // Clear old drill data first

    // Slight delay to ensure clear finishes before setting new data
    setTimeout(() => {
      setEvents(routineEvents);
      setMajorIncident(routineIncident);
      setConnectionStatus('ROUTINE');
      setIsDrillActive(false);
      setIsDrillActiveStore(false);
      setLoading(false);
    }, 50);
  };

  // Handle drill stop - Switch to Routine Monitoring Mode
  const handleStopDrill = () => {
    if (window.confirm('Stop current drill and return to routine operation?')) {
      enterRoutineMode();
    }
  };

  // Load initial data
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        // STEP 1: HARD RESET STATE (must happen BEFORE any API call)
        // Clear ALL drill data atomically using the store action
        clearAllDrillData();
        setLoading(true);
        setConnectionStatus('DISCONNECTED');

        console.log('[HARD-RESET] All incident data cleared synchronously');

        // STEP 2: FETCH NEW DATA (after hard reset is guaranteed)
        // Backend will serve only data for the active drill context
        const data = await getFieldIncident();

        // STEP 3: UPDATE STATE WITH FETCHED DATA (only populate what was retrieved)
        if (!data || !data.major_incident) {
          // No active major incident - enter Routine Mode immediately
          enterRoutineMode();
          console.log('[LOAD-COMPLETE] No active drill - entered routine mode');
        } else {
          setMajorIncident(data.major_incident);
          if (data.sectors) {
            setSectors(data.sectors);
          }
          if (data.task_groups) {
            setTaskGroups(data.task_groups);
          }
          if (data.events) {
            setEvents(data.events);
          }
          setLoading(false);
          setConnectionStatus('CONNECTED');
          console.log('[LOAD-COMPLETE] Field incident data loaded for active drill');
        }
      } catch (err) {
        console.error('Failed to load field incident data:', err);
        setError(err.message || 'Failed to load data');
        setLoading(false);
      }
    };

    loadInitialData();
  }, []); // Empty dependency array - only run once on mount

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
  }, []); // Empty dependency array - Zustand setters are stable

  // Simulate updates for demo (remove in production)
  // useEffect(() => {
  //   const simulationInterval = setInterval(async () => {
  //     try {
  //       await simulateFieldIncidentUpdate();
  //     } catch (err) {
  //       console.error('Simulation update failed:', err);
  //     }
  //   }, 5000);
  //
  //   return () => clearInterval(simulationInterval);
  // }, []);

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

          <div className="simulation-controls">
            {isDrillActive ? (
              <div className="drill-active-indicator">
                <span className="pulsing-dot">🔴</span> LIVE DRILL: {selectedScenario.replace('_', ' ')}
                <button onClick={handleStopDrill} className="stop-drill-btn">
                  ⏹ STOP DRILL
                </button>
              </div>
            ) : (
              <>
                <select
                  className="scenario-select"
                  value={selectedScenario}
                  onChange={(e) => setSelectedScenario(e.target.value)}
                >
                  <option value="EARTHQUAKE">Earthquake</option>
                  <option value="MISSILE_STRIKE">Missile Strike</option>
                  <option value="BUILDING_COLLAPSE">Building Collapse</option>
                </select>
                <button
                  className="start-drill-btn"
                  onClick={handleStartDrill}
                  disabled={loading}
                >
                  ⚠️ START DRILL
                </button>
              </>
            )}
          </div>

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
              <SectorMap key={activeDrillId || 'init-sectors'} />
            </div>
            <div className="operations-card timeline-card">
              <OperationalTimeline onShowDetails={setSelectedTimelineEvent} />
            </div>
          </div>
        </section>

        {/* Right Column: Task Groups */}
        <section className="dashboard-section tasks-section">
          <TaskGroupPanel key={activeDrillId || 'init-tasks'} />
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

      {/* Event Details Modal */}
      {selectedTimelineEvent && (
        <div className="event-details-modal-overlay" onClick={() => setSelectedTimelineEvent(null)}>
          <div className="event-details-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selectedTimelineEvent.title}</h3>
              <button
                className="modal-close-btn"
                onClick={() => setSelectedTimelineEvent(null)}
                title="Close"
              >
                ✕
              </button>
            </div>

            <div className="modal-content">
              <div className="detail-row">
                <strong>Event Type:</strong>
                <span>{selectedTimelineEvent.event_type.replace(/_/g, ' ')}</span>
              </div>
              <div className="detail-row">
                <strong>Severity:</strong>
                <span>{selectedTimelineEvent.severity}</span>
              </div>
              <div className="detail-row">
                <strong>Timestamp:</strong>
                <span>
                  {(() => {
                    let date = null;
                    if (selectedTimelineEvent.created_at) {
                      date = typeof selectedTimelineEvent.created_at === 'number'
                        ? new Date(selectedTimelineEvent.created_at * 1000)
                        : new Date(selectedTimelineEvent.created_at);
                    }
                    if (date && !isNaN(date.getTime())) {
                      return date.toLocaleString();
                    }
                    return 'No timestamp available';
                  })()}
                </span>
              </div>
              {selectedTimelineEvent.created_by && (
                <div className="detail-row">
                  <strong>Created By:</strong>
                  <span>{selectedTimelineEvent.created_by}</span>
                </div>
              )}
              {selectedTimelineEvent.description && (
                <div className="detail-section">
                  <strong>Description:</strong>
                  <p>{selectedTimelineEvent.description}</p>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                className="modal-btn-primary"
                onClick={() => setSelectedTimelineEvent(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FieldIncidentDashboard;
