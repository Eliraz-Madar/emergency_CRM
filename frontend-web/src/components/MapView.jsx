import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle } from 'react-leaflet';
import { useDashboardStore } from '../store/dashboard.js';

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * Map View Component - displays incidents and units on map (regional
 * dashboard). Always real, backend-sourced data — no field-incident/
 * simulation store dependency.
 * Supports filtering by incident type.
 */
export function MapView({
  activeFilter = 'ALL',
  selectedUnitIds = [],
  fieldCommands = [],
  onFieldCommandSelect = null,
  selectedFieldCommandId = null,
  onMapCreateFieldCommand = null,
  onMapReportIncident = null,
  onMapDispatchForce = null,
}) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const prevStatusRef = useRef(new Map());
  const arrivalAnnouncedRef = useRef(new Set());
  const prevEnRouteRef = useRef(new Set());
  const onMapCreateFieldCommandRef = useRef(onMapCreateFieldCommand);
  const onMapReportIncidentRef = useRef(onMapReportIncident);
  const onMapDispatchForceRef = useRef(onMapDispatchForce);

  useEffect(() => {
    onMapCreateFieldCommandRef.current = onMapCreateFieldCommand;
  }, [onMapCreateFieldCommand]);

  useEffect(() => {
    onMapReportIncidentRef.current = onMapReportIncident;
  }, [onMapReportIncident]);

  useEffect(() => {
    onMapDispatchForceRef.current = onMapDispatchForce;
  }, [onMapDispatchForce]);

  // Right-click dropdown menu state: { lat, lng, x, y } | null
  const [contextMenu, setContextMenu] = useState(null);
  // Which action modal is open: null | 'INCIDENT' | 'FIELD_HQ' | 'DISPATCH'
  const [activeModal, setActiveModal] = useState(null);
  const [selectedPoint, setSelectedPoint] = useState(null);

  const [incidentForm, setIncidentForm] = useState({
    type: 'POLICE',
    title: '',
    priority: 'HIGH',
    description: '',
  });
  // UI-only helper for the Title field's dropdown — feeds incidentForm.title
  // directly, never reconnected to `type` (which is the Responding Agency /
  // channel value). Not itself sent in the payload.
  const [titleType, setTitleType] = useState('Fire');

  const [fieldHqForm, setFieldHqForm] = useState({
    name: '',
    incidentType: 'MASS_CASUALTY',
    activeForcesNotes: '',
    status: 'Dispatching',
  });

  const [dispatchAgency, setDispatchAgency] = useState('POLICE');
  const [dispatchUnitId, setDispatchUnitId] = useState('');

  const handleCloseContextMenu = useCallback(() => setContextMenu(null), []);

  const handleCloseModal = useCallback(() => {
    setActiveModal(null);
    setSelectedPoint(null);
    setIncidentForm({ type: 'POLICE', title: '', priority: 'HIGH', description: '' });
    setTitleType('Fire');
    setFieldHqForm({ name: '', incidentType: 'MASS_CASUALTY', activeForcesNotes: '', status: 'Dispatching' });
    setDispatchAgency('POLICE');
    setDispatchUnitId('');
  }, []);

  const handleSelectAction = useCallback((actionType) => {
    if (!contextMenu) return;
    setSelectedPoint({ lat: contextMenu.lat, lng: contextMenu.lng });
    setActiveModal(actionType);
    setContextMenu(null);
  }, [contextMenu]);

  const handleCreateIncidentSubmit = useCallback((e) => {
    e.preventDefault();
    if (!selectedPoint) return;
    onMapReportIncidentRef.current?.({
      lat: selectedPoint.lat,
      lng: selectedPoint.lng,
      type: incidentForm.type,
      title: incidentForm.title || incidentForm.type,
      priority: incidentForm.priority,
      description: incidentForm.description,
    });
    handleCloseModal();
  }, [selectedPoint, incidentForm, handleCloseModal]);

  const handleCreateFieldHqSubmit = useCallback((e) => {
    e.preventDefault();
    if (!selectedPoint) return;
    onMapCreateFieldCommandRef.current?.({
      lat: selectedPoint.lat,
      lng: selectedPoint.lng,
      name: fieldHqForm.name,
      incidentType: fieldHqForm.incidentType,
      activeForcesNotes: fieldHqForm.activeForcesNotes,
      status: fieldHqForm.status,
    });
    handleCloseModal();
  }, [selectedPoint, fieldHqForm, handleCloseModal]);

  const handleDispatchSubmit = useCallback((e) => {
    e.preventDefault();
    if (!selectedPoint || !dispatchUnitId) return;
    onMapDispatchForceRef.current?.({
      lat: selectedPoint.lat,
      lng: selectedPoint.lng,
      agency: dispatchAgency,
      unitId: dispatchUnitId,
    });
    handleCloseModal();
  }, [selectedPoint, dispatchAgency, dispatchUnitId, handleCloseModal]);

  const hasAssignedUnits = (incident) => {
    const assignedUnits = Array.isArray(incident?.assignedUnits)
      ? incident.assignedUnits.length
      : 0;
    const assignedIds = Array.isArray(incident?.assigned_unit_ids)
      ? incident.assigned_unit_ids.length
      : 0;
    return assignedUnits > 0 || assignedIds > 0;
  };

  const unitHtml = (emoji, isSelected = false, color = '#3b82f6', status = 'PATROL') => {
    const normalizedStatus = (status || '').toUpperCase();
    const background = normalizedStatus === 'EN_ROUTE'
      ? '#fef3c7'
      : normalizedStatus === 'ON_SCENE'
        ? '#fee2e2'
        : '#ffffff';
    return `
    <div style="
      width: 100%; 
      height: 100%; 
      display: flex; 
      justify-content: center; 
      align-items: center; 
      position: relative;
    ">
      ${isSelected ? `
        <div style="
          position: absolute;
          width: 80px;
          height: 80px;
          border: 4px solid ${color};
          border-radius: 50%;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          animation: pulse 2s ease-in-out infinite;
          pointer-events: none;
        "></div>
      ` : ''}
      <div style="
        width: 60px;
        height: 60px;
        display: flex; 
        justify-content: center; 
        align-items: center; 
        border-radius: 50%; 
        background: ${background}; 
        border: 3px solid ${isSelected ? color : '#1f2937'}; 
        font-size: 35px; 
        line-height: 60px; 
        text-align: center;
        box-shadow: ${isSelected ? `0 0 20px ${color}` : '0 2px 8px rgba(0,0,0,0.3)'};
      ">
        ${emoji}
      </div>
    </div>
  `;
  };

  const createUnitIcon = (type, isSelected = false, status = 'PATROL') => {
    const icons = {
      POLICE: { emoji: '🚓', color: '#3b82f6' },
      FIRE: { emoji: '🚒', color: '#ef4444' },
      MEDICAL: { emoji: '🚑', color: '#10b981' }
    };
    const config = icons[type] || icons.POLICE;
    return L.divIcon({
      className: `marker-unit-${type?.toLowerCase() || 'police'}`,
      html: unitHtml(config.emoji, isSelected, config.color, status),
      iconSize: isSelected ? [90, 90] : [60, 60],
      iconAnchor: isSelected ? [45, 90] : [30, 60],
    });
  };

  const createFieldCommandIcon = (isSelected = false) => {
    const borderColor = isSelected ? '#f59e0b' : '#0f172a';
    return L.divIcon({
      className: 'marker-field-command',
      html: `
        <div style="
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: #111827;
          border: 3px solid ${borderColor};
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.35);
        ">
          🧭
        </div>
      `,
      iconSize: [34, 34],
      iconAnchor: [17, 34],
    });
  };

  const policeIcon = L.divIcon({
    className: 'marker-unit-police',
    html: unitHtml('🚓', false, '#3b82f6'),
    iconSize: [60, 60],
    iconAnchor: [30, 60],
  });

  const fireIcon = L.divIcon({
    className: 'marker-unit-fire',
    html: unitHtml('🚒', false, '#ef4444'),
    iconSize: [60, 60],
    iconAnchor: [30, 60],
  });

  const medicalIcon = L.divIcon({
    className: 'marker-unit-medical',
    html: unitHtml('🚑', false, '#10b981'),
    iconSize: [60, 60],
    iconAnchor: [30, 60],
  });

  // Helper to determine pin color based on priority/severity
  const getPinColor = (priority) => {
    const priorityUpper = (priority || '').toUpperCase();
    if (priorityUpper === 'LOW') return '#10b981'; // Green
    if (priorityUpper === 'MED' || priorityUpper === 'MEDIUM') return '#f59e0b'; // Orange
    if (priorityUpper === 'HIGH' || priorityUpper === 'CRITICAL') return '#ef4444'; // Red
    return '#6b7280'; // Gray default
  };

  const {
    selectedIncidentId,
    setSelectedIncident,
    incidents: dashboardIncidents,
    onlineUnits: dashboardOnlineUnits,
    selectedUnitId,
    setSelectedUnit,
    zoomToIncidentId,
    clearZoomToIncident,
    flashingIncidentId,
  } = useDashboardStore();

  // Real, DB-backed units only, filtered to actively-connected devices.
  // dashboardOnlineUnits comes from GET /api/units/ (real Unit rows, kept
  // fresh by SSE unit_claimed/unit_location_update/unit_disconnected
  // pushes) — never the seeded mock/demo roster. See
  // final changes/04_disable_frontend_map_simulation.md and
  // final changes/05_user_unit_claiming_and_live_sync.md.
  const onlineUnits = React.useMemo(
    () => (Array.isArray(dashboardOnlineUnits) ? dashboardOnlineUnits.filter((u) => u.is_online === true) : []),
    [dashboardOnlineUnits]
  );
  // Single source of truth for "what units does this map render": always
  // real online units — no simulation/field-incident store involved.
  const activeUnits = onlineUnits;

  // Real, DB-backed incidents only.
  const incidents = Array.isArray(dashboardIncidents) ? dashboardIncidents : [];

  // Initialize map
  useEffect(() => {
    if (mapInstanceRef.current) return; // Already initialized

    const map = L.map(mapRef.current).setView([31.77, 35.22], 11); // Center on Tel Aviv

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    map.on('click', () => {
      // Left click is movement/selection only — it must never create anything.
      // Marker-level click handlers (select incident, select field command)
      // still work as before; this just closes any open popup/menu.
      if (map && map.closePopup) {
        map.closePopup();
      }
      setContextMenu(null);
    });

    map.on('contextmenu', (event) => {
      // Right click opens the dedicated operator action menu instead of the
      // browser's native context menu.
      if (event?.originalEvent) {
        event.originalEvent.preventDefault();
        event.originalEvent.stopPropagation();
      }
      if (event?.latlng) {
        setContextMenu({
          lat: event.latlng.lat,
          lng: event.latlng.lng,
          x: event.containerPoint.x,
          y: event.containerPoint.y,
        });
      }
    });

    // Belt-and-suspenders: Leaflet is supposed to call preventDefault
    // internally whenever a 'contextmenu' listener is registered, but this
    // has not been reliable across versions/timing — force it directly on
    // the container so the OS/browser's own right-click menu never shows.
    const suppressNativeMenu = (e) => e.preventDefault();
    map.getContainer().addEventListener('contextmenu', suppressNativeMenu);

    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.getContainer().removeEventListener('contextmenu', suppressNativeMenu);
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Zoom map to a dispatched incident + its units whenever zoomToIncidentId is set
  useEffect(() => {
    if (!zoomToIncidentId || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    const target = incidents.find((i) => i.id === zoomToIncidentId);
    if (!target) { clearZoomToIncident(); return; }

    const incLat = target.location_lat ?? target.lat;
    const incLng = target.location_lng ?? target.lng;
    if (!Number.isFinite(incLat) || !Number.isFinite(incLng)) { clearZoomToIncident(); return; }

    // Gather all real units dispatched to this incident for bounds fitting.
    const dispatched = onlineUnits.filter((u) => String(u.assignedTo) === String(zoomToIncidentId));

    const validPoints = [
      [incLat, incLng],
      ...dispatched
        .map((u) => [u.location_lat, u.location_lng])
        .filter(([la, ln]) => Number.isFinite(la) && Number.isFinite(ln)),
    ];

    try {
      if (validPoints.length > 1) {
        map.flyToBounds(validPoints, { padding: [80, 80], animate: true, duration: 1.2 });
      } else {
        map.flyTo([incLat, incLng], 15, { animate: true, duration: 1.2 });
      }
    } catch { /* ignore Leaflet animation errors */ }

    clearZoomToIncident();
  }, [zoomToIncidentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep Leaflet map stable when container resizes
  useEffect(() => {
    const map = mapInstanceRef.current;
    const container = mapRef.current;
    if (!map || !container) return;

    const invalidate = () => {
      try {
        map.invalidateSize({ animate: false });
      } catch {
        // ignore
      }
    };

    let observer;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => invalidate());
      observer.observe(container);
    }

    window.addEventListener('resize', invalidate);

    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener('resize', invalidate);
    };
  }, []);

  // Update markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Save which popups are currently open before clearing markers
    const openPopups = new Set();
    Object.entries(markersRef.current).forEach(([key, marker]) => {
      if (marker.isPopupOpen && marker.isPopupOpen()) {
        openPopups.add(key);
      }
    });

    // Clear ONLY incident, field command, and route markers - keep unit markers for updates
    Object.keys(markersRef.current).forEach((key) => {
      if (key.startsWith('incident-') || key.startsWith('field-command-') || key.startsWith('route-') || key.startsWith('route-shadow-')) {
        map.removeLayer(markersRef.current[key]);
        delete markersRef.current[key];
      }
    });

    // Simulation mode now relies on incidents array containing only the simulated incident

    // ROUTINE MODE: Add incident markers (with filtering)
    const filteredIncidents = activeFilter === 'ALL'
      ? incidents
      : incidents.filter(inc => {
        const channel = inc.channel?.toUpperCase() || '';
        return channel.includes(activeFilter);
      });

    const setSelectedIncidentId = setSelectedIncident; // alias for clarity

    filteredIncidents.forEach((incident) => {
      const lat = incident.latitude ?? incident.location_lat ?? incident.lat;
      const lng = incident.longitude ?? incident.location_lng ?? incident.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const pinColor = getPinColor(incident.priority || incident.severity);
      const isFlashing = flashingIncidentId != null && flashingIncidentId === incident.id;
      const assignedStar = hasAssignedUnits(incident)
        ? `
          <div style="
            position: absolute;
            top: -10px;
            right: -10px;
            width: 18px;
            height: 18px;
            background: #fbbf24;
            color: #111827;
            border-radius: 50%;
            font-size: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 2px solid #111827;
            box-shadow: 0 1px 2px rgba(0,0,0,0.4);
          ">★</div>
        `
        : '';
      // Pulsing ring shown for ~4 s after units are dispatched to this incident
      const flashRing = isFlashing
        ? `<div class="incident-dispatch-ring"></div>`
        : '';

      const markerSize = isFlashing ? 32 : 24;
      const markerAnchor = isFlashing ? 16 : 12;

      const marker = L.marker(
        [lat, lng],
        {
          icon: L.divIcon({
            html: `
              <div style="position: relative;">
                ${flashRing}
                <div style="background-color: ${pinColor}; width: ${markerSize}px; height: ${markerSize}px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.4); transition: width 0.3s ease, height 0.3s ease;"></div>
                ${assignedStar}
              </div>
            `,
            className: `marker-incident ${selectedIncidentId === incident.id ? 'selected' : ''} ${isFlashing ? 'dispatched' : ''}`,
            iconSize: [markerSize, markerSize],
            iconAnchor: [markerAnchor, markerSize],
          }),
        }
      ).addTo(map);

      const priorityClass =
        incident.priority === 'HIGH' || incident.priority === 'CRITICAL'
          ? 'text-red-500 font-bold'
          : incident.priority === 'MEDIUM' || incident.priority === 'MED'
            ? 'text-orange-500 font-semibold'
            : 'text-green-500';

      marker.on('click', () => {
        setSelectedIncidentId(incident.id);
      });

      marker.bindPopup(`
        <div class="map-popup">
          <strong>${incident.subtype || incident.title || 'Incident'}</strong>
          <p class="${priorityClass}" style="margin: 4px 0;">Priority: ${incident.priority || 'UNKNOWN'}</p>
          <p>Status: ${incident.status || 'UNKNOWN'}</p>
        </div>
      `);

      markersRef.current[`incident-${incident.id}`] = marker;
    });

    const fieldList = Array.isArray(fieldCommands) ? fieldCommands : [];
    fieldList.forEach((field) => {
      const lat = field.location_lat ?? field.lat;
      const lng = field.location_lng ?? field.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const isSelectedField = selectedFieldCommandId && field.id === selectedFieldCommandId;
      const marker = L.marker(
        [lat, lng],
        {
          icon: createFieldCommandIcon(isSelectedField),
        }
      ).addTo(map);

      marker.on('click', () => {
        if (onFieldCommandSelect) {
          onFieldCommandSelect(field);
        }
      });

      marker.bindPopup(`
        <div class="map-popup">
          <strong>${field.name || field.id}</strong>
          <p>Incidents: ${field.incidents_count ?? 0}</p>
          <p>Forces: ${field.units_count ?? 0}</p>
          <button class="field-command-open" style="width:100%; margin-top:8px; padding:8px 10px; border:none; border-radius:6px; background:#2563eb; color:#fff; font-weight:600; cursor:pointer;">
            Open Command
          </button>
        </div>
      `);

      marker.on('popupopen', (event) => {
        const popupEl = event.popup.getElement();
        if (!popupEl) return;
        const button = popupEl.querySelector('.field-command-open');
        if (button) {
          button.onclick = (ev) => {
            ev.preventDefault();
            if (onFieldCommandSelect) {
              onFieldCommandSelect(field);
            }
          };
        }
      });

      markersRef.current[`field-command-${field.id}`] = marker;
    });

    const renderedUnits = Array.isArray(activeUnits) ? activeUnits : [];

    const selectedUnitKey = selectedUnitId === null || selectedUnitId === undefined
      ? null
      : String(selectedUnitId);

    // Draw red route for every EN_ROUTE unit
    renderedUnits.forEach((unit) => {
      if (unit.status !== 'EN_ROUTE') return;
      if (!unit.route || !Array.isArray(unit.route) || unit.route.length === 0) return;

      // Shadow layer for contrast
      const shadowLine = L.polyline(unit.route, {
        color: '#000000',
        weight: 8,
        opacity: 0.2,
        dashArray: '10, 10',
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);
      markersRef.current[`route-shadow-${unit.id}`] = shadowLine;

      // Red route line
      const routeLine = L.polyline(unit.route, {
        color: '#ef4444',
        weight: 5,
        opacity: 0.9,
        dashArray: '8, 8',
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);
      markersRef.current[`route-${unit.id}`] = routeLine;
    });

    renderedUnits.forEach((unit, idx) => {
      const hasPosition = Array.isArray(unit.position) && unit.position.length >= 2;
      const unitLat = hasPosition ? unit.position[0] : (unit.latitude ?? unit.location_lat);
      const unitLng = hasPosition ? unit.position[1] : (unit.longitude ?? unit.location_lng);

      if (unit.status === 'EN_ROUTE') {
        console.log(`🎯 Effect 1 creating unit marker for EN_ROUTE ${unit.id} at [${unitLat}, ${unitLng}]`);
      }

      if (!Number.isFinite(unitLat) || !Number.isFinite(unitLng)) return;

      const markerKey = `unit-${unit.id || idx}`;
      const type = (unit.type || '').toUpperCase();
      const isSelected = selectedUnitIds.includes(unit.id);
      const unitIcon = createUnitIcon(type, isSelected, unit.status);

      // UPDATE existing unit marker OR create new one
      let marker = markersRef.current[markerKey];
      const markerExists = marker && map.hasLayer(marker);
      if (markerExists) {
        // ONLY update icon, NOT position (Effect 2 handles positions)
        marker.setIcon(unitIcon);
      } else {
        // Create new marker (or recreate if it was removed from map)
        marker = L.marker(
          [unitLat, unitLng],
          { icon: unitIcon }
        ).addTo(map);
        markersRef.current[markerKey] = marker;
      }

      const targetIncident = unit.assignedTo ? (incidents || []).find((i) => i.id === unit.assignedTo) : null;
      const unitStatus = unit.status || 'PATROL';

      let statusDisplay = 'Patrol';
      let statusTextColor = '#10b981';
      if (unitStatus === 'EN_ROUTE') {
        statusDisplay = 'En Route';
        statusTextColor = '#f59e0b';
      } else if (unitStatus === 'ON_SCENE') {
        statusDisplay = 'On Scene';
        statusTextColor = '#ef4444';
      } else if (unitStatus === 'AVAILABLE' || unitStatus === 'PATROL') {
        statusDisplay = 'Available';
        statusTextColor = '#10b981';
      }

      const assignedLabel = unit.assignedTo ? 'Yes' : 'No';
      const destinationLabel = unit.assignedTo
        ? (targetIncident?.title || targetIncident?.subtype || targetIncident?.location_name || `Incident ${unit.assignedTo}`)
        : (Array.isArray(unit.assignedTarget) && unit.assignedTarget.length === 2
          ? `${unit.assignedTarget[0].toFixed(5)}, ${unit.assignedTarget[1].toFixed(5)}`
          : 'None');

      const popupContent = `
        <div class="map-popup">
          <strong>${unit.name || `Unit ${idx + 1}`}</strong>
          <p>${unit.type || 'Unknown'}</p>
          <p style="margin: 6px 0; color: ${statusTextColor}; font-weight: 600;">${statusDisplay}</p>
          <p style="margin: 4px 0;"><strong>Assigned:</strong> ${assignedLabel}</p>
          <p style="margin: 4px 0;"><strong>Destination:</strong> ${destinationLabel}</p>
        </div>
      `;

      if (marker.getPopup()) {
        marker.getPopup().setContent(popupContent);
      } else {
        const popup = L.popup({
          autoPan: false, // Don't auto-pan when unit moves
          closeOnClick: true, // Close when clicking elsewhere on map
          autoClose: true, // Close when another popup opens
        }).setContent(popupContent);
        marker.bindPopup(popup);
      }

      marker.off('click');
      marker.on('click', () => {
        if (setSelectedUnit) {
          setSelectedUnit(unit.id !== undefined && unit.id !== null ? String(unit.id) : null);
        }
        marker.openPopup();
      });

      // Reopen popup if it was open before
      if (openPopups.has(markerKey)) {
        marker.openPopup();
      }
    });
  }, [incidents, selectedIncidentId, selectedUnitId, activeFilter, setSelectedUnit, fieldCommands, onFieldCommandSelect, selectedFieldCommandId, flashingIncidentId, activeUnits]);

  // Separate effect ONLY for frequent unit position updates
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const renderedUnits = Array.isArray(activeUnits) ? activeUnits : [];

    // Update positions AND icons (to preserve selection circles)
    renderedUnits.forEach((unit, idx) => {
      const hasPosition = Array.isArray(unit.position) && unit.position.length >= 2;
      const unitLat = hasPosition ? unit.position[0] : (unit.latitude ?? unit.location_lat);
      const unitLng = hasPosition ? unit.position[1] : (unit.longitude ?? unit.location_lng);

      if (!Number.isFinite(unitLat) || !Number.isFinite(unitLng)) {
        console.warn(`⚠️ Unit ${unit.id} has invalid coords: [${unitLat}, ${unitLng}]`);
        return;
      }

      const markerKey = `unit-${unit.id || idx}`;
      const marker = markersRef.current[markerKey];

      if (marker && map.hasLayer(marker)) {
        if (Math.abs(marker.getLatLng().lat - unitLat) > 0.00001 || Math.abs(marker.getLatLng().lng - unitLng) > 0.00001) {
          marker.setLatLng([unitLat, unitLng]);
        }

        // ALWAYS update icon to preserve selection state
        const type = (unit.type || '').toUpperCase();
        const isSelected = selectedUnitIds.includes(unit.id);
        const unitIcon = createUnitIcon(type, isSelected, unit.status);
        marker.setIcon(unitIcon);
      }

      // Arrival notification when unit reaches ON_SCENE
      if (unit.id) {
        const prevStatus = prevStatusRef.current.get(unit.id);
        // Only announce for units the operator personally dispatched.
        // Scenario-script units (isScenarioUnit: true) transition EN_ROUTE → ON_SCENE
        // automatically — we must NOT voice-announce those.
        if (unit.status === 'ON_SCENE' && prevStatus === 'EN_ROUTE' && !unit.isScenarioUnit) {
          if (!arrivalAnnouncedRef.current.has(unit.id)) {
            arrivalAnnouncedRef.current.add(unit.id);

            const unitLabel = unit.name || `Unit ${unit.id}`;
            const message = `${unitLabel} has arrived at the incident and is beginning operations.`;

            // Popup near the unit
            if (Number.isFinite(unitLat) && Number.isFinite(unitLng)) {
              const popup = L.popup({
                autoPan: false,
                closeButton: false,
                className: 'unit-arrival-popup',
              })
                .setLatLng([unitLat, unitLng])
                .setContent(`<div style="font-weight:600; padding:4px 6px;">${message}</div>`);
              popup.openOn(map);
              setTimeout(() => {
                if (map && map.closePopup) {
                  map.closePopup(popup);
                }
              }, 3000);
            }

            // Voice notification
            if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
              const utterance = new SpeechSynthesisUtterance(message);
              utterance.lang = 'en-US';
              window.speechSynthesis.speak(utterance);
            }
          }
        } else if (unit.status !== 'ON_SCENE') {
          arrivalAnnouncedRef.current.delete(unit.id);
        }
        prevStatusRef.current.set(unit.id, unit.status);
      }
    });
  }, [activeUnits, selectedUnitIds]);

  // Fly to selected incident when changed from list selection
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedIncidentId) return;

    const targetIncident = (incidents || []).find((inc) => inc.id === selectedIncidentId);
    if (!targetIncident || !Number.isFinite(targetIncident.location_lat) || !Number.isFinite(targetIncident.location_lng)) {
      return;
    }

    const dest = [targetIncident.location_lat, targetIncident.location_lng];
    map.flyTo(dest, 14, { animate: true, duration: 1.5 });

    const incidentMarker = markersRef.current[`incident-${targetIncident.id}`];
    if (incidentMarker && incidentMarker.openPopup) {
      incidentMarker.openPopup();
    }
  }, [selectedIncidentId, incidents]);

  // Auto-zoom to show all dispatched (EN_ROUTE) units when new ones are dispatched
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const renderedUnits = Array.isArray(activeUnits) ? activeUnits : [];

    const enRouteUnits = renderedUnits.filter(u => u.status === 'EN_ROUTE');
    const currentEnRouteIds = new Set(enRouteUnits.map(u => u.id));

    // Only zoom if there are NEW EN_ROUTE units (i.e. just dispatched)
    const hasNewEnRoute = enRouteUnits.some(u => !prevEnRouteRef.current.has(u.id));
    prevEnRouteRef.current = currentEnRouteIds;

    if (!hasNewEnRoute || enRouteUnits.length === 0) return;

    // Build bounds: include every EN_ROUTE unit position
    const points = enRouteUnits
      .map(u => {
        if (Array.isArray(u.position) && u.position.length >= 2) return u.position;
        const lat = u.latitude ?? u.location_lat;
        const lng = u.longitude ?? u.location_lng;
        if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
        return null;
      })
      .filter(Boolean);

    // Also include the target incident location so it's in frame
    enRouteUnits.forEach(u => {
      if (!u.assignedTo) return;
      const inc = incidents.find(i => String(i.id) === String(u.assignedTo));
      if (inc && Number.isFinite(inc.location_lat) && Number.isFinite(inc.location_lng)) {
        points.push([inc.location_lat, inc.location_lng]);
      }
    });

    if (points.length === 0) return;

    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [80, 80], maxZoom: 14, animate: true });
  }, [activeUnits, incidents]);

  // Units eligible for dispatch: matching agency, not already committed
  // (EN_ROUTE / ON_SCENE), sorted nearest-first to the right-clicked point.
  const sortedAvailableUnits = (() => {
    if (!selectedPoint) return [];
    const pool = (Array.isArray(activeUnits) ? activeUnits : []).filter((unit) => {
      const status = (unit.status || '').toUpperCase();
      if (status === 'EN_ROUTE' || status === 'ON_SCENE') return false;
      if ((unit.type || '').toUpperCase() !== dispatchAgency) return false;
      return true;
    });
    return pool
      .map((unit) => {
        const hasPosition = Array.isArray(unit.position) && unit.position.length >= 2;
        const uLat = hasPosition ? unit.position[0] : (unit.latitude ?? unit.location_lat);
        const uLng = hasPosition ? unit.position[1] : (unit.longitude ?? unit.location_lng);
        return {
          ...unit,
          distanceKm: calculateDistanceKm(selectedPoint.lat, selectedPoint.lng, uLat, uLng),
        };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm);
  })();

  return (
    <div className="map-container">
      {/* React-leaflet render to force reactive marker updates */}
      <MapContainer center={[31.77, 35.22]} zoom={11} style={{ height: '0px', width: '0px', position: 'absolute', opacity: 0, pointerEvents: 'none' }}>
        <TileLayer
          attribution="© OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {incidents.map((incident) => {
          const lat = incident.latitude ?? incident.location_lat ?? incident.lat;
          const lng = incident.longitude ?? incident.location_lng ?? incident.lng;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          const priorityClass =
            incident.priority === 'HIGH' || incident.priority === 'CRITICAL'
              ? 'text-red-500'
              : incident.priority === 'MEDIUM' || incident.priority === 'MED'
                ? 'text-orange-500'
                : 'text-green-500';

          // Dynamic color based on priority
          const color = getPinColor(incident.priority);
          const assignedStar = hasAssignedUnits(incident)
            ? `<div style='position:absolute; top:-10px; right:-10px; width:18px; height:18px; background:#fbbf24; color:#111827; border-radius:50%; font-size:12px; display:flex; align-items:center; justify-content:center; border:2px solid #111827; box-shadow:0 1px 2px rgba(0,0,0,0.4);'>★</div>`
            : '';
          const pinHtml = `<div style='position:relative;'><div style='background-color: ${color}; width: 24px; height: 24px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px ${color};'></div>${assignedStar}</div>`;
          const customIcon = L.divIcon({ html: pinHtml, className: 'marker-pin', iconSize: [24, 24], iconAnchor: [12, 12] });

          return (
            <Marker
              key={`inc-${incident.id}`}
              position={[lat, lng]}
              icon={customIcon}
              eventHandlers={{ click: () => setSelectedIncident(incident.id) }}
            >
              <Popup>
                <h3>{incident.subtype || incident.title || 'Incident'}</h3>
                <p className={priorityClass}>Priority: {incident.priority || 'UNKNOWN'}</p>
                <p>Status: {incident.status || 'UNKNOWN'}</p>
              </Popup>
            </Marker>
          );
        })}

        {activeUnits.map((unit, idx) => {
          const hasPosition = Array.isArray(unit.position) && unit.position.length >= 2;
          const unitLat = hasPosition ? unit.position[0] : unit.latitude;
          const unitLng = hasPosition ? unit.position[1] : unit.longitude;
          if (!Number.isFinite(unitLat) || !Number.isFinite(unitLng)) return null;
          return (
            <Marker
              key={`unit-rfl-${unit.id || idx}`}
              position={[unitLat, unitLng]}
              icon={policeIcon}
            />
          );
        })}
      </MapContainer>

      {/* Existing Leaflet map (visible) */}
      <div ref={mapRef} className="map-view" />
      <div className="map-legend">
        <div className="legend-item">
          <span className="legend-icon" style={{ backgroundColor: '#ef4444' }}>●</span>
          <span>Critical</span>
        </div>
        <div className="legend-item">
          <span className="legend-icon" style={{ backgroundColor: '#f59e0b' }}>●</span>
          <span>High / Dispatched</span>
        </div>
        <div className="legend-item">
          <span className="legend-icon" style={{ backgroundColor: '#eab308' }}>●</span>
          <span>Medium</span>
        </div>
        <div className="legend-item">
          <span className="legend-icon" style={{ backgroundColor: '#3b82f6' }}>●</span>
          <span>Low / Available</span>
        </div>
        <div className="legend-item">
          <span className="legend-icon" style={{ backgroundColor: '#6b7280' }}>●</span>
          <span>Offline</span>
        </div>
      </div>

      {/* Right-click operator action menu */}
      {contextMenu && (
        <>
          <div
            onClick={handleCloseContextMenu}
            style={{ position: 'absolute', inset: 0, zIndex: 998 }}
          />
          <div
            style={{
              position: 'absolute',
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 999,
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              minWidth: '230px',
              overflow: 'hidden',
              color: '#e2e8f0',
              fontSize: '0.875rem',
            }}
          >
            <button
              type="button"
              onClick={() => handleSelectAction('INCIDENT')}
              style={menuItemStyle}
            >
              🚨 Report Standard Incident
            </button>
            <button
              type="button"
              onClick={() => handleSelectAction('FIELD_HQ')}
              style={menuItemStyle}
            >
              🏢 Open Field Command Post
            </button>
            <button
              type="button"
              onClick={() => handleSelectAction('DISPATCH')}
              style={{ ...menuItemStyle, borderBottom: 'none' }}
            >
              ⚡ Dispatch Force
            </button>
          </div>
        </>
      )}

      {/* Action modals */}
      {activeModal && (
        <div
          onClick={handleCloseModal}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '10px',
              padding: '20px',
              width: '360px',
              maxWidth: '90%',
              color: '#e2e8f0',
            }}
          >
            {activeModal === 'INCIDENT' && (
              <form onSubmit={handleCreateIncidentSubmit}>
                <h3 style={{ margin: '0 0 12px 0', color: '#38bdf8' }}>🚨 Report Standard Incident</h3>
                <label style={labelStyle}>Responding Agency</label>
                <select
                  value={incidentForm.type}
                  onChange={(e) => setIncidentForm({ ...incidentForm, type: e.target.value })}
                  style={inputStyle}
                >
                  <option value="POLICE">👮 Police</option>
                  <option value="EMS">🚑 EMS</option>
                  <option value="FIRE">🚒 Fire &amp; Rescue</option>
                </select>

                <label style={labelStyle}>Incident Type</label>
                <select
                  value={titleType}
                  onChange={(e) => {
                    const value = e.target.value;
                    setTitleType(value);
                    setIncidentForm({ ...incidentForm, title: value === 'Other' ? '' : value });
                  }}
                  style={inputStyle}
                >
                  <option value="Fire">Fire</option>
                  <option value="Traffic Accident">Traffic Accident</option>
                  <option value="Theft">Theft</option>
                  <option value="Criminal Activity">Criminal Activity</option>
                  <option value="Medical Emergency">Medical Emergency</option>
                  <option value="Other">Other</option>
                </select>

                <label style={labelStyle}>Title</label>
                <input
                  type="text"
                  placeholder={titleType === 'Other' ? 'Specify a custom title...' : 'e.g. Structure Fire on Main St.'}
                  value={incidentForm.title}
                  onChange={(e) => setIncidentForm({ ...incidentForm, title: e.target.value })}
                  style={inputStyle}
                  required
                />

                <label style={labelStyle}>Priority</label>
                <select
                  value={incidentForm.priority}
                  onChange={(e) => setIncidentForm({ ...incidentForm, priority: e.target.value })}
                  style={inputStyle}
                >
                  <option value="LOW">Low</option>
                  <option value="MED">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>

                <label style={labelStyle}>Details</label>
                <textarea
                  placeholder="Additional details..."
                  value={incidentForm.description}
                  onChange={(e) => setIncidentForm({ ...incidentForm, description: e.target.value })}
                  style={{ ...inputStyle, minHeight: '60px' }}
                />

                <div style={actionsRowStyle}>
                  <button type="button" onClick={handleCloseModal} style={cancelButtonStyle}>Cancel</button>
                  <button type="submit" style={{ ...submitButtonStyle, background: '#0284c7' }}>Create</button>
                </div>
              </form>
            )}

            {activeModal === 'FIELD_HQ' && (
              <form onSubmit={handleCreateFieldHqSubmit}>
                <h3 style={{ margin: '0 0 12px 0', color: '#fbbf24' }}>🏢 Open Field Command Post</h3>
                <label style={labelStyle}>Command Name</label>
                <input
                  type="text"
                  placeholder="Field Command Post Alpha"
                  value={fieldHqForm.name}
                  onChange={(e) => setFieldHqForm({ ...fieldHqForm, name: e.target.value })}
                  style={inputStyle}
                  required
                />

                <label style={labelStyle}>Incident Classification</label>
                <select
                  value={fieldHqForm.incidentType}
                  onChange={(e) => setFieldHqForm({ ...fieldHqForm, incidentType: e.target.value })}
                  style={inputStyle}
                >
                  <option value="MASS_CASUALTY">Mass Casualty Incident (MCI)</option>
                  <option value="WILDFIRE">Major Wildfire</option>
                  <option value="EARTHQUAKE">Earthquake Disaster</option>
                  <option value="HAZMAT">HAZMAT Emergency</option>
                  <option value="OTHER">Other</option>
                </select>

                <label style={labelStyle}>Status of Forces Present / En Route</label>
                <textarea
                  placeholder="List active or responding units..."
                  value={fieldHqForm.activeForcesNotes}
                  onChange={(e) => setFieldHqForm({ ...fieldHqForm, activeForcesNotes: e.target.value })}
                  style={{ ...inputStyle, minHeight: '60px' }}
                />

                <label style={labelStyle}>Initial Status</label>
                <select
                  value={fieldHqForm.status}
                  onChange={(e) => setFieldHqForm({ ...fieldHqForm, status: e.target.value })}
                  style={inputStyle}
                >
                  <option value="Dispatching">Dispatching</option>
                  <option value="Active">Active</option>
                  <option value="Standby">Standby</option>
                </select>

                <div style={actionsRowStyle}>
                  <button type="button" onClick={handleCloseModal} style={cancelButtonStyle}>Cancel</button>
                  <button type="submit" style={{ ...submitButtonStyle, background: '#d97706' }}>Establish HQ</button>
                </div>
              </form>
            )}

            {activeModal === 'DISPATCH' && (
              <form onSubmit={handleDispatchSubmit}>
                <h3 style={{ margin: '0 0 12px 0', color: '#4ade80' }}>⚡ Dispatch Force to Point</h3>
                <label style={labelStyle}>Select Service</label>
                <select
                  value={dispatchAgency}
                  onChange={(e) => {
                    setDispatchAgency(e.target.value);
                    setDispatchUnitId('');
                  }}
                  style={inputStyle}
                >
                  <option value="POLICE">👮 Police</option>
                  <option value="EMS">🚑 EMS</option>
                  <option value="FIRE">🚒 Fire &amp; Rescue</option>
                </select>

                <label style={labelStyle}>Available Units (nearest first)</label>
                <select
                  value={dispatchUnitId}
                  onChange={(e) => setDispatchUnitId(e.target.value)}
                  style={inputStyle}
                  required
                >
                  <option value="">-- Select Unit --</option>
                  {sortedAvailableUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name || `Unit #${u.id}`} ({Number.isFinite(u.distanceKm) ? `${u.distanceKm.toFixed(1)} km` : 'No GPS'})
                    </option>
                  ))}
                </select>

                {sortedAvailableUnits.length === 0 && (
                  <div style={{ color: '#f87171', fontSize: '0.8rem', marginTop: '4px' }}>
                    No available units found for the selected service.
                  </div>
                )}

                <div style={actionsRowStyle}>
                  <button type="button" onClick={handleCloseModal} style={cancelButtonStyle}>Cancel</button>
                  <button
                    type="submit"
                    disabled={!dispatchUnitId}
                    style={{
                      ...submitButtonStyle,
                      background: dispatchUnitId ? '#16a34a' : '#334155',
                      cursor: dispatchUnitId ? 'pointer' : 'not-allowed',
                    }}
                  >
                    Dispatch
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const menuItemStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '10px 14px',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid #334155',
  color: '#e2e8f0',
  cursor: 'pointer',
  fontSize: '0.875rem',
};

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

const actionsRowStyle = { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px' };

const cancelButtonStyle = {
  background: '#475569',
  border: 'none',
  color: '#fff',
  padding: '7px 14px',
  borderRadius: '6px',
  cursor: 'pointer',
};

const submitButtonStyle = {
  border: 'none',
  color: '#fff',
  padding: '7px 14px',
  borderRadius: '6px',
  cursor: 'pointer',
  fontWeight: 'bold',
};
