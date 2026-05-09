import React, { useEffect, useState } from 'react';
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
    units,
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
    setIncidents: setFieldIncidents,
    incidents: fieldIncidents, // Add this to get incidents from fieldIncidentStore
    setLiveIncident,
    setMode: setFieldMode,
  } = useFieldIncidentStore();

  const { selectedUnitIds } = useDashboardStore();

  const [isLoading, setIsLoading] = useState(true);
  const [realtimeService, setRealtimeService] = useState(null);
  const [showEventFeed, setShowEventFeed] = useState(false);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [lastSyncedFieldIncidentsCount, setLastSyncedFieldIncidentsCount] = useState(0);
  const [selectedScenario, setSelectedScenario] = useState('FIRE');
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

  // Simulation override detection
  const isSimulation = fieldMode === 'SIMULATION';

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

  // Sync dashboard incidents to field incident store (one-time on load)
  useEffect(() => {
    if (Array.isArray(incidents) && incidents.length > 0 && fieldIncidents.length === 0) {
      console.log('📍 Initial sync of', incidents.length, 'incidents to fieldIncident store');
      setFieldIncidents(incidents);
    }
  }, [incidents, setFieldIncidents, fieldIncidents.length]);

  // Sync NEW field incidents back to dashboard (for routine events)
  useEffect(() => {
    if (Array.isArray(fieldIncidents) && fieldIncidents.length > lastSyncedFieldIncidentsCount) {
      console.log('🔄 New field incidents detected:', fieldIncidents.length, 'vs', lastSyncedFieldIncidentsCount);
      setIncidents(fieldIncidents);
      setLastSyncedFieldIncidentsCount(fieldIncidents.length);
    }
  }, [fieldIncidents, setIncidents, lastSyncedFieldIncidentsCount]);

  // Link field dashboard to selected incident in regional dashboard
  useEffect(() => {
    if (fieldMode === 'SIMULATION') return;
    if (!selectedIncidentId) return;

    const selected = (incidents || []).find((inc) => inc.id === selectedIncidentId);
    if (!selected) return;

    setFieldMode && setFieldMode('LIVE');
    setLiveIncident && setLiveIncident(selected);
  }, [selectedIncidentId, incidents, setLiveIncident, setFieldMode, fieldMode]);

  // Sync simulation events to war-room when active
  useEffect(() => {
    if (isSimulation && fieldTimeline) {
      // Convert field timeline events to dashboard event format
      const convertedEvents = fieldTimeline.map((evt, idx) => ({
        id: evt.id ? `sim-${evt.id}` : `sim-${idx}`,
        timestamp: evt.timestamp || new Date().toISOString(),
        entity_type: 'simulation',
        entity_id: majorIncident?.id || 'sim',
        message: evt.title || evt.message || 'Simulation event',
        level: evt.severity === 'CRITICAL' ? 'error' :
          evt.severity === 'HIGH' ? 'warn' : 'info',
      }));

      const nonSimulationEvents = (events || []).filter((e) =>
        e?.entity_type !== 'simulation' && !String(e?.id || '').startsWith('sim-')
      );

      setEvents([...convertedEvents, ...nonSimulationEvents]);
    }
  }, [isSimulation, fieldTimeline, majorIncident, setEvents, events]);

  // Initialize data and realtime connection
  useEffect(() => {
    const initializeData = async () => {
      try {
        setConnectionStatus('CONNECTING');

        // Fetch initial data
        const [incidents, units, events] = await Promise.all([
          api.getIncidents(),
          api.getUnits(),
          api.getEvents(100),
        ]);

        setIncidents(incidents);
        setUnits(units);
        setEvents(events);
        try {
          await refreshFieldCommands();
        } catch (error) {
          console.warn('Failed to load field commands:', error);
        }

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
            setConnectionStatus('DEGRADED');
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

  // Fallback polling if realtime fails
  useEffect(() => {
    if (connectionStatus !== 'DEGRADED') return;

    const interval = setInterval(async () => {
      try {
        const incidents = await api.getIncidents();
        setIncidents(incidents);
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [connectionStatus]);

  // Unit movement loop - runs continuously to move units along their routes
  useEffect(() => {
    const movementInterval = setInterval(() => {
      const { moveUnits: latestMoveUnits, tickRoutinePatrol: latestTickPatrol, mode } = useFieldIncidentStore.getState();

      // First tick routine patrol (for patrol units)
      if (mode === 'ROUTINE' && latestTickPatrol) {
        latestTickPatrol();
      }

      // Then move units along routes (for dispatched units)
      if (latestMoveUnits) {
        latestMoveUnits();
      }
    }, 500); // Run every 500ms for realistic movement speed

    return () => {
      clearInterval(movementInterval);
    };
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
        <div className="topbar-left">
          <h1>🎯 Field War-Room Dashboard</h1>
        </div>
        <div className="topbar-center">
          {lastUpdateTime && (
            <small>Last update: {lastUpdateTime.toLocaleTimeString()}</small>
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
                Select a field command marker on the map to view assignments.
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
                  onClick={() => {
                    setIsCreateFieldOpen(false);
                    resetCreateFieldForm();
                  }}
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
