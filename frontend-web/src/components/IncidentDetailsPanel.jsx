import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { EventFeed } from './EventFeed.jsx';
import { SidePanel } from './SidePanel.jsx';
import { Shield, Flame, Ambulance, MapPin, AlertTriangle, ChevronRight } from 'lucide-react';
import { useDashboardStore } from '../store/dashboard.js';
import { nearestCityName } from '../utils/israelGeo.js';
import { calculateDistanceKm } from '../utils/units.js';
import { getUnitTypeMeta } from '../utils/agencyMeta.js';
import {
  updateIncidentStatus,
  assignUnitToIncident,
  unassignUnitFromIncident,
  assignIncidentToField,
  unassignIncidentFromField,
  createFieldMission,
} from '../api/client.js';

// The three agencies a task can be assigned to. force_type is POLICE/FIRE/
// MEDICAL; agencyMeta keys on the raw Unit.type where "medical" is "EMS", so
// map it through for the icon/color lookup.
const FORCE_OPTIONS = ['POLICE', 'FIRE', 'MEDICAL'];
const forceLabel = (f) => (f === 'MEDICAL' ? 'Medical' : f.charAt(0) + f.slice(1).toLowerCase());
const forceMeta = (f) => getUnitTypeMeta({ type: f === 'MEDICAL' ? 'EMS' : f });

const TASK_STATUS_META = {
  OPEN: { label: 'Open', color: '#f59e0b' },
  IN_PROGRESS: { label: 'On it', color: '#3b82f6' },
  DONE: { label: 'Done', color: '#10b981' },
};

// Same inline-form look as MapView.jsx's operator action menu (labelStyle/
// inputStyle/actionsRowStyle/*ButtonStyle) — duplicated here rather than
// imported since those are unexported module-scoped consts in a file this
// stage is explicitly not allowed to touch (the right-click context menu).
const labelStyle = { fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginTop: '10px' };
const inputStyle = {
  width: '100%',
  padding: '7px',
  margin: '6px 0',
  background: '#1e293b',
  color: '#fff',
  border: '1px solid #475569',
  borderRadius: '6px',
  boxSizing: 'border-box',
};
const submitButtonStyle = {
  width: '100%',
  border: 'none',
  color: '#fff',
  padding: '8px',
  borderRadius: '6px',
  cursor: 'pointer',
  fontWeight: 'bold',
  fontSize: '0.82rem',
  marginTop: '10px',
};

const TYPE_META = {
  POLICE: { label: 'Police', color: '#3b82f6', Icon: Shield },
  FIRE: { label: 'Fire', color: '#ef4444', Icon: Flame },
  MEDICAL: { label: 'Medical', color: '#f8fafc', Icon: Ambulance },
};

const TYPE_ORDER = ['POLICE', 'FIRE', 'MEDICAL'];

// Real backend Unit.type is Police/Fire/EMS/HomeFront; this panel's
// filter tabs and TYPE_META use the POLICE/FIRE/MEDICAL scheme already
// established by the mobile/dispatch bridge's normalize_unit_type(). This
// only affects local display/filtering — the original type string is what
// gets sent to the dispatch bridge.
const normalizeUnitType = (type) => {
  const t = (type || '').toUpperCase();
  if (t === 'EMS' || t === 'AMBULANCE' || t === 'MEDICAL') return 'MEDICAL';
  if (t === 'FIRE') return 'FIRE';
  if (t === 'POLICE') return 'POLICE';
  return 'POLICE';
};

