import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle } from 'react-leaflet';
import { useDashboardStore } from '../store/dashboard.js';
import { useFieldIncidentStore } from '../store/fieldIncident.js';

/**
 * Map View Component - displays incidents and units on map
 * Can display simulation sectors via props
 * Supports filtering by incident type and shows moving units during simulation
 */
export function MapView({
  simulationSectors = null,
  activeFilter = 'ALL',
  simulationIncident = null,
  simulationUnits = null,
  isSimulation = false,
  selectedUnitIds = [],
  fieldCommands = [],
  onFieldCommandSelect = null,
  selectedFieldCommandId = null,
  onMapCreateFieldCommand = null
}) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const prevStatusRef = useRef(new Map());
  const arrivalAnnouncedRef = useRef(new Set());
  const prevEnRouteRef = useRef(new Set());
  const onMapCreateFieldCommandRef = useRef(onMapCreateFieldCommand);

  useEffect(() => {
    onMapCreateFieldCommandRef.current = onMapCreateFieldCommand;
  }, [onMapCreateFieldCommand]);

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

  // Subscribe directly to the field incident store for strict reactivity
  const fieldIncidents = useFieldIncidentStore((s) => s.incidents || []);

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
  // Single source of truth for "what units does this map render": the active
  // simulation roster during a drill, real online units otherwise.
  const activeUnits = React.useMemo(
    () => (isSimulation ? (simulationUnits || []) : onlineUnits),
    [isSimulation, simulationUnits, onlineUnits]
  );

  // Combine incidents for display; in simulation show only the active simulation incident
  const incidents = React.useMemo(() => {
    if (isSimulation && simulationIncident) {
      return [{
        id: simulationIncident.id || 'sim-incident',
        title: simulationIncident.name || 'Simulation Incident',
        priority: simulationIncident.priority || 'HIGH',
        status: simulationIncident.status || 'IN_PROGRESS',
        channel: simulationIncident.channel || 'SIMULATION',
        location_lat: simulationIncident.lat ?? 31.77,
        location_lng: simulationIncident.lng ?? 35.22,
      }];
    }

    const dashboard = Array.isArray(dashboardIncidents) ? dashboardIncidents : [];
    const field = Array.isArray(fieldIncidents) ? fieldIncidents : [];
    // Combine and deduplicate by id
    const combined = [...dashboard, ...field];
    const uniqueMap = new Map();
    combined.forEach(inc => {
      if (inc && inc.id) {
        uniqueMap.set(inc.id, inc);
      }
    });
    return Array.from(uniqueMap.values());
  }, [dashboardIncidents, fieldIncidents, isSimulation, simulationIncident]);

  // Initialize map
  useEffect(() => {
    if (mapInstanceRef.current) return; // Already initialized

    const map = L.map(mapRef.current).setView([31.77, 35.22], 11); // Center on Tel Aviv

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    map.on('click', (event) => {
      if (onMapCreateFieldCommandRef.current && event?.latlng) {
        onMapCreateFieldCommandRef.current({
          lat: event.latlng.lat,
          lng: event.latlng.lng,
        });
      }
      if (map && map.closePopup) {
        map.closePopup();
      }
    });

    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
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

    // Gather all units dispatched to this incident for bounds fitting
    const fieldUnits = useFieldIncidentStore.getState().units || [];
    const dispatched = fieldUnits.filter((u) => String(u.assignedTo) === String(zoomToIncidentId));

    const validPoints = [
      [incLat, incLng],
      ...dispatched.map((u) => {
        const lat = Array.isArray(u.position) ? u.position[0] : u.location_lat;
        const lng = Array.isArray(u.position) ? u.position[1] : u.location_lng;
        return [lat, lng];
      }).filter(([la, ln]) => Number.isFinite(la) && Number.isFinite(ln)),
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

    // Field command posts are real-world markers — hide them during simulation
    // so the map shows only the simulation incident and units.
    const fieldList = (!isSimulation && Array.isArray(fieldCommands)) ? fieldCommands : [];
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
  }, [incidents, selectedIncidentId, selectedUnitId, simulationSectors, simulationIncident, activeFilter, isSimulation, setSelectedUnit, fieldCommands, onFieldCommandSelect, selectedFieldCommandId, flashingIncidentId, activeUnits]);

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
    </div>
  );
}
