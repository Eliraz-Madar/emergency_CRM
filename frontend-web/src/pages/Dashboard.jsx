import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatTime } from '../utils/time.js';
import { useDashboardStore } from '../store/dashboard.js';
import { useFieldIncidentStore } from '../store/fieldIncident.js';
import { RealtimeService } from '../services/realtime.js';
import { KPICards } from '../components/KPICards.jsx';
import { FilterBar } from '../components/FilterBar.jsx';
import { IncidentList } from '../components/IncidentList.jsx';
import { MapView } from '../components/MapView.jsx';
import { IncidentDetailsPanel } from '../components/IncidentDetailsPanel.jsx';
import { EventFeed } from '../components/EventFeed.jsx';
import * as api from '../api/client.js';

/**
 * Dashboard Page - Main operational dashboard (War-Room)
 * 
 * Syncs with Field Incident Dashboard when simulation is active.
 * Displays real operational data when in routine mode.
 */
export default function Dashboard() {
  const navigate = useNavigate();

  const {
    setIncidents,
    setUnits,
    setEvents,
    addIncident,
    updateIncident,
    updateUnit,
    addEvent,
    setConnectionStatus,
    connectionStatus,
    demoMode,
    lastUpdateTime,
    incidents,
    events,
    selectedIncidentId,
    selectedUnitId,
    selectedUnitIds,
    units,
    activeFilter: storedActiveFilter,
    setActiveFilter: storeSetActiveFilter,
    zoomToIncidentId,
    clearZoomToIncident,
    setFlashingIncident,
    clearFlashingIncident,
  } = useDashboardStore();

  // Connect to Field Incident simulation store
  const {
    mode: fieldMode,
    simulationType,
    startSimulation,
    stopSimulation,
    majorIncident,
    sectors: fieldSectors,
    events: fieldTimeline,
    taskGroups,
    units: simulationUnits,
    routineUnits,
    moveUnits,
    tickRoutinePatrol,
    setLiveIncident,
    setMode: setFieldMode,
  } = useFieldIncidentStore();

  const [isLoading, setIsLoading] = useState(true);
  const [realtimeService, setRealtimeService] = useState(null);
  const eventsRef = React.useRef(events);
  const [showEventFeed, setShowEventFeed] = useState(false);
  // activeFilter is persisted in the store so it survives page refresh
  const activeFilter = storedActiveFilter;
  const setActiveFilter = storeSetActiveFilter;
  const [selectedScenario, setSelectedScenario] = useState('FIRE');
  const [activeFieldId, setActiveFieldId] = useState('');
  const [activeFieldName, setActiveFieldName] = useState('');
  const [fieldCommands, setFieldCommands] = useState([]);
  const [selectedFieldCommand, setSelectedFieldCommand] = useState(null);
  const [fieldCommandSummary, setFieldCommandSummary] = useState(null);
  const [fieldCommandLoading, setFieldCommandLoading] = useState(false);
  const [fieldCommandError, setFieldCommandError] = useState('');
  const [isCreateFieldOpen, setIsCreateFieldOpen] = useState(false);
  const [createFieldLocation, setCreateFieldLocation] = useState(null);
  const [createFieldForm, setCreateFieldForm] = useState({
    unitName: '',
    incidentType: '',
    notes: '',
    status: 'DISPATCHING',
    incidentPhase: 'Containment',
  });

  // Load the selected control-center name from localStorage on mount
  useEffect(() => {
    const storedFieldId = localStorage.getItem('fieldId');
    if (!storedFieldId) return;
    setActiveFieldId(storedFieldId);
    api.getFieldCommand(storedFieldId)
      .then((data) => {
        if (data?.name) setActiveFieldName(data.name);
      })
      .catch(() => {/* silently ignore – name is cosmetic */});
  }, []);

  // Simulation override detection
  const isSimulation = fieldMode === 'SIMULATION';
  const activeUnits = isSimulation ? simulationUnits : (routineUnits.length > 0 ? routineUnits : units);
  const selectedUnit = Array.isArray(activeUnits) && selectedUnitId
    ? activeUnits.find((u) => String(u.id) === String(selectedUnitId))
    : null;
  const selectedUnitDestination = selectedUnit
    ? selectedUnit.assignedTo
      ? ((incidents || []).find((inc) => inc.id === selectedUnit.assignedTo)?.title || 'Assigned Incident')
      : (Array.isArray(selectedUnit.assignedTarget) && selectedUnit.assignedTarget.length === 2
        ? `${selectedUnit.assignedTarget[0].toFixed(5)}, ${selectedUnit.assignedTarget[1].toFixed(5)}`
        : (selectedUnit.assignedTarget && selectedUnit.assignedTarget.lat !== undefined && selectedUnit.assignedTarget.lng !== undefined
          ? `${selectedUnit.assignedTarget.lat.toFixed(5)}, ${selectedUnit.assignedTarget.lng.toFixed(5)}`
          : 'None'))
    : 'None';

  const handleStartSimulation = () => {
    if (selectedScenario) {
      startSimulation(selectedScenario);
    }
  };

  const handleStopSimulation = () => {
    stopSimulation();
  };

  const refreshFieldCommands = async () => {
    const fields = await api.getFieldCommands();
    setFieldCommands(fields || []);
  };

  const handleFieldCommandSelect = async (field) => {
    if (!field?.id) return;
    setSelectedFieldCommand(field);
    setFieldCommandLoading(true);
    setFieldCommandError('');
    try {
      const summary = await api.getFieldCommand(field.id);
      setFieldCommandSummary(summary);
    } catch (error) {
      console.error('Failed to load field command summary:', error);
      setFieldCommandError('Failed to load field command data.');
    } finally {
      setFieldCommandLoading(false);
    }
  };

  const handleAssignUnitToField = async (unitId) => {
    if (!selectedFieldCommand?.id || !unitId) return;
    setFieldCommandLoading(true);
    setFieldCommandError('');
    try {
      await api.assignUnitToField(selectedFieldCommand.id, unitId);
      const [updatedUnits, updatedSummary] = await Promise.all([
        api.getUnits(),
        api.getFieldCommand(selectedFieldCommand.id),
      ]);
      setUnits(updatedUnits || []);
      setFieldCommandSummary(updatedSummary);
      await refreshFieldCommands();
    } catch (error) {
      console.error('Failed to assign unit to field:', error);
      setFieldCommandError('Failed to assign unit.');
    } finally {
      setFieldCommandLoading(false);
    }
  };

  const handleMapCreateFieldCommand = (coords) => {
    setCreateFieldLocation(coords);
    setIsCreateFieldOpen(true);
  };

  const handleCreateFieldChange = (field, value) => {
    setCreateFieldForm((prev) => ({ ...prev, [field]: value }));
  };

  const resetCreateFieldForm = () => {
    setCreateFieldForm({
      unitName: '',
      incidentType: '',
      notes: '',
      status: 'DISPATCHING',
      incidentPhase: 'Containment',
    });
    setCreateFieldLocation(null);
  };

  const handleCreateFieldSubmit = async (event) => {
    event.preventDefault();
    if (!createFieldLocation) return;
    setFieldCommandLoading(true);
    setFieldCommandError('');
    try {
      const payload = {
        name: createFieldForm.unitName || 'Field Command',
        unit_name: createFieldForm.unitName || 'Field Unit',
        incident_type: createFieldForm.incidentType || 'General Incident',
        initial_report: createFieldForm.notes,
        status: createFieldForm.status,
        incident_phase: createFieldForm.incidentPhase,
        location_lat: createFieldLocation.lat,
        location_lng: createFieldLocation.lng,
      };
      const created = await api.createFieldCommand(payload);
      await refreshFieldCommands();
      if (created?.id) {
        await handleFieldCommandSelect(created);
      }
      setIsCreateFieldOpen(false);
      resetCreateFieldForm();
    } catch (error) {
      console.error('Failed to create field command:', error);
      setFieldCommandError('Failed to create field command.');
    } finally {
      setFieldCommandLoading(false);
    }
  };

  const handleCancelCreateField = () => {
    setIsCreateFieldOpen(false);
    resetCreateFieldForm();
  };

  const handleCloseFieldCommand = async () => {
    if (!selectedFieldCommand?.id) return;
    setFieldCommandLoading(true);
    setFieldCommandError('');
    try {
      await api.closeFieldCommand(selectedFieldCommand.id);
      setSelectedFieldCommand(null);
      setFieldCommandSummary(null);
      await refreshFieldCommands();
    } catch (error) {
      console.error('Failed to close field command:', error);
      setFieldCommandError('Failed to close the field command.');
    } finally {
      setFieldCommandLoading(false);
    }
  };

  useEffect(() => {
    if (!isCreateFieldOpen) return;
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        handleCancelCreateField();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isCreateFieldOpen]);

  // Link field dashboard to selected incident in regional dashboard
  useEffect(() => {
    if (fieldMode === 'SIMULATION') return;
    if (!selectedIncidentId) return;

    const selected = (incidents || []).find((inc) => inc.id === selectedIncidentId);
    if (!selected) return;

    setFieldMode && setFieldMode('LIVE');
    setLiveIncident && setLiveIncident(selected);
  }, [selectedIncidentId, incidents, setLiveIncident, setFieldMode, fieldMode]);

  // Keep a ref to events so the sync effect below can read it without
  // adding it to the dependency array (which would cause an infinite loop).
  useEffect(() => { eventsRef.current = events; }, [events]);

  // Mirror active simulation timeline into the War-Room event feed.
  // Only runs in SIMULATION mode — not in LIVE mode, because in LIVE mode
  // the operational events are added directly via addEvent() (dispatch / arrival)
  // and a setEvents() replacement call would wipe them.
  // NOTE: 'events' is intentionally NOT in the dependency array — we read
  // it via eventsRef to avoid the set→change→re-run→set infinite loop.
  useEffect(() => {
    if (!isSimulation || !fieldTimeline) return;

    const convertedEvents = fieldTimeline.map((evt, idx) => ({
      id: evt.id ? `sim-${evt.id}` : `sim-${idx}`,
      timestamp: evt.timestamp || evt.created_at || new Date().toISOString(),
      entity_type: 'simulation',
      entity_id: majorIncident?.id || 'sim',
      message: evt.title || evt.message || 'Simulation event',
      level: evt.severity === 'CRITICAL' ? 'error'
        : evt.severity === 'WARNING' || evt.severity === 'HIGH' ? 'warn' : 'info',
    }));

    const nonSimulationEvents = (eventsRef.current || []).filter(
      (e) => e?.entity_type !== 'simulation' && !String(e?.id || '').startsWith('sim-')
    );

    setEvents([...convertedEvents, ...nonSimulationEvents]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSimulation, fieldTimeline, majorIncident, setEvents]);

  // Initialize data and realtime connection
  useEffect(() => {
    const initializeData = async () => {
      try {
        setConnectionStatus('CONNECTING');

        // Fetch initial data
        const [incidents, units, events] = await Promise.all([
          api.getIncidents(),
          api.getUnits(),
          api.getEvents(200),
        ]);

        setIncidents(incidents);
        setUnits(units);
        setEvents(events);
        try {
          await refreshFieldCommands();
        } catch (error) {
          console.warn('Failed to load field commands:', error);
        }

        // ── Restore dispatch assignments that survived the page refresh ──────
        // Assignments are written to localStorage each time units are dispatched
        // and removed when those units arrive on scene.
        try {
          const saved = JSON.parse(localStorage.getItem('ecm-dispatch-assignments') || '[]');
          if (saved.length > 0) {
            // Group by incident so one dispatchUnitsToIncident call handles all
            // units for the same incident at once.
            const byIncident = {};
            saved.forEach(({ unitId, incidentId, incidentLat, incidentLng, incidentTitle }) => {
              if (!byIncident[incidentId]) {
                byIncident[incidentId] = { incidentId, incidentLat, incidentLng, incidentTitle, unitIds: [] };
              }
              byIncident[incidentId].unitIds.push(unitId);
            });

            const { dispatchUnitsToIncident } = useFieldIncidentStore.getState();

            for (const assignment of Object.values(byIncident)) {
              // silent=true: skip voice + event-log entries on restore
              dispatchUnitsToIncident({
                incidentId: assignment.incidentId,
                unitIds: assignment.unitIds,
                targetPosition: [assignment.incidentLat, assignment.incidentLng],
                silent: true,
              });
              // Mark the incident IN_PROGRESS in the War-Room store too
              updateIncident(assignment.incidentId, { status: 'IN_PROGRESS' });
            }

            // Add a single restore notice to the event log
            addEvent({
              id: `restore-dispatch-${Date.now()}`,
              timestamp: new Date().toISOString(),
              entity_type: 'system',
              entity_id: 'system',
              message: `🔄 Restored ${saved.length} unit dispatch assignment${saved.length > 1 ? 's' : ''} from previous session`,
              level: 'info',
            });
          }
        } catch (_) { /* non-critical — bad saved data should never block load */ }
        // ─────────────────────────────────────────────────────────────────────

        setConnectionStatus('CONNECTED');
        setIsLoading(false);

        // Connect to realtime updates
        const realtime = new RealtimeService(
          (update) => {
            if (update.type === 'connected') {
              console.log('Connected to real-time updates');
              setConnectionStatus('CONNECTED');
            } else if (update.type === 'incident_created') {
              addIncident(update.data);
              addEvent({
                id: Math.random(),
                timestamp: new Date().toISOString(),
                entity_type: 'incident',
                entity_id: update.data.id,
                message: `New incident: ${update.data.title}`,
                level: 'warn',
              });
            } else if (update.type === 'incident_updated') {
              updateIncident(update.data.id, update.data);
              addEvent({
                id: Math.random(),
                timestamp: new Date().toISOString(),
                entity_type: 'incident',
                entity_id: update.data.id,
                message: `Incident updated`,
                level: 'info',
              });
            } else if (update.type === 'unit_updated') {
              updateUnit(update.data.id, update.data);
            }
          },
          (error) => {
            console.error('Realtime error:', error);
            // 'connection_dropped' means the SSE closed and is actively reconnecting —
            // show CONNECTING so the indicator turns yellow and resolves once onopen fires.
            // Other errors (parse, unexpected) degrade to DEGRADED with fallback polling.
            if (error?.type === 'connection_dropped') {
              setConnectionStatus('CONNECTING');
            } else {
              setConnectionStatus('DEGRADED');
            }
          }
        );

        realtime.connect();
        setRealtimeService(realtime);
      } catch (error) {
        console.error('Failed to initialize dashboard:', error);
        setConnectionStatus('OFFLINE');
        setIsLoading(false);
      }
    };

    initializeData();

    return () => {
      realtimeService?.disconnect();
    };
  }, []);

  // Fallback polling when realtime is unavailable.
  // Covers both DEGRADED (SSE parse errors) and OFFLINE (backend unreachable on load).
  // On OFFLINE we also attempt to re-initialise the SSE stream once data loads.
  useEffect(() => {
    if (connectionStatus !== 'DEGRADED' && connectionStatus !== 'OFFLINE') return;

    const interval = setInterval(async () => {
      try {
        const [incidents, units, events] = await Promise.all([
          api.getIncidents(),
          api.getUnits(),
          api.getEvents(200),
        ]);
        setIncidents(incidents);
        setUnits(units);
        setEvents(events);
        setIsLoading(false);

        // If we were fully offline, attempt to reconnect SSE now
        if (connectionStatus === 'OFFLINE') {
          setConnectionStatus('CONNECTING');
          const realtime = new RealtimeService(
            (update) => {
              if (update.type === 'connected') setConnectionStatus('CONNECTED');
            },
            (error) => {
              if (error?.type === 'connection_dropped') {
                setConnectionStatus('CONNECTING');
              } else {
                setConnectionStatus('DEGRADED');
              }
            }
          );
          realtime.connect();
          setRealtimeService(realtime);
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [connectionStatus]);

  // Unit movement loop — runs every 500 ms for smooth animation.
  // Also handles routine patrol ticks in ROUTINE mode.
  useEffect(() => {
    const movementInterval = setInterval(() => {
      const { moveUnits: latestMoveUnits, tickRoutinePatrol: latestTickPatrol, mode } = useFieldIncidentStore.getState();

      if (mode === 'ROUTINE' && latestTickPatrol) {
        latestTickPatrol();
      }
      if (latestMoveUnits) {
        latestMoveUnits();
      }
    }, 500);

    return () => clearInterval(movementInterval);
  }, []);

  // Simulation step loop — advances the active drill scenario every 2 500 ms.
  // Mirrors the timer in FieldIncidentDashboard so the drill keeps running
  // even when the user is on the War-Room and Field Command is not open.
  useEffect(() => {
    const simInterval = setInterval(() => {
      const { mode, nextSimulationStep: latestNextStep } = useFieldIncidentStore.getState();
      if (mode === 'SIMULATION' && latestNextStep) {
        latestNextStep();
      }
    }, 2500);

    return () => clearInterval(simInterval);
  }, []);

  const getConnectionStatusColor = () => {
    const colors = {
      CONNECTED: '#10b981',
      CONNECTING: '#f59e0b',
      DEGRADED: '#eab308',
      OFFLINE: '#ef4444',
    };
    return colors[connectionStatus] || '#6b7280';
  };

  const getConnectionStatusText = () => {
    const texts = {
      CONNECTED: '🟢 LIVE',
      CONNECTING: '🟡 CONNECTING',
      DEGRADED: '🟡 DEGRADED',
      OFFLINE: '🔴 OFFLINE',
    };
    return texts[connectionStatus] || 'UNKNOWN';
  };

  if (isLoading) {
    return (
      <div className="dashboard loading">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Initializing Dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      {/* Simulation Mode Banner */}
      {isSimulation && (
        <div className="simulation-banner">
          <div className="banner-content">
            <span className="banner-icon">⚠️</span>
            <span className="banner-text">
              SIMULATION MODE ACTIVE - {simulationType || 'UNKNOWN'} SCENARIO
            </span>
            <span className="banner-badge">TRAINING EXERCISE</span>
          </div>
        </div>
      )}

      {/* Top Bar */}
      <div className="dashboard-topbar">
        <div className="topbar-left" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
          <h1>🎯 Field War-Room Dashboard</h1>
          {(activeFieldName || activeFieldId) && (
            <span style={{
              background: 'rgba(96, 165, 250, 0.15)',
              border: '1px solid rgba(96, 165, 250, 0.4)',
              color: '#60a5fa',
              borderRadius: '6px',
              padding: '3px 10px',
              fontSize: '0.78rem',
              fontWeight: '700',
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
              textTransform: 'uppercase',
            }}>
              📍 {activeFieldName || activeFieldId}
            </span>
          )}
        </div>
        <div className="topbar-center">
          {lastUpdateTime && (
            <small>Last update: {formatTime(lastUpdateTime)}</small>
          )}
        </div>
        <div className="topbar-right">
          {demoMode && <span className="demo-badge">DEMO MODE</span>}
          <span
            className="connection-status"
            style={{ color: getConnectionStatusColor() }}
          >
            {getConnectionStatusText()}
          </span>
          {fieldMode !== 'SIMULATION' ? (
            <>
              <select
                value={selectedScenario}
                onChange={(e) => setSelectedScenario(e.target.value)}
                style={{
                  backgroundColor: '#0f172a',
                  color: '#e2e8f0',
                  border: '1px solid #475569',
                  borderRadius: '4px',
                  padding: '0.35rem 0.6rem',
                  fontSize: '0.75rem',
                  fontWeight: '500',
                  cursor: 'pointer',
                  outline: 'none',
                  minWidth: '150px',
                }}
                title="Select drill scenario"
              >
                <option value="FIRE">🔥 Fire Emergency</option>
                <option value="TSUNAMI">🌊 Tsunami Event</option>
                <option value="EARTHQUAKE">🏚️ Earthquake Crisis</option>
                <option value="MISSILE">🚀 Missile Attack</option>
              </select>
              <button
                className="feed-toggle"
                onClick={handleStartSimulation}
                title="Start emergency drill"
                style={{ backgroundColor: '#dc2626', borderColor: '#dc2626' }}
              >
                ▶ Drill
              </button>
            </>
          ) : (
            <button
              className="feed-toggle"
              onClick={handleStopSimulation}
              title="Stop emergency drill"
              style={{ backgroundColor: '#991b1b', borderColor: '#991b1b' }}
            >
              ⏹ Stop Drill
            </button>
          )}
          <button
            className="feed-toggle"
            onClick={() => window.open('/field-incident', '_blank', 'noopener,noreferrer')}
          >
            🧭 Open Field
          </button>
          <button
            className="feed-toggle"
            onClick={() => setShowEventFeed(!showEventFeed)}
          >
            📋 Events {showEventFeed ? '✕' : ''}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="dashboard-section">
        <KPICards
          simulationData={isSimulation && majorIncident ? {
            estimated_casualties: majorIncident.estimated_casualties,
            displaced_persons: majorIncident.displaced_persons,
            confirmed_deaths: majorIncident.confirmed_deaths,
            active_sectors: fieldSectors.filter(s => s?.status === 'ACTIVE').length,
          } : null}
        />
      </div>

      {/* Filter Bar */}
      <div className="dashboard-section">
        <FilterBar />
      </div>

      {/* Main Content Area */}
      <div className="dashboard-content">
        {/* Left: Incident List */}
        <div className="content-left">
          <IncidentList
            activeFilter={activeFilter}
            setActiveFilter={setActiveFilter}
            isSimulation={isSimulation}
            simulationEvents={isSimulation ? fieldTimeline : null}
          />
        </div>

        {/* Center: Map */}
        <div className="content-center">
          <MapView
            simulationSectors={isSimulation ? fieldSectors : null}
            activeFilter={activeFilter}
            isSimulation={isSimulation}
            simulationIncident={isSimulation && majorIncident ? {
              id: majorIncident.id || 'sim-incident',
              lat: majorIncident.location_lat || 31.77,
              lng: majorIncident.location_lng || 35.22,
              name: majorIncident.title || 'Incident Location',
              priority: majorIncident.priority || 'HIGH',
              status: majorIncident.status || 'IN_PROGRESS',
              title: majorIncident.title || 'Incident',
              location_name: majorIncident.location_name || 'Field Location'
            } : null}
            simulationUnits={isSimulation ? simulationUnits : null}
            routineUnits={!isSimulation ? routineUnits : null}
            selectedUnitIds={selectedUnitIds}
            fieldCommands={fieldCommands}
            selectedFieldCommandId={selectedFieldCommand?.id || null}
            onFieldCommandSelect={handleFieldCommandSelect}
            onMapCreateFieldCommand={handleMapCreateFieldCommand}
          />
        </div>

        {/* Right: Details + Events */}
        <div className="content-right">
          {selectedUnit && (
            <div
              style={{
                background: 'rgba(8, 18, 35, 0.92)',
                border: '1px solid #2563eb',
                borderRadius: '10px',
                padding: '14px',
                marginBottom: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div>
                  <div style={{ fontSize: '0.95rem', fontWeight: '700' }}>Selected Vehicle</div>
                  <div style={{ color: '#94a3b8', fontSize: '0.82rem' }}>Click a unit on the map to inspect it</div>
                </div>
                <span style={{ background: '#2563eb', color: '#fff', borderRadius: '999px', padding: '4px 10px', fontSize: '0.75rem' }}>
                  {selectedUnit.type || 'Unit'}
                </span>
              </div>
              <div style={{ color: '#e2e8f0', fontSize: '0.95rem', fontWeight: '600' }}>{selectedUnit.name || `Unit ${selectedUnit.id}`}</div>
              <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }}>
                <div style={{ background: '#0f172a', padding: '10px', borderRadius: '10px', border: '1px solid #334155' }}>
                  <div style={{ color: '#94a3b8', fontSize: '0.72rem', textTransform: 'uppercase' }}>Assigned</div>
                  <div style={{ marginTop: '4px', color: '#fff', fontWeight: '700' }}>{selectedUnit.assignedTo ? 'Yes' : 'No'}</div>
                </div>
                <div style={{ background: '#0f172a', padding: '10px', borderRadius: '10px', border: '1px solid #334155' }}>
                  <div style={{ color: '#94a3b8', fontSize: '0.72rem', textTransform: 'uppercase' }}>Destination</div>
                  <div style={{ marginTop: '4px', color: '#fff', fontWeight: '700' }}>
                    {selectedUnitDestination}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: '10px', color: '#94a3b8', fontSize: '0.85rem' }}>
                Status: {selectedUnit.status || 'Unknown'}
              </div>
            </div>
          )}
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid #334155',
              borderRadius: '10px',
              padding: '12px',
              marginBottom: '12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Field Command Overview</h3>
              <button
                className="feed-toggle"
                onClick={refreshFieldCommands}
                style={{ fontSize: '0.75rem' }}
              >
                ⟳ Refresh
              </button>
            </div>
            {fieldCommandError && (
              <div style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: '6px' }}>
                {fieldCommandError}
              </div>
            )}
            {!selectedFieldCommand && (
              <div style={{ color: '#94a3b8', marginTop: '8px', fontSize: '0.85rem' }}>
                Select a field command marker on the map or click "Open Command" in the marker popup to assign forces.
              </div>
            )}
            {selectedFieldCommand && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ fontWeight: 600 }}>{selectedFieldCommand.name || selectedFieldCommand.id}</div>
                <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                  Incidents: {fieldCommandSummary?.incidents?.length ?? selectedFieldCommand.incidents_count ?? 0} | Forces: {fieldCommandSummary?.units?.length ?? selectedFieldCommand.units_count ?? 0}
                </div>

                {fieldCommandLoading && (
                  <div style={{ color: '#e2e8f0', fontSize: '0.8rem', marginTop: '8px' }}>
                    Loading field command data...
                  </div>
                )}

                {fieldCommandSummary && (
                  <>
                    <div style={{ marginTop: '10px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '0.8rem', color: '#e2e8f0' }}>
                        <div>Status: {fieldCommandSummary.status || 'ACTIVE'}</div>
                        <div>Phase: {fieldCommandSummary.incident_phase || 'Containment'}</div>
                        <div>Casualties: {fieldCommandSummary.casualty_count ?? 0}</div>
                        <div>Evacuated: {fieldCommandSummary.evacuated_count ?? 0}</div>
                      </div>
                    </div>
                    <div style={{ marginTop: '10px' }}>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px' }}>Operational Notes</div>
                      {fieldCommandSummary.operational_notes?.length ? (
                        <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                          {fieldCommandSummary.operational_notes.map((note, idx) => (
                            <div key={`${note.timestamp || idx}`} style={{ fontSize: '0.78rem', padding: '4px 0' }}>
                              <div style={{ color: '#94a3b8' }}>{note.timestamp || ''}</div>
                              <div>{note.message || ''}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>No notes yet.</div>
                      )}
                    </div>
                    <div style={{ marginTop: '10px' }}>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px' }}>Assigned Incidents</div>
                      {fieldCommandSummary.incidents?.length ? (
                        <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                          {fieldCommandSummary.incidents.map((incident) => (
                            <div key={incident.id} style={{ fontSize: '0.8rem', padding: '4px 0' }}>
                              {incident.title || 'Incident'}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No assigned incidents</div>
                      )}
                    </div>

                    <div style={{ marginTop: '10px' }}>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px' }}>Assigned Forces</div>
                      {fieldCommandSummary.units?.length ? (
                        <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                          {fieldCommandSummary.units.map((unit) => (
                            <div key={unit.id} style={{ fontSize: '0.8rem', padding: '4px 0' }}>
                              {unit.name || `Unit ${unit.id}`} ({unit.type})
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No assigned forces</div>
                      )}
                    </div>

                    <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="feed-toggle"
                        onClick={handleCloseFieldCommand}
                        style={{
                          backgroundColor: '#ef4444',
                          borderColor: '#ef4444',
                          fontSize: '0.8rem',
                          padding: '0.5rem 0.75rem',
                        }}
                      >
                        Close Camp
                      </button>
                    </div>
                  </>
                )}

                <div style={{ marginTop: '12px' }}>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px' }}>Assign Global Forces</div>
                  {Array.isArray(units) && units.filter((u) => !u.field_id).length ? (
                    <div style={{ maxHeight: '140px', overflowY: 'auto' }}>
                      {units.filter((u) => !u.field_id).slice(0, 10).map((unit) => (
                        <div key={unit.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <span style={{ fontSize: '0.8rem' }}>{unit.name || `Unit ${unit.id}`}</span>
                          <button
                            className="feed-toggle"
                            style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
                            onClick={() => handleAssignUnitToField(unit.id)}
                          >
                            Assign
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No unassigned forces available</div>
                  )}
                </div>
              </div>
            )}
          </div>
          {showEventFeed ? (
            <EventFeed />
          ) : (
            <IncidentDetailsPanel />
          )}
        </div>
      </div>

      {isCreateFieldOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999,
          }}
          onClick={handleCancelCreateField}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '12px',
              padding: '16px',
              width: '360px',
              color: '#e2e8f0',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Create Field Command</h3>
            <form onSubmit={handleCreateFieldSubmit}>
              <label style={{ fontSize: '0.8rem' }}>Unit Name</label>
              <input
                type="text"
                value={createFieldForm.unitName}
                onChange={(e) => handleCreateFieldChange('unitName', e.target.value)}
                style={{ width: '100%', margin: '6px 0 10px', padding: '6px', borderRadius: '6px' }}
                placeholder="Field Command Alpha"
                required
              />
              <label style={{ fontSize: '0.8rem' }}>Incident Type</label>
              <input
                type="text"
                value={createFieldForm.incidentType}
                onChange={(e) => handleCreateFieldChange('incidentType', e.target.value)}
                style={{ width: '100%', margin: '6px 0 10px', padding: '6px', borderRadius: '6px' }}
                placeholder="Wildfire"
                required
              />
              <label style={{ fontSize: '0.8rem' }}>Initial Report / Notes</label>
              <textarea
                value={createFieldForm.notes}
                onChange={(e) => handleCreateFieldChange('notes', e.target.value)}
                style={{ width: '100%', margin: '6px 0 10px', padding: '6px', borderRadius: '6px', minHeight: '70px' }}
                placeholder="Initial situation report..."
              />
              <label style={{ fontSize: '0.8rem' }}>Initial Status</label>
              <select
                value={createFieldForm.status}
                onChange={(e) => handleCreateFieldChange('status', e.target.value)}
                style={{ width: '100%', margin: '6px 0 10px', padding: '6px', borderRadius: '6px' }}
              >
                <option value="DISPATCHING">Dispatching</option>
                <option value="ACTIVE">Active</option>
                <option value="CONTAINMENT">Containment</option>
                <option value="EVACUATION">Evacuation</option>
                <option value="CLEANUP">Cleanup</option>
              </select>
              <label style={{ fontSize: '0.8rem' }}>Incident Phase</label>
              <input
                type="text"
                value={createFieldForm.incidentPhase}
                onChange={(e) => handleCreateFieldChange('incidentPhase', e.target.value)}
                style={{ width: '100%', margin: '6px 0 12px', padding: '6px', borderRadius: '6px' }}
                placeholder="Containment"
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="feed-toggle"
                  onClick={handleCancelCreateField}
                >
                  Cancel
                </button>
                <button type="submit" className="feed-toggle">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="dashboard-footer">
        <small>
          Emergency CRM Field Operations Dashboard | © 2024 | Mock Data Service
        </small>
      </div>
    </div>
  );
}
