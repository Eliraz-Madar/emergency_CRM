import { useMemo, useState, useEffect } from 'react';
import { EventFeed } from './EventFeed.jsx';
import { Shield, Flame, Ambulance, X, MapPin, AlertTriangle, ChevronRight } from 'lucide-react';
import { useDashboardStore } from '../store/dashboard.js';
import { useFieldIncidentStore } from '../store/fieldIncident.js';

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

export function IncidentDetailsPanel() {
  const {
    incidents: dashboardIncidents,
    selectedIncidentId,
    setSelectedIncident,
    updateIncident,
    selectedUnitIds,
    setSelectedUnitIds,
    setZoomToIncident,
    setFlashingIncident,
    clearFlashingIncident,
  } = useDashboardStore();

  // מושכים את המידע החי מה-Store המבצעי
  const {
    incidents: fieldIncidents,
    units,
    dispatchUnitsToIncident,
    updateIncidentPriority,
    mode: fieldMode,
    majorIncident,
  } = useFieldIncidentStore();

  // בסימולציה: השתמש ב-majorIncident אם אין selectedIncidentId
  // בשגרה: חפש ב-field store ואחרי זה בdashboard
  const incident = useMemo(() => {
    if (!selectedIncidentId && fieldMode === 'SIMULATION' && majorIncident) {
      return majorIncident;
    }

    if (!selectedIncidentId) return null;

    const liveIncident = Array.isArray(fieldIncidents) ? fieldIncidents.find(i => i.id === selectedIncidentId) : null;
    const staticIncident = Array.isArray(dashboardIncidents) ? dashboardIncidents.find(i => i.id === selectedIncidentId) : null;
    return liveIncident || staticIncident;
  }, [selectedIncidentId, fieldIncidents, dashboardIncidents, fieldMode, majorIncident]);

  const [selectedType, setSelectedType] = useState('POLICE');
  const [activeTab, setActiveTab] = useState('dispatch');

  // Reset to dispatch tab whenever a different incident is opened
  useEffect(() => { setActiveTab('dispatch'); }, [incident?.id]);

  // פונקציית העדכון - משתמשת ב-Store החי
  const handlePriorityChange = (newPriority) => {
    if (incident && incident.id) {
      // עדכן גם בשני ה-stores כדי שהמפה תתעדכן
      updateIncidentPriority(incident.id, newPriority);
      updateIncident(incident.id, { priority: newPriority });
    }
  };

  const incidentLat = incident?.location_lat ?? 31.77;
  const incidentLng = incident?.location_lng ?? 35.22;

  const availableUnits = useMemo(() => {
    const base = Array.isArray(units) ? units : [];
    return base
      .filter((u) => u.status === 'PATROL' || u.status === 'AVAILABLE')
      .map((u) => ({
        ...u,
        distance: Array.isArray(u.position) && u.position.length >= 2
          ? getDistanceKm(u.position[0], u.position[1], incidentLat, incidentLng)
          : Infinity,
      }))
      .filter((u) => u.distance !== Infinity)
      .sort((a, b) => a.distance - b.distance);
  }, [units, incidentLat, incidentLng]);

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

  const handleDispatch = async () => {
    if (!incident || selectedUnitIds.length === 0) return;

    await dispatchUnitsToIncident({
      incidentId: incident.id,
      unitIds: selectedUnitIds,
      targetPosition: [incidentLat, incidentLng],
    });

    updateIncident(incident.id, { status: 'IN_PROGRESS' });
    setSelectedUnitIds([]);

    // Keep panel open so the user sees the dispatched units list immediately.
    // Zoom the map to the incident + its units, and flash the marker.
    setZoomToIncident?.(incident.id);
    setFlashingIncident?.(incident.id);
    // Stop flashing after 4 seconds
    setTimeout(() => clearFlashingIncident?.(), 4000);
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

  // Live dispatched units — read directly from the units store (reliable regardless of incident source)
  const dispatchedUnits = useMemo(() => {
    if (!incident?.id) return [];
    const liveUnits = Array.isArray(units) ? units : [];
    return liveUnits
      .filter((u) => String(u.assignedTo) === String(incident.id))
      .map((u) => ({
        id: u.id,
        name: u.name || String(u.id),
        type: u.type || 'POLICE',
        status: u.status || 'EN_ROUTE',
      }));
  }, [incident?.id, units]);

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
