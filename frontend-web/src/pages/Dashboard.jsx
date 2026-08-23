import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatTime } from '../utils/time.js';
import { useDashboardStore } from '../store/dashboard.js';
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
 * Always real, backend-sourced operational data. No dependency on the
 * field-incident/simulation store — training drills are launched and run
 * exclusively from the Field Incident Command Dashboard.
 */
export default function Dashboard() {
  const navigate = useNavigate();

  const {
    setIncidents,
    setUnits,
    setOnlineUnits,
    upsertOnlineUnit,
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
    onlineUnits,
    activeFilter: storedActiveFilter,
    setActiveFilter: storeSetActiveFilter,
    zoomToIncidentId,
    clearZoomToIncident,
    setFlashingIncident,
    clearFlashingIncident,
  } = useDashboardStore();

  const [isLoading, setIsLoading] = useState(true);
  const [realtimeService, setRealtimeService] = useState(null);
  const [showEventFeed, setShowEventFeed] = useState(false);
  // activeFilter is persisted in the store so it survives page refresh
  const activeFilter = storedActiveFilter;
  const setActiveFilter = storeSetActiveFilter;
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
    incidentPhase: 'Containment',
  });
  const [closeFieldReason, setCloseFieldReason] = useState('');
  const [closeFieldRole, setCloseFieldRole] = useState('COMMAND_CENTER');

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

  // Always real, actively-connected units. onlineUnits (destructured above)
  // comes from GET /api/units/, the real Unit model — see
  // final changes/04_disable_frontend_map_simulation.md and
  // final changes/05_user_unit_claiming_and_live_sync.md.
  const activeUnits = Array.isArray(onlineUnits) ? onlineUnits.filter((u) => u.is_online === true) : [];
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

  const refreshFieldCommands = async () => {
    const fields = await api.getFieldCommands();
    setFieldCommands(fields || []);
  };

  const handleFieldCommandSelect = async (field) => {
    if (!field?.id) return;
    setSelectedFieldCommand(field);
    setCloseFieldReason('');
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

  // MapView's "Report Standard Incident" context-menu action already collects
  // and submits the full form itself — this just persists it to the real DB
  // and updates the store directly so the marker appears immediately, rather
  // than waiting on the SSE round-trip.
  const handleMapReportIncident = async (payload) => {
    try {
      const created = await api.createIncident({
        title: payload.title,
        description: payload.description,
        location_lat: payload.lat,
        location_lng: payload.lng,
        priority: payload.priority,
        channel: payload.type,
      });
      addIncident(created);
      addEvent({
        id: Math.random(),
        timestamp: new Date().toISOString(),
        entity_type: 'incident',
        entity_id: created.id,
        message: `New incident reported: ${created.title}`,
        level: 'warn',
      });
    } catch (error) {
      console.error('Failed to report incident:', error);
    }
  };

  // MapView's "Dispatch Force to Point" isn't tied to an existing incident —
  // it dispatches a real, currently-online unit (payload.unitId is a real
  // Unit PK, sourced from onlineUnits) straight to an arbitrary point. There's
  // no "assign unit to raw coordinates" primitive in the real API, so this
  // creates a minimal incident at that point and then assigns the unit to it
  // via the same real endpoints IncidentDetailsPanel/MapView already rely on.
  const handleMapDispatchForce = async (payload) => {
    try {
      const created = await api.createIncident({
        title: `${payload.agency} Dispatch`,
        description: 'Force dispatched directly from the map.',
        location_lat: payload.lat,
        location_lng: payload.lng,
        priority: 'HIGH',
        channel: payload.agency,
      });
      addIncident(created);
      const updated = await api.assignUnitToIncident(created.id, payload.unitId);
      updateIncident(created.id, updated);
      addEvent({
        id: Math.random(),
        timestamp: new Date().toISOString(),
        entity_type: 'incident',
        entity_id: created.id,
        message: `Unit dispatched to point: ${created.title}`,
        level: 'warn',
      });
    } catch (error) {
      console.error('Failed to dispatch force:', error);
    }
  };

  const handleCreateFieldChange = (field, value) => {
    setCreateFieldForm((prev) => ({ ...prev, [field]: value }));
  };

  const resetCreateFieldForm = () => {
    setCreateFieldForm({
      unitName: '',
      incidentType: '',
      notes: '',
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
        note: createFieldForm.notes,
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
    const reason = closeFieldReason.trim();
    if (!selectedFieldCommand?.id || !reason) return;
    setFieldCommandLoading(true);
    setFieldCommandError('');
    try {
      await api.closeFieldCommand(selectedFieldCommand.id, reason, closeFieldRole);
      setSelectedFieldCommand(null);
      setFieldCommandSummary(null);
      setCloseFieldReason('');
      await refreshFieldCommands();
    } catch (error) {
      console.error('Failed to close field command:', error);
      setFieldCommandError('Failed to close the field command.');
    } finally {
      setFieldCommandLoading(false);
    }
  };

  const handleAssignIncidentToField = async (incidentId) => {
    if (!selectedFieldCommand?.id || !incidentId) return;
    setFieldCommandLoading(true);
    setFieldCommandError('');
    try {
      await api.assignIncidentToField(selectedFieldCommand.id, incidentId);
      const updatedSummary = await api.getFieldCommand(selectedFieldCommand.id);
      setFieldCommandSummary(updatedSummary);
      await refreshFieldCommands();
    } catch (error) {
      console.error('Failed to link incident to field command:', error);
      setFieldCommandError('Failed to link incident.');
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


  // Initialize data and realtime connection
  useEffect(() => {
    const initializeData = async () => {
      try {
        setConnectionStatus('CONNECTING');

        // Fetch initial data
        const [incidents, units, realUnits, events] = await Promise.all([
          api.getIncidents(),
          api.getUnits(),
          api.getRealUnits(),
          api.getEvents(200),
        ]);

        setIncidents(incidents);
        setUnits(units);
        setOnlineUnits(realUnits);
        setEvents(events);
        try {
          await refreshFieldCommands();
        } catch (error) {
          console.warn('Failed to load field commands:', error);
        }

        // 'ecm-dispatch-assignments' (sessionStorage) is written only by the
        // field store's dispatchUnitsToIncident()/cancelUnitDispatch() — the
        // old fake-dispatch mechanism still used by the SIMULATION drill —
        // never by the real dispatch flow (IncidentDetailsPanel.jsx's
        // handleDispatch). There was nothing real to restore from it here;
        // not read anymore. Left untouched (not cleared) since a drill may
        // legitimately still be using it.
        localStorage.removeItem('ecm-dispatch-assignments');

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
            } else if (update.type === 'user_action' && (
              update.action === 'unit_claimed' ||
              update.action === 'unit_location_update' ||
              update.action === 'unit_heartbeat' ||
              update.action === 'unit_disconnected'
            )) {
              // Live GPS/online-status push from a claimed unit's heartbeat,
              // claim, or disconnect — see api/views.py::_broadcast_realtime
              // calls in UnitViewSet/unit_heartbeat and
              // final changes/05_user_unit_claiming_and_live_sync.md.
              upsertOnlineUnit({
                id: update.unit_id,
                name: update.unit_name,
                ...(update.location_lat != null && update.location_lng != null
                  ? { location_lat: update.location_lat, location_lng: update.location_lng }
                  : {}),
                is_online: update.action !== 'unit_disconnected',
              });
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
        const [incidents, units, realUnits, events] = await Promise.all([
          api.getIncidents(),
          api.getUnits(),
          api.getRealUnits(),
          api.getEvents(200),
        ]);
        setIncidents(incidents);
        setUnits(units);
        setOnlineUnits(realUnits);
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
        <KPICards />
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
          />
        </div>

        {/* Center: Map */}
        <div className="content-center">
          <MapView
            activeFilter={activeFilter}
            selectedUnitIds={selectedUnitIds}
            fieldCommands={fieldCommands}
            selectedFieldCommandId={selectedFieldCommand?.id || null}
            onFieldCommandSelect={handleFieldCommandSelect}
            onMapCreateFieldCommand={handleMapCreateFieldCommand}
            onMapReportIncident={handleMapReportIncident}
            onMapDispatchForce={handleMapDispatchForce}
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

                    <div style={{ marginTop: '12px' }}>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px' }}>Close Field Command Post</div>
                      <textarea
                        value={closeFieldReason}
                        onChange={(e) => setCloseFieldReason(e.target.value)}
                        placeholder="Closure reason (required)..."
                        rows={2}
                        style={{
                          width: '100%',
                          background: '#0f172a',
                          border: '1px solid #334155',
                          borderRadius: '6px',
                          color: '#e2e8f0',
                          fontSize: '0.8rem',
                          padding: '6px 8px',
                          resize: 'vertical',
                          marginBottom: '6px',
                        }}
                      />
                      <select
                        value={closeFieldRole}
                        onChange={(e) => setCloseFieldRole(e.target.value)}
                        style={{ width: '100%', padding: '5px', borderRadius: '6px', marginBottom: '8px', fontSize: '0.78rem' }}
                      >
                        <option value="COMMAND_CENTER">Closed by: Command Center</option>
                        <option value="FIELD_OPERATOR">Closed by: Field Operator</option>
                      </select>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="feed-toggle"
                          onClick={handleCloseFieldCommand}
                          disabled={fieldCommandLoading || !closeFieldReason.trim()}
                          style={{
                            backgroundColor: '#ef4444',
                            borderColor: '#ef4444',
                            fontSize: '0.8rem',
                            padding: '0.5rem 0.75rem',
                            opacity: !closeFieldReason.trim() ? 0.6 : 1,
                            cursor: !closeFieldReason.trim() ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Close Camp
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {selectedFieldCommand && (
                  <div style={{ marginTop: '12px' }}>
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px' }}>Link Incident</div>
                    {Array.isArray(incidents) && incidents.filter((inc) => !inc.field_command).length ? (
                      <div style={{ maxHeight: '140px', overflowY: 'auto' }}>
                        {incidents.filter((inc) => !inc.field_command).slice(0, 10).map((inc) => (
                          <div key={inc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <span style={{ fontSize: '0.8rem' }}>{inc.title || `Incident ${inc.id}`}</span>
                            <button
                              className="feed-toggle"
                              style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
                              onClick={() => handleAssignIncidentToField(inc.id)}
                            >
                              Link
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>No unlinked incidents</div>
                    )}
                  </div>
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
