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

import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFieldIncidentStore, generateRoutineEvent } from '../store/fieldIncident';
import {
  connectToFieldIncidentStream,
  simulateFieldIncidentUpdate,
  getFieldCommand,
} from '../api/client';
import SituationOverview from '../components/field-incident/SituationOverview';
import SectorMap from '../components/field-incident/SectorMap';
import TaskGroupPanel from '../components/field-incident/TaskGroupPanel';
import OperationalTimeline from '../components/field-incident/OperationalTimeline';
import '../styles/field-incident-dashboard.css';
import { formatTime, formatDateTime } from '../utils/time.js';

const FieldIncidentDashboard = () => {
  const navigate = useNavigate();

  const [selectedTimelineEvent, setSelectedTimelineEvent] = useState(null);
  const [selectedScenario, setSelectedScenario] = useState('FIRE');
  const [activeFieldName, setActiveFieldName] = useState('');

  const setConnectionStatus = useFieldIncidentStore((s) => s.setConnectionStatus);
  const setLoading = useFieldIncidentStore((s) => s.setLoading);
  const setError = useFieldIncidentStore((s) => s.setError);
  const loadFieldIncident = useFieldIncidentStore((s) => s.loadFieldIncident);
  const addEvent = useFieldIncidentStore((s) => s.addEvent);
  const updateMajorIncident = useFieldIncidentStore((s) => s.updateMajorIncident);
  const updateSector = useFieldIncidentStore((s) => s.updateSector);
  const updateTaskGroup = useFieldIncidentStore((s) => s.updateTaskGroup);
  const connectionStatus = useFieldIncidentStore((s) => s.connectionStatus);
  const loading = useFieldIncidentStore((s) => s.loading);
  const error = useFieldIncidentStore((s) => s.error);

  // Simulation state and actions
  const mode = useFieldIncidentStore((s) => s.mode);
  const simulationType = useFieldIncidentStore((s) => s.simulationType);
  const startSimulation = useFieldIncidentStore((s) => s.startSimulation);
  const nextSimulationStep = useFieldIncidentStore((s) => s.nextSimulationStep);
  const tickRoutinePatrol = useFieldIncidentStore((s) => s.tickRoutinePatrol);
  const stopSimulation = useFieldIncidentStore((s) => s.stopSimulation);
  const addIncidentEvent = useFieldIncidentStore((s) => s.addEvent);
  const moveUnits = useFieldIncidentStore((s) => s.moveUnits);
  const majorIncident = useFieldIncidentStore((s) => s.majorIncident);
  const setFieldId = useFieldIncidentStore((s) => s.setFieldId);
  const fieldId = useFieldIncidentStore((s) => s.fieldId);

  const simulationTimerRef = useRef(null);
  const routineEventTimerRef = useRef(null);
  const movementTimerRef = useRef(null);
  const lastLoadedFieldIdRef = useRef(null);

  const userRole = typeof window !== 'undefined' ? localStorage.getItem('userRole') : null;
  // Allow access when no role is set (e.g. direct URL navigation in dev/demo).
  // Only block explicitly non-field-manager roles.
  const hasAccess = !userRole || userRole === 'FIELD_MANAGER';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedFieldId = localStorage.getItem('fieldId');
    if (storedFieldId && setFieldId) {
      setFieldId(storedFieldId);
    }
  }, [setFieldId]);

  // Fetch human-readable name for the active control center
  useEffect(() => {
    if (!fieldId) return;
    getFieldCommand(fieldId)
      .then((data) => {
        if (data?.name) setActiveFieldName(data.name);
      })
      .catch(() => {/* silently ignore – name is cosmetic */});
  }, [fieldId]);

  // Load initial data — skip if a drill or live incident is already in the store
  // so navigating back to this page mid-simulation never overwrites active state.
  useEffect(() => {
    if (!fieldId) return;
    if (lastLoadedFieldIdRef.current === fieldId) return;

    // Simulation is already running — reuse existing store state without
    // hitting the API (it has sectors, task-groups and events already loaded).
    if (mode === 'SIMULATION') {
      setLoading(false);
      lastLoadedFieldIdRef.current = fieldId;
      return;
    }

    // NOTE: we intentionally do NOT skip the API load for mode === 'LIVE'.
    // The War-Room sets majorIncident to a thin incident object (no sectors /
    // task-groups / events). We need loadFieldIncident() to hydrate the full
    // field-command scenario so SituationOverview, SectorMap and TaskGroupPanel
    // have the rich data they require.

    const loadInitialData = async () => {
      try {
        lastLoadedFieldIdRef.current = fieldId;
        await loadFieldIncident?.(fieldId);
      } catch (err) {
        console.error('Failed to load field incident data:', err);
        setError(err.message || 'Failed to load data');
        setLoading(false);
      }
    };

    loadInitialData();
  }, [fieldId, mode, majorIncident, loadFieldIncident]);

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
          setConnectionStatus('CONNECTING');
          eventSource.close();
          reconnectTimeout = setTimeout(() => {
            // Re-fetch events to catch anything missed during the disconnect
            loadFieldIncident?.();
            connect();
          }, 2000);
        };
      } catch (err) {
        console.error('Failed to connect to field incident stream:', err);
        setConnectionStatus('CONNECTING');
        reconnectTimeout = setTimeout(connect, 2000);
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
  useEffect(() => {
    // Only run backend simulation in ROUTINE mode
    if (mode !== 'ROUTINE') {
      return;
    }

    const simulationInterval = setInterval(async () => {
      try {
        await simulateFieldIncidentUpdate();
      } catch (err) {
        console.error('Simulation update failed:', err);
      }
    }, 5000);

    return () => clearInterval(simulationInterval);
  }, [mode]);

  // Routine mode event generator (nationwide routine events)
  useEffect(() => {
    if (routineEventTimerRef.current) {
      clearInterval(routineEventTimerRef.current);
    }

    if (mode !== 'ROUTINE') {
      return undefined;
    }

    routineEventTimerRef.current = setInterval(() => {
      const evt = generateRoutineEvent();
      addIncidentEvent(evt);
    }, 12000); // ~12s cadence; adjust as needed within 10-15s range

    return () => {
      if (routineEventTimerRef.current) {
        clearInterval(routineEventTimerRef.current);
      }
    };
  }, [mode, addIncidentEvent]);

  // Timer - advance the drill scenario every ~2.5 seconds.
  // The ROUTINE-mode branch used to call tickRoutinePatrol(), randomly
  // walking seeded demo units around the map with no real device connected.
  // That branch is disabled; SIMULATION mode is kept — it's an
  // operator-initiated, clearly-labeled training drill, not unsolicited
  // demo movement. See final changes/04_disable_frontend_map_simulation.md.
  useEffect(() => {
    if (simulationTimerRef.current) {
      clearInterval(simulationTimerRef.current);
    }

    simulationTimerRef.current = setInterval(() => {
      if (mode === 'SIMULATION') {
        nextSimulationStep();
      }
      // else if (mode === 'ROUTINE') { tickRoutinePatrol(); } — disabled
    }, 2500);

    return () => {
      if (simulationTimerRef.current) {
        clearInterval(simulationTimerRef.current);
      }
    };
  }, [mode, nextSimulationStep, tickRoutinePatrol]);

  // Movement simulation loop — DISABLED.
  // This used to call moveUnits() every 500ms, interpolating unit markers
  // along fake routes. Unit markers now render strictly at their last
  // reported GPS coordinates. See
  // final changes/04_disable_frontend_map_simulation.md.
  //
  // useEffect(() => {
  //   if (movementTimerRef.current) {
  //     clearInterval(movementTimerRef.current);
  //   }
  //   movementTimerRef.current = setInterval(() => {
  //     const { moveUnits: getMoveUnits } = useFieldIncidentStore.getState();
  //     getMoveUnits();
  //   }, 500);
  //   return () => {
  //     if (movementTimerRef.current) {
  //       clearInterval(movementTimerRef.current);
  //     }
  //   };
  // }, []);

  // Handlers for simulation buttons
  const handleStartSimulation = () => {
    if (selectedScenario) {
      startSimulation(selectedScenario);
    }
  };

  const handleStopSimulation = () => {
    stopSimulation();
  };

  if (!hasAccess) {
    return (
      <div className="field-incident-dashboard">
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '100dvh', fontSize: '1.2rem', padding: '2rem' }}>
          <div>🚫 Access denied</div>
          <div style={{ marginTop: '0.5rem', fontSize: '1rem' }}>
            Field ID: {fieldId || 'unknown'}
          </div>
          <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#94a3b8' }}>
            TODO(auth): replace with real login + role validation
          </div>
          <button
            onClick={() => window.history.back()}
            style={{ marginTop: '1.5rem', padding: '0.5rem 1rem', fontSize: '1rem', cursor: 'pointer' }}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="field-incident-dashboard">
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100dvh', fontSize: '1.5rem', padding: '2rem' }}>
          Loading field incident data...
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="field-incident-dashboard">
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '100dvh', fontSize: '1.2rem', color: '#ef4444', padding: '2rem' }}>
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
      {/* Unified Command Header */}
      <header className="dashboard-header" style={{
        backgroundColor: '#1a1a2e',
        borderBottom: mode === 'SIMULATION' ? '3px solid #dc2626' : '3px solid #475569',
        padding: '1rem 2rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
      }}>
        {/* Left: Home button + Title + Active Control Center */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
          <button
            onClick={() => navigate('/')}
            title="Return to dashboard selection"
            style={{
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid rgba(51, 65, 85, 0.7)',
              borderRadius: '6px',
              color: '#94a3b8',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 11px',
              fontSize: '0.8rem',
              fontWeight: '600',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              lineHeight: 1,
              transition: 'border-color 0.2s, color 0.2s, background 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(96, 165, 250, 0.5)';
              e.currentTarget.style.color = '#e2e8f0';
              e.currentTarget.style.background = 'rgba(30, 41, 59, 0.9)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(51, 65, 85, 0.7)';
              e.currentTarget.style.color = '#94a3b8';
              e.currentTarget.style.background = 'rgba(15, 23, 42, 0.6)';
            }}
          >
            🏠 Home
          </button>
          <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: '1.5rem', color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            🎯 Field Incident Command Dashboard
          </h1>
          <div style={{ marginTop: '0.4rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              fontSize: '0.72rem',
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              fontWeight: '600',
            }}>
              Active Control Center:
            </span>
            <span style={{
              fontSize: '0.95rem',
              color: '#60a5fa',
              fontWeight: '700',
              letterSpacing: '0.02em',
            }}>
              {activeFieldName || fieldId || '—'}
            </span>
          </div>
          </div>
        </div>

        {/* Center: Simulation Controls — flex:1 on all three columns keeps this truly centered */}
        <div style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '1rem',
          padding: '0 1rem',
        }}>
          {mode === 'ROUTINE' ? (
            <>
              <span style={{
                color: '#94a3b8',
                fontSize: '0.85rem',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                ⚡ Tactical Simulation:
              </span>
              <select
                value={selectedScenario}
                onChange={(e) => setSelectedScenario(e.target.value)}
                style={{
                  backgroundColor: '#0f172a',
                  color: '#e2e8f0',
                  border: '1px solid #475569',
                  borderRadius: '4px',
                  padding: '0.5rem 0.8rem',
                  fontSize: '0.85rem',
                  fontWeight: '500',
                  cursor: 'pointer',
                  outline: 'none',
                  minWidth: '180px',
                }}
              >
                <option value="FIRE">🔥 Fire Emergency</option>
                <option value="TSUNAMI">🌊 Tsunami Event</option>
                <option value="EARTHQUAKE">🏚️ Earthquake Crisis</option>
                <option value="MISSILE">🚀 Missile Attack</option>
              </select>

              <button
                onClick={handleStartSimulation}
                style={{
                  backgroundColor: '#dc2626',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '0.5rem 1.2rem',
                  fontSize: '0.85rem',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(220, 38, 38, 0.3)',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = '#b91c1c';
                  e.target.style.transform = 'translateY(-1px)';
                  e.target.style.boxShadow = '0 4px 6px rgba(220, 38, 38, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = '#dc2626';
                  e.target.style.transform = 'translateY(0)';
                  e.target.style.boxShadow = '0 2px 4px rgba(220, 38, 38, 0.3)';
                }}
              >
                ▶ Activate
              </button>
            </>
          ) : (
            <>
              <div
                style={{
                  backgroundColor: '#7f1d1d',
                  color: 'white',
                  padding: '0.5rem 1rem',
                  borderRadius: '4px',
                  fontSize: '0.85rem',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                  border: '2px solid #dc2626',
                }}
              >
                <span style={{
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  backgroundColor: '#fca5a5',
                  borderRadius: '50%',
                  animation: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite',
                }}></span>
                🚨 LIVE: {simulationType}
              </div>

              <button
                onClick={handleStopSimulation}
                style={{
                  backgroundColor: '#991b1b',
                  color: 'white',
                  border: '2px solid #ef4444',
                  borderRadius: '4px',
                  padding: '0.5rem 1.2rem',
                  fontSize: '0.85rem',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  cursor: 'pointer',
                  boxShadow: '0 0 15px rgba(239, 68, 68, 0.4)',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = '#7f1d1d';
                  e.target.style.boxShadow = '0 0 25px rgba(239, 68, 68, 0.6)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = '#991b1b';
                  e.target.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.4)';
                }}
              >
                ⏹ Terminate
              </button>
            </>
          )}
        </div>

        {/* Right: Server Status */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          justifyContent: 'center',
          gap: '0.25rem',
        }}>
          <div style={{
            color: mode === 'SIMULATION' ? '#fca5a5' : '#10b981',
            fontSize: '0.75rem',
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}>
            <span style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              backgroundColor: mode === 'SIMULATION' ? '#dc2626' : '#10b981',
              borderRadius: '50%',
            }}></span>
            {mode === 'SIMULATION' ? 'Training Mode' : 'Operational'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              className={`connection-status ${connectionStatus.toLowerCase()}`}
              style={{
                fontSize: '0.75rem',
                color: connectionStatus === 'CONNECTED' ? '#10b981' : connectionStatus === 'OFFLINE' ? '#ef4444' : '#f59e0b',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
              title={`Connection: ${connectionStatus}`}
            >
              {connectionStatus === 'CONNECTED' && '🟢'}
              {connectionStatus === 'OFFLINE' && '🔴'}
              {connectionStatus === 'DEGRADED' && '🟡'}
              {connectionStatus === 'CONNECTING' && '🟡'}
              {' '}{connectionStatus}
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
              <OperationalTimeline onShowDetails={setSelectedTimelineEvent} />
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
            Updated: {formatTime(new Date())}
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
                      return formatDateTime(date);
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