export function IncidentDetailsPanel({ onGoLiveCreateFieldCommand, onSelectFieldCommand } = {}) {
  const navigate = useNavigate();
  const {
    incidents: dashboardIncidents,
    onlineUnits,
    upsertOnlineUnit,
    selectedIncidentId,
    setSelectedIncident,
    updateIncident,
    selectedUnitIds,
    setSelectedUnitIds,
    setZoomToIncident,
    setFlashingIncident,
    clearFlashingIncident,
    fieldCommands,
    upsertFieldCommand,
  } = useDashboardStore();

  const [fcActionBusy, setFcActionBusy] = useState(false);
  const [relinkFieldId, setRelinkFieldId] = useState('');

  // Regional dashboard: the selected incident always comes from the real,
  // DB-backed incidents list — no field-incident/simulation store involved.
  const incident = useMemo(() => {
    if (!selectedIncidentId) return null;
    return Array.isArray(dashboardIncidents)
      ? dashboardIncidents.find(i => i.id === selectedIncidentId)
      : null;
  }, [selectedIncidentId, dashboardIncidents]);

  const [selectedType, setSelectedType] = useState('POLICE');
  const [activeTab, setActiveTab] = useState('dispatch');
  const [closeReason, setCloseReason] = useState('');
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState('');

  // ── Tasks tab (force-typed taskings on this incident) ──
  const [taskForm, setTaskForm] = useState({ title: '', force_type: '' });
  const [addingTask, setAddingTask] = useState(false);
  const [taskError, setTaskError] = useState('');

  // Reset to dispatch tab whenever a different incident is opened
  useEffect(() => {
    setActiveTab('dispatch');
    setCloseReason('');
    setCloseError('');
    setTaskForm({ title: '', force_type: '' });
    setTaskError('');
  }, [incident?.id]);

  // Escape closes the panel — same dismiss path as the X button
  // (handleClose below just calls setSelectedIncident(null)). Only
  // attached while an incident is actually selected, so this listener
  // doesn't exist at all — and can't interfere with Escape in an
  // unrelated input elsewhere in the app — when the panel isn't open.
  useEffect(() => {
    if (!incident) return;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setSelectedIncident(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [incident?.id, setSelectedIncident]);

  const canClose = incident?.status && incident.status !== 'CLOSED';

  const handleCloseIncident = async () => {
    const reason = closeReason.trim();
    if (!incident?.id || !reason) return;
    setClosing(true);
    setCloseError('');
    try {
      const updated = await updateIncidentStatus(incident.id, 'CLOSED', reason, 'COMMAND_CENTER');
      updateIncident(incident.id, {
        status: 'CLOSED',
        closed_reason: updated?.closed_reason ?? reason,
        closed_by_role: updated?.closed_by_role ?? 'COMMAND_CENTER',
        closed_at: updated?.closed_at ?? new Date().toISOString(),
      });
      setCloseReason('');
    } catch (error) {
      console.error('Failed to close incident:', error);
      setCloseError(error?.response?.data?.closed_reason?.[0]
        || error?.response?.data?.status?.[0]
        || 'Failed to close incident.');
    } finally {
      setClosing(false);
    }
  };

  // Real "go live" flow. Liveness comes from the real Incident/MajorIncident
  // API data, never client state: incident.major_incident is populated by
  // IncidentSerializer (backend/api/serializers.py) straight off the DB, so
  // it's correct even on first load / after a page refresh — unlike the old
  // shared-store majorIncident slot, which reset to null on reload and had
  // no way to know a re-selected incident was already live.
  const [liveMajorIncident, setLiveMajorIncident] = useState(null);
  const liveMajorIncidentId = liveMajorIncident?.id ?? incident?.major_incident?.id ?? null;
  const isLive = !!liveMajorIncidentId;

  const [goLiveType, setGoLiveType] = useState('EARTHQUAKE');
  const [goingLive, setGoingLive] = useState(false);
  const [goLiveError, setGoLiveError] = useState('');

  // Reset major-incident form state whenever a different incident is opened
  useEffect(() => {
    setLiveMajorIncident(null);
    setGoLiveType('EARTHQUAKE');
    setGoLiveError('');
  }, [incident?.id]);

  // Pulls the first validation message out of a DRF error response,
  // regardless of which field it landed on (detail / incident_id /
  // incident_type / submitted_by_role / etc.) — mirrors the pattern
  // handleCloseIncident above already uses for closed_reason/status.
  const extractApiError = (error, fallback) => {
    const data = error?.response?.data;
    if (!data) return fallback;
    const firstValue = Object.values(data)[0];
    if (Array.isArray(firstValue)) return firstValue[0];
    if (typeof firstValue === 'string') return firstValue;
    return fallback;
  };

  const handleGoLive = () => {
    if (!incident?.id) return;
    setGoLiveError('');
    // Nothing is created yet. "Go Live" only opens the Create Field Command
    // modal — the MajorIncident is declared by Dashboard.handleCreateFieldSubmit
    // only if the operator actually clicks Create there. Cancelling leaves the
    // incident exactly as it was (no orphaned major incident / field HQ).
    onGoLiveCreateFieldCommand?.({
      lat: incident.location_lat,
      lng: incident.location_lng,
      incidentId: incident.id,
      goLiveType,
      incidentType: goLiveType,
      title: incident.title,
    });
  };

  const handlePriorityChange = (newPriority) => {
    if (incident && incident.id) {
      updateIncident(incident.id, { priority: newPriority });
    }
  };

  // ── Tasks: force-typed taskings that belong to this incident, carried on
  // the linked Field Command post. Every mobile crew of the chosen force
  // dispatched to this incident sees the task and can advance its status.
  const fieldKey = incident?.field_command_key || incident?.field_command || null;
  const incidentTasks = useMemo(() => {
    if (!incident?.id || !fieldKey) return [];
    const fc = (Array.isArray(fieldCommands) ? fieldCommands : [])
      .find((f) => String(f.id) === String(fieldKey));
    return (fc?.missions || []).filter((m) => m.incident === incident.id);
  }, [incident?.id, fieldKey, fieldCommands]);

  const tasksByForce = useMemo(() => {
    const grouped = { POLICE: [], FIRE: [], MEDICAL: [], OTHER: [] };
    incidentTasks.forEach((t) => (grouped[t.force_type] || grouped.OTHER).push(t));
    return grouped;
  }, [incidentTasks]);

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!incident?.id || !fieldKey || !taskForm.title.trim() || !taskForm.force_type) return;
    setAddingTask(true);
    setTaskError('');
    try {
      const updated = await createFieldMission(fieldKey, {
        title: taskForm.title.trim(),
        force_type: taskForm.force_type,
        incident_id: incident.id,
      });
      upsertFieldCommand(updated);
      setTaskForm({ title: '', force_type: '' });
    } catch (error) {
      console.error('Failed to create task:', error);
      setTaskError(extractApiError(error, 'Failed to create task.'));
    } finally {
      setAddingTask(false);
    }
  };

  const incidentLat = incident?.location_lat ?? 31.77;
  const incidentLng = incident?.location_lng ?? 35.22;

  // Dispatch panel must only ever offer real, actively-online units — never
  // the seeded demo roster. See
  // final changes/05_user_unit_claiming_and_live_sync.md.
  const availableUnits = useMemo(() => {
    const base = Array.isArray(onlineUnits) ? onlineUnits : [];
    return base
      .filter((u) => u.is_online === true && !u.assignedTo)
      .map((u) => ({
        ...u,
        type: normalizeUnitType(u.type),
        distance: calculateDistanceKm(u.location_lat, u.location_lng, incidentLat, incidentLng),
      }))
      .filter((u) => u.distance !== Infinity)
      .sort((a, b) => a.distance - b.distance);
  }, [onlineUnits, incidentLat, incidentLng]);

  const filteredUnits = availableUnits.filter((u) => u.type === selectedType);
  const toggleUnit = (id) => {
    setSelectedUnitIds(
      selectedUnitIds.includes(id)
        ? selectedUnitIds.filter(x => x !== id)
        : [...selectedUnitIds, id]
    );
  };

  const handleClose = () => {
    setSelectedIncident && setSelectedIncident(null);
  };

  // Dispatches real, currently-online units straight onto the real Incident
  // via POST /incidents/{id}/assign-unit/ — one DB Task per unit against the
  // actual incident row (never the mock_incident_id mirror the old
  // /mobile/dispatch/ bridge created). The backend advances OPEN -> PENDING,
  // pushes the mobile notification, and logs the dispatch to a linked Field
  // Command Post. A real unit's marker moves on its own via its GPS heartbeat;
  // the road route is drawn once the unit taps "On My Way" in the app.
  const handleDispatch = async () => {
    if (!incident || selectedUnitIds.length === 0) return;

    const unitsToDispatch = selectedUnitIds
      .map((id) => (onlineUnits || []).find((u) => String(u.id) === String(id)))
      .filter(Boolean);
    if (unitsToDispatch.length === 0) return;

    let lastResponse = null;
    for (const u of unitsToDispatch) {
      try {
        lastResponse = await assignUnitToIncident(incident.id, u.id);
      } catch (error) {
        console.error(`Failed to assign unit ${u.id} to incident ${incident.id}:`, error);
      }
    }

    // Tag each dispatched unit so it disappears from the "available" picker
    // and shows up in "Dispatched Units" as "Awaiting acceptance" — it only
    // becomes "On the way" once the crew taps "On My Way" in the app.
    unitsToDispatch.forEach((u) => upsertOnlineUnit({ id: u.id, assignedTo: incident.id, status: 'ASSIGNED' }));

    // Apply the authoritative incident shape from the last assign response
    // (carries the backend OPEN -> PENDING transition + assigned_unit_ids).
    if (lastResponse && typeof lastResponse === 'object') {
      updateIncident(incident.id, lastResponse);
    } else {
      updateIncident(incident.id, { status: 'PENDING' });
    }
    setSelectedUnitIds([]);

    // Keep panel open so the user sees the dispatched units list immediately.
    // Zoom the map to the incident + its units, and flash the marker.
    setZoomToIncident?.(incident.id);
    setFlashingIncident?.(incident.id);
    // Stop flashing after 4 seconds
    setTimeout(() => clearFlashingIncident?.(), 4000);
  };

  const handleCancelDispatch = (unit) => {
    // Optimistic local prune so the row disappears immediately — the list is
    // driven by incident.assigned_units, which a bare API call wouldn't
    // refresh until the next poll (the "have to refresh to clear it" bug).
    updateIncident(incident.id, {
      assigned_unit_ids: (incident.assigned_unit_ids || []).filter((id) => id !== unit.id),
      assigned_units: (incident.assigned_units || []).filter((u) => u.id !== unit.id),
    });
    upsertOnlineUnit({ id: unit.id, assignedTo: null, status: null, route: null });
    // Real unassign — cancels this unit's open Task on the incident. Re-apply
    // the authoritative incident shape from the response.
    unassignUnitFromIncident(incident.id, unit.id)
      .then((updated) => {
        if (updated && typeof updated === 'object') updateIncident(incident.id, updated);
      })
      .catch((error) => {
        console.error(`Failed to unassign unit ${unit.id} from incident ${incident.id}:`, error);
      });
  };

  const handleUnlinkFieldCommand = async () => {
    const key = incident?.field_command_key;
    if (!key || !incident?.id) return;
    setFcActionBusy(true);
    try {
      await unassignIncidentFromField(key, incident.id);
      updateIncident(incident.id, {
        field_command: null, field_command_key: null, field_command_name: null,
      });
    } catch (error) {
      console.error('Failed to unlink field command:', error);
    } finally {
      setFcActionBusy(false);
    }
  };

  const handleRelinkFieldCommand = async () => {
    if (!relinkFieldId || !incident?.id) return;
    setFcActionBusy(true);
    try {
      const currentKey = incident.field_command_key;
      if (currentKey && currentKey !== relinkFieldId) {
        await unassignIncidentFromField(currentKey, incident.id);
      }
      await assignIncidentToField(relinkFieldId, incident.id);
      const fc = (fieldCommands || []).find((f) => f.id === relinkFieldId);
      updateIncident(incident.id, {
        field_command: relinkFieldId,
        field_command_key: relinkFieldId,
        field_command_name: fc?.name || null,
      });
      setRelinkFieldId('');
    } catch (error) {
      console.error('Failed to reassign field command:', error);
    } finally {
      setFcActionBusy(false);
    }
  };

  const renderUnitCard = (unit) => {
    const meta = TYPE_META[unit.type] || TYPE_META.POLICE;
    const isSelected = selectedUnitIds.includes(unit.id);
    return (
      <div
        key={unit.id}
        className="unit-card-compact"
        onClick={() => toggleUnit(unit.id)}
        style={{
          borderColor: isSelected ? meta.color : '#1f2937',
          background: isSelected ? 'rgba(59,130,246,0.08)' : '#0f172a',
          cursor: 'pointer',
          marginBottom: '8px',
          padding: '8px',
          borderRadius: '6px',
          borderWidth: '1px',
          borderStyle: 'solid',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <div className="unit-card-compact-content">
          <div className="unit-id-compact" style={{ color: meta.color, fontWeight: 'bold' }}>
            {unit.name || unit.id}
          </div>
          <div className="unit-meta-compact" style={{ fontSize: '0.8rem', color: '#9ca3af' }}>{meta.label}</div>
        </div>
        <div className="unit-distance-compact" style={{ fontSize: '0.9rem' }}>{unit.distance.toFixed(1)} km</div>
      </div>
    );
  };

  // Dispatched units for this incident. Authoritative source is the incident's
  // own `assigned_units` (server-computed from active Task rows) so this list
  // always agrees with the backend — never drifts because of client-only
  // state. Unlike `assigned_unit_ids` (online-only, for map markers), this
  // KEEPS a unit whose device disconnected: the assignment survives the crew
  // dropping offline, it just renders greyed as "Connection lost". Any unit
  // optimistically tagged by handleDispatch that the server hasn't confirmed
  // yet is unioned in so the list updates instantly.
  const dispatchedUnits = useMemo(() => {
    if (!incident?.id) return [];
    const unitById = new Map(
      (Array.isArray(onlineUnits) ? onlineUnits : []).map((u) => [u.id, u]),
    );
    const serverUnits = Array.isArray(incident.assigned_units) ? incident.assigned_units : [];
    const serverIds = new Set(serverUnits.map((u) => u.id));
    const optimistic = (Array.isArray(onlineUnits) ? onlineUnits : [])
      .filter((u) => String(u.assignedTo) === String(incident.id) && !serverIds.has(u.id))
      .map((u) => ({ id: u.id, name: u.name, type: u.type, is_online: true }));
    return [...serverUnits, ...optimistic].map((su) => {
      const u = unitById.get(su.id) || {};
      // Server-derived phase from the Task row: crew-confirmed arrival wins,
      // then "accepted / driving", then just "dispatched". Used as the
      // fallback when client-only movement state is gone (e.g. the crew
      // logged out and back in) so the panel doesn't revert an on-scene unit
      // to "ASSIGNED".
      const serverPhase = su.arrived
        ? 'ON_SCENE'
        : (su.task_status === 'IN_PROGRESS' ? 'EN_ROUTE' : 'ASSIGNED');
      // Online/offline must track the LIVE unit store (fed by unit_claimed /
      // unit_heartbeat / unit_disconnected SSE), not the incident's server
      // snapshot — otherwise a crew that reconnects still shows "Connection
      // lost" until the page is refreshed. Only fall back to the server flag
      // when the store has never seen this unit.
      const liveKnown = unitById.has(su.id);
      const isOnline = liveKnown ? (u.is_online !== false) : (su.is_online !== false);
      return {
        id: su.id,
        name: su.name || u.name || `Unit ${su.id}`,
        type: normalizeUnitType(su.type || u.type),
        // Client-side movement state (from the trip animation) is more
        // granular while it exists; otherwise fall back to the server phase.
        status: u.status || serverPhase,
        // Trip animation reached the pin but the crew hasn't confirmed
        // arrival yet — shown as "Arriving" rather than "On scene".
        atDestination: !!u.atDestination && !su.arrived,
        etaMin: u.etaMin,
        distanceKm: u.distanceKm,
        isOnline,
        isReal: true,
      };
    });
  }, [incident?.id, incident?.assigned_units, onlineUnits]);

  const headerIcon = (() => {
    const type = (incident?.incident_type || '').toUpperCase();
    if (type.includes('FIRE')) return <Flame size={20} color="#ef4444" />;
    if (type.includes('MED')) return <Ambulance size={20} color="#f8fafc" />;
    return <Shield size={20} color="#3b82f6" />;
  })();

  if (!incident) return null;

  return (
    <SidePanel
      icon={headerIcon} 
      title={incident.title || 'Incident'}
      subtitle={(
        <>
          <MapPin size={14} style={{ marginRight: 6 }} />
          {incident.location_name
            || (() => {
              const city = nearestCityName(incident.location_lat, incident.location_lng);
              return city ? `Near ${city}` : 'Unknown location';
            })()}
        </>
      )}
      onClose={handleClose}
      footer={activeTab === 'dispatch' && (
        <div className="cc-footer p-4 border-t border-slate-700 bg-slate-900 z-10" style={{ flexShrink: 0 }}>
          <div className="flex justify-between items-center">
            <div className="cc-selection text-sm text-slate-400">Selected: <span className="text-white font-bold">{selectedUnitIds.length}</span></div>
            <button
              className="cc-dispatch bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded flex items-center disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              disabled={selectedUnitIds.length === 0}
              onClick={handleDispatch}
            >
              Dispatch Units
              <ChevronRight size={16} style={{ marginLeft: 8 }} />
            </button>
          </div>
        </div>
      )}
    >

      {/* ── Tab Bar ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
        {[
          { id: 'dispatch', label: '🚒 Dispatch' },
          { id: 'tasks',    label: '🗂 Tasks' },
          { id: 'events',   label: '📋 Events'  },
          { id: 'major',    label: '🌐 Major Incident' },
          { id: 'settings', label: '⚙ Settings' },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            style={{
              flex: 1,
              padding: '9px 0',
              background: activeTab === id ? 'rgba(59,130,246,0.10)' : 'transparent',
              color: activeTab === id ? '#60a5fa' : '#6b7280',
              border: 'none',
              borderBottom: activeTab === id ? '2px solid #3b82f6' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '0.82rem',
              fontWeight: '600',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* --- Scrollable Content Wrapper --- */}
      {/* dispatch: outer div scrolls (thin custom scrollbar via cc-list-scrollable).
          events: EventFeed handles its own scroll, outer must not double-scroll. */}
      <div className={activeTab === 'events' ? '' : 'cc-list-scrollable'} style={{
        flex: 1,
        overflowY: activeTab === 'events' ? 'hidden' : 'auto',
        padding: activeTab === 'events' ? '0' : '1rem',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}>

      {/* ── Events tab ── */}
      {activeTab === 'events' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          <EventFeed />
        </div>
      )}

      {/* ── Tasks tab: force-typed taskings for this incident ── */}
      {activeTab === 'tasks' && (
        <div>
          {!fieldKey ? (
            <div style={{
              fontSize: '0.82rem', color: '#94a3b8', background: '#0f172a',
              border: '1px dashed #1f2937', borderRadius: '6px', padding: '12px', lineHeight: 1.5,
            }}>
              Link this incident to a Field Command post (on the <strong>Dispatch</strong> tab)
              to assign tasks. Tasks belong to the post so its field crews can see and action them.
            </div>
          ) : (
            <>
              {/* New task — force is REQUIRED */}
              <form onSubmit={handleAddTask} style={{ marginBottom: '1.25rem' }}>
                <div className="cc-section-label text-xs uppercase text-slate-500 font-bold mb-2">New task</div>
                <label style={labelStyle}>Assign to</label>
                <div style={{ display: 'flex', gap: '6px', margin: '6px 0' }}>
                  {FORCE_OPTIONS.map((f) => {
                    const meta = forceMeta(f);
                    const active = taskForm.force_type === f;
                    return (
                      <button
                        type="button"
                        key={f}
                        onClick={() => setTaskForm((s) => ({ ...s, force_type: f }))}
                        style={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                          border: `1px solid ${active ? meta.color : '#374151'}`,
                          background: active ? `${meta.color}22` : 'transparent',
                          color: active ? meta.color : '#9ca3af',
                          borderRadius: '8px', padding: '7px 4px', fontSize: '0.78rem',
                          fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        <span style={{ fontSize: '1rem' }}>{meta.emoji}</span>
                        {forceLabel(f)}
                      </button>
                    );
                  })}
                </div>
                <label style={labelStyle}>Task</label>
                <input
                  type="text"
                  placeholder="e.g. Secure the north perimeter"
                  value={taskForm.title}
                  onChange={(e) => setTaskForm((s) => ({ ...s, title: e.target.value }))}
                  style={inputStyle}
                />
                {taskError && (
                  <div style={{ color: '#ef4444', fontSize: '0.78rem', margin: '6px 0' }}>{taskError}</div>
                )}
                <button
                  type="submit"
                  disabled={addingTask || !taskForm.title.trim() || !taskForm.force_type}
                  style={{
                    ...submitButtonStyle, background: '#2563eb',
                    opacity: (addingTask || !taskForm.title.trim() || !taskForm.force_type) ? 0.6 : 1,
                    cursor: (addingTask || !taskForm.title.trim() || !taskForm.force_type) ? 'not-allowed' : 'pointer',
                  }}
                >
                  {addingTask ? 'Adding…' : 'Add Task'}
                </button>
              </form>

              {/* Existing tasks, grouped by force */}
              {incidentTasks.length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>No tasks for this incident yet.</div>
              ) : (
                FORCE_OPTIONS.filter((f) => tasksByForce[f]?.length).map((f) => {
                  const meta = forceMeta(f);
                  return (
                    <div key={f} style={{ marginBottom: '14px' }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px',
                        fontSize: '0.78rem', fontWeight: 700, color: meta.color,
                      }}>
                        <span style={{ fontSize: '1rem' }}>{meta.emoji}</span>{forceLabel(f)}
                      </div>
                      {tasksByForce[f].map((t) => {
                        const sm = TASK_STATUS_META[t.status] || TASK_STATUS_META.OPEN;
                        return (
                          <div key={t.id} style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            background: '#0f172a', border: '1px solid #1f2937',
                            borderRadius: '6px', padding: '8px 10px', marginBottom: '6px',
                          }}>
                            <span style={{
                              flex: 1, fontSize: '0.82rem', color: '#e2e8f0',
                              textDecoration: t.status === 'DONE' ? 'line-through' : 'none',
                              opacity: t.status === 'DONE' ? 0.6 : 1,
                            }}>{t.title}</span>
                            {/* Read-only here — a task's status is driven by the
                                field crew that owns it (mobile app / field
                                dashboard), never from the command centre. */}
                            <span
                              title="Status is set by the field crew"
                              style={{
                                background: `${sm.color}1f`, color: sm.color,
                                border: `1px solid ${sm.color}`,
                                borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700,
                                padding: '3px 9px', whiteSpace: 'nowrap',
                              }}
                            >
                              {sm.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      )}

      {/* ── Major Incident tab ── */}
      {activeTab === 'major' && (
        <div>
          {!isLive ? (
            <div style={{ marginBottom: '1.25rem', flexDirection: 'column',  }}>
              <div className="cc-section-label text-xs uppercase text-slate-500 font-bold mb-2">Major Incident</div>
              <p style={{ fontSize: '0.82rem', color: '#9ca3af', margin: '0 0 4px 0' }}>
                Declare this a Major Incident to open a dedicated Field War-Room for it.
              </p>
              <label style={labelStyle}>Incident Type</label>
              <select
                value={goLiveType}
                onChange={(e) => setGoLiveType(e.target.value)}
                style={inputStyle}
              >
                <option value="EARTHQUAKE">Earthquake</option>
                <option value="MISSILE_STRIKE">Missile Strike</option>
                <option value="BUILDING_COLLAPSE">Building Collapse</option>
                <option value="FLOOD">Flood</option>
                <option value="HAZMAT">HAZMAT</option>
                <option value="WILDFIRE">Wildfire</option>
              </select>
              {goLiveError && (
                <div style={{ color: '#ef4444', fontSize: '0.78rem', margin: '6px 0' }}>{goLiveError}</div>
              )}
              <button
                type="button"
                onClick={handleGoLive}
                disabled={goingLive}
                style={{
                  ...submitButtonStyle,
                  background: '#dc2626',
                  cursor: goingLive ? 'not-allowed' : 'pointer',
                  opacity: goingLive ? 0.6 : 1,
                }}
              >
                {goingLive ? 'Declaring…' : '🚨 Go Live'}
              </button>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: '1.25rem' }}>
                <div className="cc-section-label text-xs uppercase text-slate-500 font-bold mb-2">
                  Field Incident
                </div>
                <div style={{
                  background: '#0f172a', border: '1px solid #334155', borderRadius: '8px',
                  padding: '12px', display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', gap: '10px',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Active Command
                    </div>
                    <div style={{
                      fontSize: '0.9rem', color: '#e2e8f0', fontWeight: 700,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {incident.title} - Field Incident
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
                      {incident.major_incident?.status || 'ACTIVE'}
                    </div>
                  </div>
                  {incident.major_incident?.field_key && (
                    <button
                      type="button"
                      onClick={() => navigate(`/field-incident?fieldId=${incident.major_incident.field_key}`)}
                      style={{
                        border: '1px solid #3b82f6', background: 'rgba(59,130,246,0.12)',
                        color: '#60a5fa', borderRadius: '6px', padding: '6px 10px',
                        fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                      }}
                    >
                      Open Field HQ ↗
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Dispatch tab content (original) ── */}
      {activeTab === 'dispatch' && (<>

        {/* ── Linked Field Command Post — with unlink / re-assign controls ── */}
        {(() => {
          const openFCs = (Array.isArray(fieldCommands) ? fieldCommands : [])
            .filter((f) => f.status !== 'CLOSED');
          const linked = !!incident.field_command;
          // The post this incident is already on must never be offered as a
          // "move" target — match on every identifier it might carry.
          const currentKeys = [
            incident.field_command_key,
            incident.field_command,
            incident.field_command_name,
          ].filter((v) => v != null).map(String);
          const otherFCs = openFCs.filter(
            (f) => !currentKeys.includes(String(f.id)) && !currentKeys.includes(String(f.name)),
          );
          const smallBtn = {
            border: 'none', borderRadius: '5px', padding: '5px 10px',
            fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap',
          };
          return (
            <div style={{
              marginBottom: '1.25rem', padding: '10px', background: '#0f172a',
              border: '1px solid #1f2937', borderRadius: '6px',
              display: 'flex', flexDirection: 'column', gap: '8px',
            }}>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Field Command Post
              </div>

              {linked ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => onSelectFieldCommand?.(incident.field_command_key)}
                    style={{
                      background: 'none', border: 'none', padding: 0, minWidth: 0,
                      fontSize: '0.85rem', fontWeight: 600, color: '#60a5fa',
                      cursor: onSelectFieldCommand ? 'pointer' : 'default',
                      display: 'flex', alignItems: 'center', gap: '4px',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {incident.field_command_name || `Post #${incident.field_command}`}
                    </span>
                    {onSelectFieldCommand && <ChevronRight size={14} color="#60a5fa" style={{ flexShrink: 0 }} />}
                  </button>
                  <button
                    type="button"
                    onClick={handleUnlinkFieldCommand}
                    disabled={fcActionBusy}
                    style={{
                      ...smallBtn, background: 'rgba(239,68,68,0.12)',
                      border: '1px solid #ef4444', color: '#f87171', flexShrink: 0,
                      cursor: fcActionBusy ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Unlink
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Not linked to a post</div>
              )}

              {otherFCs.length > 0 && (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <select
                    value={relinkFieldId}
                    onChange={(e) => setRelinkFieldId(e.target.value)}
                    style={{
                      flex: 1, minWidth: 0, padding: '5px 7px', margin: 0,
                      background: '#1e293b', color: '#fff',
                      border: '1px solid #475569', borderRadius: '6px',
                      fontSize: '0.76rem', boxSizing: 'border-box',
                    }}
                  >
                    <option value="" disabled>
                      {linked ? 'Move to another post…' : 'Link to a post…'}
                    </option>
                    {otherFCs.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleRelinkFieldCommand}
                    disabled={fcActionBusy || !relinkFieldId}
                    style={{
                      ...smallBtn, background: '#0284c7', color: '#fff', flexShrink: 0,
                      opacity: (fcActionBusy || !relinkFieldId) ? 0.5 : 1,
                      cursor: (fcActionBusy || !relinkFieldId) ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {linked ? 'Move' : 'Link'}
                  </button>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Dispatched Units (always visible) ── */}
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '1rem' }}>🚨</span>
            <span style={{ fontWeight: '600', color: '#e2e8f0', fontSize: '0.9rem' }}>Dispatched Units</span>
            <span style={{
              marginLeft: 'auto',
              background: dispatchedUnits.length > 0 ? '#1e3a5f' : '#1f2937',
              color: dispatchedUnits.length > 0 ? '#93c5fd' : '#6b7280',
              borderRadius: '999px',
              padding: '2px 10px',
              fontSize: '0.75rem',
              fontWeight: 'bold',
            }}>{dispatchedUnits.length}</span>
          </div>

          {dispatchedUnits.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '12px',
              color: '#4b5563',
              fontSize: '0.82rem',
              fontStyle: 'italic',
              background: '#0f172a',
              borderRadius: '6px',
              border: '1px dashed #1f2937',
            }}>
              No units dispatched yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
              {dispatchedUnits.map((unit) => {
                const meta = TYPE_META[unit.type] || TYPE_META.POLICE;
                // ASSIGNED = dispatched, crew hasn't accepted in the app yet;
                // EN_ROUTE = accepted and driving; ON_SCENE = arrived.
                // A disconnected crew stays assigned — shown greyed with a
                // "Connection lost" badge instead of a live phase.
                const phase = !unit.isOnline
                  ? { label: 'Connection lost', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' }
                  : unit.status === 'ON_SCENE'
                    ? { label: 'On scene', color: '#10b981', bg: 'rgba(16,185,129,0.12)' }
                    : (unit.status === 'EN_ROUTE' && unit.atDestination)
                      ? { label: 'Arriving — awaiting crew confirmation', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' }
                      : unit.status === 'EN_ROUTE'
                        ? { label: 'On the way', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' }
                        : { label: 'Awaiting acceptance', color: '#38bdf8', bg: 'rgba(56,189,248,0.12)' };
                const statusLabel = phase.label
                  + (unit.isOnline && unit.status === 'EN_ROUTE' && Number.isFinite(unit.etaMin) && unit.etaMin > 0
                    ? ` · ${Math.max(1, Math.round(unit.etaMin))} min`
                    : '');
                const statusColor = phase.color;
                const statusBg = phase.bg;
                return (
                  <div key={unit.id} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: '#0f172a',
                    border: '1px solid #1f2937',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    opacity: unit.isOnline ? 1 : 0.6,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <meta.Icon size={14} color={meta.color} />
                      <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#e2e8f0' }}>
                        {unit.name}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{
                        background: statusBg,
                        color: statusColor,
                        border: `1px solid ${statusColor}`,
                        borderRadius: '999px',
                        padding: '2px 10px',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                      }}>
                        {statusLabel}
                      </span>
                      <button
                        title="Cancel dispatch"
                        onClick={(e) => { e.stopPropagation(); handleCancelDispatch(unit); }}
                        style={{
                          background: 'transparent',
                          border: '1px solid #ef4444',
                          color: '#ef4444',
                          borderRadius: '4px',
                          padding: '1px 7px',
                          fontSize: '0.7rem',
                          cursor: 'pointer',
                          lineHeight: '1.4',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Dispatch Forces (primary action — moved above Severity/Close so it's visible without scrolling) ── */}
        <div className="cc-section flex flex-col">
          <div className="cc-section-header flex items-center gap-2 mb-3 text-slate-300">
            <SirenIcon />
            <span className="font-semibold">Dispatch Forces</span>
          </div>

          <div className="cc-tabs flex gap-2 mb-3">
            {TYPE_ORDER.map((type) => {
              const { label, color, Icon } = TYPE_META[type];
              const isActive = selectedType === type;
              return (
                <button
                  key={type}
                  onClick={() => setSelectedType(type)}
                  style={{
                    borderColor: isActive ? color : '#374151',
                    background: isActive ? `${color}20` : 'transparent',
                    color: isActive ? color : '#9ca3af',
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    padding: '6px 12px',
                    borderRadius: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  <Icon size={14} />
                  {label}
                </button>
              );
            })}
          </div>

          {/* Unit List — grows freely, outer panel scrolls */}
          <div>
            {filteredUnits.length === 0 ? (
              <div className="cc-empty text-center py-8 text-slate-500 italic">No available units of this type</div>
            ) : (
              filteredUnits.map(renderUnitCard)
            )}
          </div>
        </div>

        </>)}

        {/* ── Settings tab: severity + close, secondary/infrequent actions kept off the main Dispatch tab ── */}
        {activeTab === 'settings' && (
          <>
            {/* ── Incident Severity ── */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div className="cc-section-label text-xs uppercase text-slate-500 font-bold mb-2">Incident Severity</div>
              <div className="cc-severity-buttons grid grid-cols-3 gap-2">
                {['LOW', 'MEDIUM', 'HIGH'].map((level) => {
                  const normalizedPriority = incident.priority === 'CRITICAL' ? 'HIGH' : incident.priority;
                  const currentPriority = normalizedPriority === 'MED' ? 'MEDIUM' : normalizedPriority;
                  const isActive = currentPriority === level;
                  const colors = { LOW: '#10b981', MEDIUM: '#f59e0b', HIGH: '#ef4444' };
                  const color = colors[level];
                  return (
                    <button
                      key={level}
                      onClick={() => handlePriorityChange(level === 'MEDIUM' ? 'MED' : level)}
                      style={{
                        background: isActive ? color : 'transparent',
                        borderColor: color,
                        color: isActive ? 'white' : color,
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        padding: '8px',
                        borderRadius: '4px',
                        fontWeight: isActive ? 'bold' : 'normal',
                        opacity: isActive ? 1 : 0.6,
                        transition: 'all 0.2s ease',
                        cursor: 'pointer',
                      }}
                    >
                      {level}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Close Incident (Command Center) ── */}
            {canClose && (
              <div style={{ marginBottom: '0.25rem' }}>
                <div className="cc-section-label text-xs uppercase text-slate-500 font-bold mb-2">Close Incident</div>
                <textarea
                  value={closeReason}
                  onChange={(e) => setCloseReason(e.target.value)}
                  placeholder="Closure reason (required) — e.g. resolved by phone call, false alarm..."
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
                {closeError && (
                  <div style={{ color: '#ef4444', fontSize: '0.78rem', marginBottom: '6px' }}>{closeError}</div>
                )}
                <button
                  type="button"
                  onClick={handleCloseIncident}
                  disabled={closing || !closeReason.trim()}
                  style={{
                    width: '100%',
                    background: '#ef4444',
                    border: '1px solid #ef4444',
                    color: 'white',
                    borderRadius: '6px',
                    padding: '8px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: closing || !closeReason.trim() ? 'not-allowed' : 'pointer',
                    opacity: closing || !closeReason.trim() ? 0.6 : 1,
                  }}
                >
                  {closing ? 'Closing…' : 'Close Incident'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </SidePanel>
  );
}

const SirenIcon = () => <AlertTriangle size={16} color="#f87171" />;
