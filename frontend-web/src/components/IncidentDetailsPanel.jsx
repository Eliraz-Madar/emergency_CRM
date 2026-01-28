import React, { useMemo, useState } from 'react';
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

    console.log('🚨 Dispatching from IncidentDetailsPanel:', selectedUnitIds, 'to', incident.id);

    // Await the dispatch to ensure routes are calculated
    await dispatchUnitsToIncident({
      incidentId: incident.id,
      unitIds: selectedUnitIds,
      targetPosition: [incidentLat, incidentLng],
    });

    console.log('✅ Dispatch completed');

    // Mark incident as in-progress in dashboard store as well
    updateIncident(incident.id, { status: 'IN_PROGRESS' });
    setSelectedUnitIds([]);
    handleClose();
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

      {/* --- Scrollable Content Wrapper --- */}
      {/* flex-1: תופס את כל המקום שנשאר. overflow-y-auto: גולל אם צריך. min-h-0: מונע באג ב-flex שמבטל גלילה. */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', minHeight: 0 }}>

        {/* Incident Severity Control */}
        <div className="cc-severity-section mb-6">
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
                    transform: isActive ? 'scale(1.02)' : 'scale(1)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {level}
                </button>
              )
            })}
          </div>
        </div>

        {/* Dispatch Forces Section */}
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
                    cursor: 'pointer'
                  }}
                >
                  <Icon size={14} />
                  {label}
                </button>
              );
            })}
          </div>

          {/* Unit List */}
          <div className="cc-list-content flex flex-col gap-1">
            {filteredUnits.length === 0 ? (
              <div className="cc-empty text-center py-8 text-slate-500 italic">No available units of this type</div>
            ) : (
              filteredUnits.map(renderUnitCard)
            )}
          </div>
        </div>
      </div>

      {/* Footer - Fixed Height (shrink-0) */}
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
    </div>
  );
}

const SirenIcon = () => <AlertTriangle size={16} color="#f87171" />;
