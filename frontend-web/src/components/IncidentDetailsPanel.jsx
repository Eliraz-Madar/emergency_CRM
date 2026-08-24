import { useMemo, useState, useEffect } from 'react';
import { EventFeed } from './EventFeed.jsx';
import { Shield, Flame, Ambulance, X, MapPin, AlertTriangle, ChevronRight } from 'lucide-react';
import { useDashboardStore } from '../store/dashboard.js';
import {
  updateIncidentStatus,
  goLiveIncident,
  getMajorIncidentSectors,
  createMajorIncidentSector,
  getMajorIncidentTaskGroups,
  createMajorIncidentTaskGroup,
} from '../api/client.js';

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

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const getDistanceKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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

export function IncidentDetailsPanel({ onGoLiveCreateFieldCommand } = {}) {
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
  } = useDashboardStore();

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

  // Reset to dispatch tab whenever a different incident is opened
  useEffect(() => {
    setActiveTab('dispatch');
    setCloseReason('');
    setCloseError('');
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
  const [sectors, setSectors] = useState([]);
  const [sectorForm, setSectorForm] = useState({ name: '', hazardLevel: 'MEDIUM' });
  const [addingSector, setAddingSector] = useState(false);
  const [sectorError, setSectorError] = useState('');
  const [taskGroups, setTaskGroups] = useState([]);
  const [taskGroupForm, setTaskGroupForm] = useState({ title: '', category: 'SEARCH_RESCUE', sectorIds: [] });
  const [addingTaskGroup, setAddingTaskGroup] = useState(false);
  const [taskGroupError, setTaskGroupError] = useState('');

  // Reset major-incident form state whenever a different incident is opened
  useEffect(() => {
    setLiveMajorIncident(null);
    setGoLiveType('EARTHQUAKE');
    setGoLiveError('');
    setSectorForm({ name: '', hazardLevel: 'MEDIUM' });
    setSectorError('');
    setTaskGroupForm({ title: '', category: 'SEARCH_RESCUE', sectorIds: [] });
    setTaskGroupError('');
  }, [incident?.id]);

  // Load existing sectors/task groups once this incident is live.
  useEffect(() => {
    if (!liveMajorIncidentId) {
      setSectors([]);
      setTaskGroups([]);
      return;
    }
    let cancelled = false;
    getMajorIncidentSectors(liveMajorIncidentId)
      .then((data) => { if (!cancelled) setSectors(Array.isArray(data) ? data : []); })
      .catch(() => {});
    getMajorIncidentTaskGroups(liveMajorIncidentId)
      .then((data) => { if (!cancelled) setTaskGroups(Array.isArray(data) ? data : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [liveMajorIncidentId]);

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

  const handleGoLive = async () => {
    if (!incident?.id) return;
    setGoingLive(true);
    setGoLiveError('');
    try {
      const created = await goLiveIncident(incident.id, goLiveType);
      setLiveMajorIncident(created);
      // Bridge straight into the Create Field Command modal — mirrors
      // MapView.jsx's onMapCreateFieldCommand pattern (a plain callback
      // prop) rather than a new store mechanism, since Dashboard.jsx's
      // create-field modal state is local component state, not the store.
      onGoLiveCreateFieldCommand?.({
        lat: created.location_lat,
        lng: created.location_lng,
        majorIncidentId: created.id,
        incidentType: created.incident_type,
        title: created.title,
      });
    } catch (error) {
      console.error('Failed to go live:', error);
      // Covers the double-go-live case: the backend rejects a second call
      // on the same Incident with a 400 (incident_id: "... already gone
      // live as MajorIncident <id>."), surfaced here instead of retried.
      setGoLiveError(extractApiError(error, 'Failed to declare major incident.'));
    } finally {
      setGoingLive(false);
    }
  };

  const handleAddSector = async (e) => {
    e.preventDefault();
    if (!liveMajorIncidentId || !sectorForm.name.trim()) return;
    setAddingSector(true);
    setSectorError('');
    try {
      const created = await createMajorIncidentSector(liveMajorIncidentId, {
        name: sectorForm.name.trim(),
        hazardLevel: sectorForm.hazardLevel,
      });
      setSectors((prev) => [...prev, created]);
      setSectorForm({ name: '', hazardLevel: 'MEDIUM' });
    } catch (error) {
      console.error('Failed to create sector:', error);
      setSectorError(extractApiError(error, 'Failed to create sector.'));
    } finally {
      setAddingSector(false);
    }
  };

  const toggleTaskGroupSector = (sectorId) => {
    setTaskGroupForm((prev) => ({
      ...prev,
      sectorIds: prev.sectorIds.includes(sectorId)
        ? prev.sectorIds.filter((id) => id !== sectorId)
        : [...prev.sectorIds, sectorId],
    }));
  };

  const handleAddTaskGroup = async (e) => {
    e.preventDefault();
    if (!liveMajorIncidentId || !taskGroupForm.title.trim()) return;
    setAddingTaskGroup(true);
    setTaskGroupError('');
    try {
      const created = await createMajorIncidentTaskGroup(liveMajorIncidentId, {
        title: taskGroupForm.title.trim(),
        category: taskGroupForm.category,
        sectorIds: taskGroupForm.sectorIds,
      });
      setTaskGroups((prev) => [...prev, created]);
      setTaskGroupForm({ title: '', category: 'SEARCH_RESCUE', sectorIds: [] });
    } catch (error) {
      console.error('Failed to create task group:', error);
      setTaskGroupError(extractApiError(error, 'Failed to create task group.'));
    } finally {
      setAddingTaskGroup(false);
    }
  };

  const handlePriorityChange = (newPriority) => {
    if (incident && incident.id) {
      updateIncident(incident.id, { priority: newPriority });
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
        distance: getDistanceKm(u.location_lat, u.location_lng, incidentLat, incidentLng),
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

  // Dispatches real, currently-online units by mirroring into the DB as
  // Tasks (mobile_dispatch), the same bridge the mobile app's claim flow
  // reconciles with by name — see
  // final changes/05_user_unit_claiming_and_live_sync.md. Deliberately does
  // NOT go through fieldIncident.js's dispatchUnitsToIncident(), which
  // drives the fake-roster route/movement animation task 04 removed —
  // a real unit's marker moves on its own via its live GPS heartbeat.
  const handleDispatch = async () => {
    if (!incident || selectedUnitIds.length === 0) return;

    const unitsToDispatch = selectedUnitIds
      .map((id) => (onlineUnits || []).find((u) => String(u.id) === String(id)))
      .filter(Boolean);
    if (unitsToDispatch.length === 0) return;

    try {
      await fetch(`${API_BASE_URL}/mobile/dispatch/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: incident.id,
          incident_title: incident.title || `Incident ${incident.id}`,
          location_lat: incidentLat,
          location_lng: incidentLng,
          priority: incident.priority || 'HIGH',
          units: unitsToDispatch.map((u) => ({
            mock_unit_num: u.id,
            name: u.name,
            type: u.type,
          })),
        }),
      });
    } catch (_) {
      // non-critical — the incident is still marked in-progress locally below
    }

    // Tag each dispatched unit so it disappears from the "available" picker
    // and shows up in "Dispatched Units" — its marker keeps rendering at
    // its own live GPS position, no fake route is drawn.
    unitsToDispatch.forEach((u) => upsertOnlineUnit({ id: u.id, assignedTo: incident.id, status: 'EN_ROUTE' }));

    updateIncident(incident.id, { status: 'IN_PROGRESS' });
    setSelectedUnitIds([]);

    // Keep panel open so the user sees the dispatched units list immediately.
    // Zoom the map to the incident + its units, and flash the marker.
    setZoomToIncident?.(incident.id);
    setFlashingIncident?.(incident.id);
    // Stop flashing after 4 seconds
    setTimeout(() => clearFlashingIncident?.(), 4000);
  };

  const handleCancelDispatch = (unit) => {
    // Real cancel-dispatch call — inlined directly (mirrors handleDispatch's
    // raw-fetch style above) since this used to go through the shared field
    // store's cancelUnitDispatch(), which had a real HTTP side effect here
    // (not simulation bookkeeping) alongside fake-roster mutations that are
    // dropped along with the store dependency.
    fetch(`${API_BASE_URL}/mobile/cancel-dispatch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mock_unit_id: unit.id, incident_id: incident.id }),
    }).catch(() => {});
    upsertOnlineUnit({ id: unit.id, assignedTo: null, status: null });
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

  // Live dispatched units for this incident: real online units tagged by
  // handleDispatch above. See final changes/05_user_unit_claiming_and_live_sync.md.
  const dispatchedUnits = useMemo(() => {
    if (!incident?.id) return [];
    return (Array.isArray(onlineUnits) ? onlineUnits : [])
      .filter((u) => String(u.assignedTo) === String(incident.id))
      .map((u) => ({
        id: u.id,
        name: u.name || String(u.id),
        type: normalizeUnitType(u.type),
        status: u.status || 'EN_ROUTE',
        isReal: true,
      }));
  }, [incident?.id, onlineUnits]);

  const headerIcon = (() => {
    const type = (incident?.incident_type || '').toUpperCase();
    if (type.includes('FIRE')) return <Flame size={20} color="#ef4444" />;
    if (type.includes('MED')) return <Ambulance size={20} color="#f8fafc" />;
    return <Shield size={20} color="#3b82f6" />;
  })();

  if (!incident) return null;

  // --- Layout Fix ---
  // 1. h-[calc(100vh-2rem)]: קובע גובה קשיח.
  // 2. flex flex-col: מסדר את הילדים בטור.
  return (
    <div
      style={{
        position: 'fixed',
        right: '1rem',
        top: '1rem',
        bottom: '1rem',
        width: '24rem',
        height: 'calc(100vh - 2rem)',
        background: 'radial-gradient(circle at 20% 20%, #111827, #0b1220)',
        color: '#e5e7eb',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 2000,
        borderRadius: '0.5rem',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
        border: '1px solid #334155'
      }}
    >
      {/* Header - Fixed Height (shrink-0) */}
      <div className="cc-header p-4 border-b border-slate-700 flex justify-between items-start" style={{ flexShrink: 0 }}>
        <div className="cc-header-left flex gap-3">
          <div className="cc-icon-circle p-2 bg-slate-800 rounded-full">{headerIcon}</div>
          <div>
            <div className="cc-title font-bold text-lg">{incident.title || 'Incident'}</div>
            <div className="cc-subtitle text-sm text-slate-400 flex items-center">
              <MapPin size={14} style={{ marginRight: 6 }} />
              {incident.location_name || 'Unknown location'}
            </div>
          </div>
        </div>
        <div className="cc-header-right flex items-center gap-2">
          <button className="cc-close hover:bg-slate-800 p-1 rounded" onClick={handleClose} aria-label="Close panel">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── Tab Bar ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
        {[
          { id: 'dispatch', label: '🚒 Dispatch' },
          { id: 'events',   label: '📋 Events'  },
          { id: 'major',    label: '🌐 Major Incident' },
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
      {/* dispatch: outer div scrolls. events: EventFeed handles its own scroll, outer must not double-scroll. */}
      <div style={{
        flex: 1,
        overflowY: activeTab === 'events' ? 'hidden' : 'auto',
        padding: activeTab === 'events' ? '0' : '1rem',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}>

      {/* ── Events tab ── */}
      {activeTab === 'events' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <EventFeed />
        </div>
      )}

      {/* ── Major Incident tab ── */}
      {activeTab === 'major' && (
        <div>
          {!isLive ? (
            <div style={{ marginBottom: '1.25rem' }}>
              <div className="cc-section-label text-xs uppercase text-slate-500 font-bold mb-2">Major Incident</div>
              <p style={{ fontSize: '0.82rem', color: '#9ca3af', margin: '0 0 4px 0' }}>
                Declare this a Major Incident to unlock sector and task-group coordination.
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
                  Major Incident — {liveMajorIncident?.status ?? incident.major_incident.status}
                </div>
                {liveMajorIncident ? (
                  <div style={{
                    background: '#0f172a', border: '1px solid #1f2937', borderRadius: '6px',
                    padding: '10px', fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.6,
                  }}>
                    <div style={{ fontWeight: 700, color: '#f87171', marginBottom: '4px' }}>{liveMajorIncident.title}</div>
                    <div>Type: {liveMajorIncident.incident_type}</div>
                    <div>Est. Casualties: {liveMajorIncident.estimated_casualties ?? 0}</div>
                    <div>Confirmed Deaths: {liveMajorIncident.confirmed_deaths ?? 0}</div>
                    <div>Displaced Persons: {liveMajorIncident.displaced_persons ?? 0}</div>
                    <div>Affected Radius: {liveMajorIncident.radius_meters ?? 0} m</div>
                  </div>
                ) : (
                  // Already live (incident.major_incident from the API), but this
                  // session never called go-live itself, so only the id/status are
                  // known — no MajorIncident detail-GET endpoint exists yet to
                  // fetch the rest. Sector/Task Group forms below still work off
                  // liveMajorIncidentId alone.
                  <div style={{
                    background: '#0f172a', border: '1px solid #1f2937', borderRadius: '6px',
                    padding: '10px', fontSize: '0.8rem', color: '#9ca3af', fontStyle: 'italic',
                  }}>
                    Already declared as a Major Incident (id {liveMajorIncidentId}).
                  </div>
                )}
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <div className="cc-section-label text-xs uppercase text-slate-500 font-bold mb-2">Add Sector</div>
                <form onSubmit={handleAddSector}>
                  <label style={labelStyle}>Name</label>
                  <input
                    type="text"
                    placeholder="e.g. North Zone"
                    value={sectorForm.name}
                    onChange={(e) => setSectorForm({ ...sectorForm, name: e.target.value })}
                    style={inputStyle}
                    required
                  />
                  <label style={labelStyle}>Hazard Level</label>
                  <select
                    value={sectorForm.hazardLevel}
                    onChange={(e) => setSectorForm({ ...sectorForm, hazardLevel: e.target.value })}
                    style={inputStyle}
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                  {sectorError && (
                    <div style={{ color: '#ef4444', fontSize: '0.78rem', margin: '6px 0' }}>{sectorError}</div>
                  )}
                  <button
                    type="submit"
                    disabled={addingSector || !sectorForm.name.trim()}
                    style={{
                      ...submitButtonStyle,
                      background: '#0284c7',
                      cursor: addingSector || !sectorForm.name.trim() ? 'not-allowed' : 'pointer',
                      opacity: addingSector || !sectorForm.name.trim() ? 0.6 : 1,
                    }}
                  >
                    {addingSector ? 'Adding…' : 'Add Sector'}
                  </button>
                </form>
                {sectors.length > 0 && (
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {sectors.map((s) => (
                      <div key={s.id} style={{
                        display: 'flex', justifyContent: 'space-between',
                        fontSize: '0.78rem', color: '#9ca3af',
                        background: '#0f172a', border: '1px solid #1f2937',
                        borderRadius: '4px', padding: '4px 8px',
                      }}>
                        <span>{s.name}</span>
                        <span>{s.hazard_level}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <div className="cc-section-label text-xs uppercase text-slate-500 font-bold mb-2">Add Task Group</div>
                <form onSubmit={handleAddTaskGroup}>
                  <label style={labelStyle}>Title</label>
                  <input
                    type="text"
                    placeholder="e.g. Search & Rescue Alpha"
                    value={taskGroupForm.title}
                    onChange={(e) => setTaskGroupForm({ ...taskGroupForm, title: e.target.value })}
                    style={inputStyle}
                    required
                  />
                  <label style={labelStyle}>Category</label>
                  <select
                    value={taskGroupForm.category}
                    onChange={(e) => setTaskGroupForm({ ...taskGroupForm, category: e.target.value })}
                    style={inputStyle}
                  >
                    <option value="SEARCH_RESCUE">Search &amp; Rescue</option>
                    <option value="EVACUATION">Evacuation</option>
                    <option value="MEDICAL">Medical Response</option>
                    <option value="UTILITIES">Utilities/Infrastructure</option>
                    <option value="SECURITY">Security &amp; Perimeter</option>
                    <option value="LOGISTICS">Logistics &amp; Supply</option>
                    <option value="DAMAGE_ASSESSMENT">Damage Assessment</option>
                    <option value="COMMUNICATIONS">Communications</option>
                  </select>

                  {sectors.length > 0 && (
                    <>
                      <label style={labelStyle}>Sectors (optional)</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '6px 0' }}>
                        {sectors.map((s) => {
                          const active = taskGroupForm.sectorIds.includes(s.id);
                          return (
                            <button
                              type="button"
                              key={s.id}
                              onClick={() => toggleTaskGroupSector(s.id)}
                              style={{
                                borderColor: active ? '#60a5fa' : '#374151',
                                background: active ? 'rgba(59,130,246,0.15)' : 'transparent',
                                color: active ? '#60a5fa' : '#9ca3af',
                                borderWidth: '1px',
                                borderStyle: 'solid',
                                padding: '4px 10px',
                                borderRadius: '999px',
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                              }}
                            >
                              {s.name}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {taskGroupError && (
                    <div style={{ color: '#ef4444', fontSize: '0.78rem', margin: '6px 0' }}>{taskGroupError}</div>
                  )}
                  <button
                    type="submit"
                    disabled={addingTaskGroup || !taskGroupForm.title.trim()}
                    style={{
                      ...submitButtonStyle,
                      background: '#0284c7',
                      cursor: addingTaskGroup || !taskGroupForm.title.trim() ? 'not-allowed' : 'pointer',
                      opacity: addingTaskGroup || !taskGroupForm.title.trim() ? 0.6 : 1,
                    }}
                  >
                    {addingTaskGroup ? 'Adding…' : 'Add Task Group'}
                  </button>
                </form>
                {taskGroups.length > 0 && (
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {taskGroups.map((tg) => (
                      <div key={tg.id} style={{
                        fontSize: '0.78rem', color: '#9ca3af',
                        background: '#0f172a', border: '1px solid #1f2937',
                        borderRadius: '4px', padding: '4px 8px',
                      }}>
                        {tg.title} — {tg.category}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Dispatch tab content (original) ── */}
      {activeTab === 'dispatch' && (<>

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
                const isArrived = unit.status === 'ON_SCENE';
                const statusLabel = isArrived ? 'Arrived' : 'On the Way';
                const statusColor = isArrived ? '#10b981' : '#f59e0b';
                const statusBg = isArrived ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)';
                return (
                  <div key={unit.id} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: '#0f172a',
                    border: '1px solid #1f2937',
                    borderRadius: '6px',
                    padding: '8px 10px',
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
          <div style={{ marginBottom: '1.25rem' }}>
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

        {/* ── Dispatch Forces ── */}
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
      </div>

      {/* Footer - only shown on Dispatch tab */}
      {activeTab === 'dispatch' && (
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
    </div>
  );
}

const SirenIcon = () => <AlertTriangle size={16} color="#f87171" />;
