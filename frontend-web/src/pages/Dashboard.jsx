import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatTime } from '../utils/time.js';
import { useDashboardStore } from '../store/dashboard.js';
import { getSortedAvailableUnits } from '../utils/units.js';
import { RealtimeService } from '../services/realtime.js';
import { KPICards } from '../components/KPICards.jsx';
import { FilterBar } from '../components/FilterBar.jsx';
import { IncidentList } from '../components/IncidentList.jsx';
import { MapView } from '../components/MapView.jsx';
import { IncidentDetailsPanel } from '../components/IncidentDetailsPanel.jsx';
import { EventFeed } from '../components/EventFeed.jsx';
import * as api from '../api/client.js';

// Field Command creation modal — mandatory incident-classification dropdown.
// "Other" reveals a required free-text field; the typed value is submitted
// as incident_type, never the literal string "Other" (see
// handleCreateFieldSubmit).
const FIELD_INCIDENT_TYPES = [
  'Hazmat',
  'Earthquake',
  'Shooting',
  'Tsunami',
  'Terror Attack',
  'Wildfire',
  'Mass Casualty',
  'Other',
];

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
    fieldCommands,
    setFieldCommands,
    upsertFieldCommand,
    activeFilter: storedActiveFilter,
    setActiveFilter: storeSetActiveFilter,
    zoomToIncidentId,
    clearZoomToIncident,
    setFlashingIncident,
    clearFlashingIncident,
  } = useDashboardStore();

  const [isLoading, setIsLoading] = useState(true);
  // A ref, not state: the effect's cleanup below needs to read whichever
  // connection was most recently assigned at the moment cleanup actually
  // runs, not whatever `realtimeService` happened to be at the time the
  // effect body itself last executed (state read via closure would be
  // stale here, since the connection isn't created until deep inside an
  // async initializeData() call — a plain useState value captured by the
  // effect's own closure would still be the initial `null` when cleanup
  // fires).
  const realtimeServiceRef = useRef(null);
  const [showEventFeed, setShowEventFeed] = useState(false);
  // activeFilter is persisted in the store so it survives page refresh
  const activeFilter = storedActiveFilter;
  const setActiveFilter = storeSetActiveFilter;
  const [activeFieldId, setActiveFieldId] = useState('');
  const [activeFieldName, setActiveFieldName] = useState('');
  const [selectedFieldCommand, setSelectedFieldCommand] = useState(null);
  const [fieldCommandSummary, setFieldCommandSummary] = useState(null);
  const [fieldCommandLoading, setFieldCommandLoading] = useState(false);
  const [fieldCommandError, setFieldCommandError] = useState('');
  const [isCreateFieldOpen, setIsCreateFieldOpen] = useState(false);
  const [createFieldLocation, setCreateFieldLocation] = useState(null);
  const [createFieldForm, setCreateFieldForm] = useState({
    name: '',
    incidentType: '',
    incidentTypeOther: '',
    selectedUnitIds: [],
    notes: '',
    incidentPhase: 'Containment',
  });
  const [showCreateFieldAdvanced, setShowCreateFieldAdvanced] = useState(false);
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

  // Field Command creation modal's unit checklist: any available unit
  // (no agency-type filter, unlike MapView's Dispatch modal), sorted
  // nearest-first to the right-clicked point. getSortedAvailableUnits
  // already excludes units already attached to a FieldCommand.
  const sortedAvailableFieldUnits = useMemo(
    () => getSortedAvailableUnits(activeUnits, createFieldLocation, null),
    [activeUnits, createFieldLocation],
  );

  // Field Command Overview's "Assign Global Forces" list: previously just
  // `units.filter(u => !u.field_id)` with no is_online/EN_ROUTE/ON_SCENE
  // check at all — unlike every other "available units" surface in the
  // app. FieldCommandSerializer (backend/api/serializers.py) exposes
  // location_lat/location_lng directly (no source= remapping), and
  // selectedFieldCommand carries the same shape as the list endpoint, so
  // it's available immediately with no loading-race gap. Sorted
  // nearest-first as a consequence of using the shared helper.
  const sortedAssignableUnits = useMemo(
    () => getSortedAvailableUnits(
      units,
      selectedFieldCommand
        ? { lat: selectedFieldCommand.location_lat, lng: selectedFieldCommand.location_lng }
        : null,
      null,
    ),
    [units, selectedFieldCommand],
  );

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

  const handleToggleCreateFieldUnit = (unitId) => {
    setCreateFieldForm((prev) => ({
      ...prev,
      selectedUnitIds: prev.selectedUnitIds.includes(unitId)
        ? prev.selectedUnitIds.filter((id) => id !== unitId)
        : [...prev.selectedUnitIds, unitId],
    }));
  };

  const resetCreateFieldForm = () => {
    setCreateFieldForm({
      name: '',
      incidentType: '',
      incidentTypeOther: '',
      selectedUnitIds: [],
      notes: '',
      incidentPhase: 'Containment',
    });
    setShowCreateFieldAdvanced(false);
    setCreateFieldLocation(null);
  };

  const handleCreateFieldSubmit = async (event) => {
    event.preventDefault();
    if (!createFieldLocation) return;

    const trimmedName = createFieldForm.name.trim();
    const resolvedIncidentType = createFieldForm.incidentType === 'Other'
      ? createFieldForm.incidentTypeOther.trim()
      : createFieldForm.incidentType;
    // Backstop only — the name input and the type dropdown/Other field
    // already carry `required`, so this shouldn't normally fire.
    if (!trimmedName || !resolvedIncidentType) return;

    setFieldCommandLoading(true);
    setFieldCommandError('');

    // unit_name is still required by the backend serializer even though the
    // modal no longer collects it directly — derive a readable summary from
    // the checklist instead. Zero units selected is allowed (a post can be
    // staffed later via the existing assign-unit flow), rendered as
    // "Unassigned".
    const selectedUnits = sortedAvailableFieldUnits.filter((u) => createFieldForm.selectedUnitIds.includes(u.id));
    const unitNames = selectedUnits.map((u) => u.name || `Unit #${u.id}`);
    const unitNameSummary = unitNames.length === 0
      ? 'Unassigned'
      : unitNames.length <= 4
        ? unitNames.join(', ')
        : `${unitNames.slice(0, 3).join(', ')} +${unitNames.length - 3} more`;

    try {
      const payload = {
        name: trimmedName,
        unit_name: unitNameSummary,
        incident_type: resolvedIncidentType,
        note: createFieldForm.notes,
        incident_phase: createFieldForm.incidentPhase,
        location_lat: createFieldLocation.lat,
        location_lng: createFieldLocation.lng,
      };
      // FieldCommandSerializer's "id" is the field_key (see
      // FieldCommandViewSet.perform_create) — the create response already
      // carries it, so assign-unit calls below can fire immediately with no
      // re-fetch.
      const created = await api.createFieldCommand(payload);

      const failedUnitNames = [];
      for (const unitId of createFieldForm.selectedUnitIds) {
        try {
          await api.assignUnitToField(created.id, unitId);
        } catch (assignError) {
          console.error(`Failed to assign unit ${unitId} to new field command ${created.id}:`, assignError);
          const unit = selectedUnits.find((u) => u.id === unitId);
          failedUnitNames.push(unit?.name || `Unit #${unitId}`);
        }
      }

      const [realUnits] = await Promise.all([api.getRealUnits(), refreshFieldCommands()]);
      setOnlineUnits(realUnits || []);
      if (created?.id) {
        await handleFieldCommandSelect(created);
      }
      setIsCreateFieldOpen(false);
      resetCreateFieldForm();

      if (failedUnitNames.length > 0) {
        setFieldCommandError(`Field command created, but failed to assign: ${failedUnitNames.join(', ')}.`);
      }
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
    // React.StrictMode (main.jsx) intentionally runs this effect
    // mount->cleanup->mount once in dev. The first pass's cleanup fires
    // synchronously, before its own initializeData() has gotten anywhere
    // near the `await Promise.all(...)` below, let alone the realtime
    // connect() call — so a ref alone doesn't stop the first pass's async
    // work from eventually opening its own SSE connection too. This flag
    // lets each pass's own async closure recognize it's been cleaned up
    // and bail out before ever calling connect(), so only the surviving
    // (second) pass ends up with a live connection.
    let cancelled = false;
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

        // This pass was already cleaned up (StrictMode's synthetic first
        // pass, or a genuine unmount) while the fetches above were in
        // flight — don't open a connection nobody will ever close.
        if (cancelled) return;

        // Connect to realtime updates.
        // Every real broadcast from the backend arrives as a flat payload
        // with type: 'user_action' and an 'action' sub-field (see
        // api/views.py::_broadcast_realtime call sites) — there is no bare
        // update.type === 'incident_created'/'incident_updated'/
        // 'unit_updated' shape broadcast anywhere by the real backend
        // (those only ever existed in backend/simulated/mock_data.py, a
        // different, unrelated stream this dashboard isn't connected to).
        // The branches below were previously dead for exactly that reason
        // and have been removed rather than fixed to match a shape nothing
        // sends.
        const realtime = new RealtimeService(
          (update) => {
            if (update.type === 'connected') {
              console.log('Connected to real-time updates');
              setConnectionStatus('CONNECTED');
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
            } else if (update.type === 'user_action' && update.action === 'incident_status_update') {
              updateIncident(update.incident_id, { status: update.new_status });
            } else if (update.type === 'user_action' && update.action === 'incident_created') {
              // update itself is the full IncidentSerializer shape (see
              // IncidentViewSet.perform_create) — safe to insert as-is.
              addIncident(update);
              addEvent({
                id: Math.random(),
                timestamp: new Date().toISOString(),
                entity_type: 'incident',
                entity_id: update.id,
                message: `New incident: ${update.title}`,
                level: 'warn',
              });
            } else if (update.type === 'user_action' && (
              update.action === 'field_command_created' ||
              update.action === 'field_command_closed' ||
              update.action === 'field_command_unit_assigned' ||
              update.action === 'field_command_incident_assigned'
            )) {
              // update itself is the full FieldCommandSerializer shape (see
              // FieldCommandViewSet's perform_create/assign_unit/
              // assign_incident/close) — safe to merge as-is. A closed
              // entry isn't evicted here; MapView.jsx's field-command
              // marker loop and DashboardSelector.jsx already filter out
              // status === 'CLOSED' client-side, so merging the new status
              // in is sufficient to hide it everywhere that matters.
              upsertFieldCommand(update);
            } else if (update.type === 'user_action' && (
              update.action === 'task_status_update' ||
              update.action === 'incident_unit_assigned'
            )) {
              // Known gap, not silently dropped: this dashboard holds no
              // standalone Task state (useDashboardStore has no `tasks`
              // array/updateTask action) — the only task-derived data an
              // Incident carries is its serializer-computed
              // assigned_unit_ids, which these two events would affect but
              // which this handler has no accurate way to recompute
              // without re-fetching the incident. Logged so the gap is
              // visible rather than invisible; not wired to any store
              // mutation this stage.
              console.log(`[Realtime] ${update.action} received but not yet consumed (no task state on this dashboard):`, update);
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
        realtimeServiceRef.current = realtime;
      } catch (error) {
        console.error('Failed to initialize dashboard:', error);
        setConnectionStatus('OFFLINE');
        setIsLoading(false);
      }
    };

    initializeData();

    return () => {
      cancelled = true;
      realtimeServiceRef.current?.disconnect();
      realtimeServiceRef.current = null;
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
          realtimeServiceRef.current = realtime;
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
                    {/* Closed incidents are never linkable — they're done,
                        not a target for further field-command coordination. */}
                    {Array.isArray(incidents) && incidents.filter((inc) => !inc.field_command && inc.status !== 'CLOSED').length ? (
                      <div style={{ maxHeight: '140px', overflowY: 'auto' }}>
                        {incidents.filter((inc) => !inc.field_command && inc.status !== 'CLOSED').slice(0, 10).map((inc) => (
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
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px' }}>Assign Global Forces (nearest first)</div>
                  {sortedAssignableUnits.length ? (
                    <div style={{ maxHeight: '140px', overflowY: 'auto' }}>
                      {sortedAssignableUnits.slice(0, 10).map((unit) => (
                        <div key={unit.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <span style={{ fontSize: '0.8rem' }}>
                            {unit.name || `Unit ${unit.id}`} ({Number.isFinite(unit.distanceKm) ? `${unit.distanceKm.toFixed(1)} km` : 'No GPS'})
                          </span>
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
              width: '420px',
              maxHeight: '85vh',
              overflowY: 'auto',
              color: '#e2e8f0',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>🏢 Open Field Command Post</h3>
            <form onSubmit={handleCreateFieldSubmit}>
              <label style={{ fontSize: '0.8rem' }}>Command Name</label>
              <input
                type="text"
                value={createFieldForm.name}
                onChange={(e) => handleCreateFieldChange('name', e.target.value)}
                style={{ width: '100%', margin: '6px 0 10px', padding: '6px', borderRadius: '6px' }}
                placeholder="Field Command Post Alpha"
                required
              />

              <label style={{ fontSize: '0.8rem' }}>Incident Type</label>
              <select
                value={createFieldForm.incidentType}
                onChange={(e) => handleCreateFieldChange('incidentType', e.target.value)}
                style={{ width: '100%', margin: '6px 0 10px', padding: '6px', borderRadius: '6px' }}
                required
              >
                <option value="" disabled>-- Select Type --</option>
                {FIELD_INCIDENT_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>

              {createFieldForm.incidentType === 'Other' && (
                <input
                  type="text"
                  value={createFieldForm.incidentTypeOther}
                  onChange={(e) => handleCreateFieldChange('incidentTypeOther', e.target.value)}
                  style={{ width: '100%', margin: '0 0 10px', padding: '6px', borderRadius: '6px' }}
                  placeholder="Specify incident type"
                  required
                />
              )}

              <label style={{ fontSize: '0.8rem' }}>Units (nearest first)</label>
              <div
                style={{
                  maxHeight: '160px',
                  overflowY: 'auto',
                  margin: '6px 0 10px',
                  padding: '6px',
                  borderRadius: '6px',
                  border: '1px solid #334155',
                  background: '#111827',
                }}
              >
                {sortedAvailableFieldUnits.length === 0 && (
                  <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                    No available units found near this location.
                  </div>
                )}
                {sortedAvailableFieldUnits.map((u) => (
                  <label
                    key={u.id}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', padding: '3px 0', cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={createFieldForm.selectedUnitIds.includes(u.id)}
                      onChange={() => handleToggleCreateFieldUnit(u.id)}
                    />
                    {u.name || `Unit #${u.id}`} ({Number.isFinite(u.distanceKm) ? `${u.distanceKm.toFixed(1)} km` : 'No GPS'})
                  </label>
                ))}
              </div>

              <button
                type="button"
                className="feed-toggle"
                onClick={() => setShowCreateFieldAdvanced((prev) => !prev)}
                style={{ marginBottom: '10px' }}
              >
                {showCreateFieldAdvanced ? '▾ Optional Details' : '▸ Optional Details'}
              </button>

              {showCreateFieldAdvanced && (
                <>
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
                </>
              )}

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
