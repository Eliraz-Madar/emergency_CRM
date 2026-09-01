import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useDashboardStore } from '../store/dashboard.js';
import { getSortedAvailableUnits } from '../utils/units.js';
import { getUnitTypeMeta, getIncidentChannelMeta } from '../utils/agencyMeta.js';
import { ANNOUNCE_EVENT } from '../utils/announce.js';

// The "on its way" / "arrived" map bubble and the spoken line are BOTH driven
// from Dashboard.jsx's SSE handlers via announceOnce() — one dedup gate
// (localStorage), one fire per real backend broadcast. This component no
// longer infers an announcement from a unit's client-side status (which could
// flip to ON_SCENE for reasons other than a real crew arrival, and whose
// per-mount guards evaporated on every route navigation). It just listens for
// the `ecm-announce` event and drops the bubble on the right marker.

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
  // unitId set that was EN_ROUTE on the previous render — used only to pan the
  // camera towards a unit that just went en route (no announcement here).
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
    fieldCommandId: '',
  });
  // UI-only helper for the Title field's dropdown — feeds incidentForm.title
  // directly, never reconnected to `type` (which is the Responding Agency /
  // channel value). Not itself sent in the payload.
  const [titleType, setTitleType] = useState('Fire');

  const [dispatchAgency, setDispatchAgency] = useState('POLICE');
  const [dispatchUnitId, setDispatchUnitId] = useState('');

  const handleCloseContextMenu = useCallback(() => setContextMenu(null), []);

  const handleCloseModal = useCallback(() => {
    setActiveModal(null);
    setSelectedPoint(null);
    setIncidentForm({ type: 'POLICE', title: '', priority: 'HIGH', description: '', fieldCommandId: '' });
    setTitleType('Fire');
    setDispatchAgency('POLICE');
    setDispatchUnitId('');
  }, []);

  const handleSelectAction = useCallback((actionType) => {
    if (!contextMenu) return;
    const point = { lat: contextMenu.lat, lng: contextMenu.lng };
    if (actionType === 'FIELD_HQ') {
      // No intermediate popup — this used to open its own modal whose
      // submit discarded everything typed and only ever forwarded the
      // coordinates anyway (see Stage 2 diagnosis). Dashboard.jsx's own
      // Create Field Command modal opens immediately with just the point.
      onMapCreateFieldCommandRef.current?.(point);
      setContextMenu(null);
      return;
    }
    setSelectedPoint(point);
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
      fieldCommandId: incidentForm.fieldCommandId || null,
    });
    handleCloseModal();
  }, [selectedPoint, incidentForm, handleCloseModal]);

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
    // Callers pass the raw backend Unit.type, uppercased
    // ("POLICE"/"FIRE"/"EMS"/"HOMEFRONT"). The shared palette
    // (utils/agencyMeta.js) covers all four — EMS gets an ambulance, HomeFront
    // a house (both previously fell through to a blue police car).
    const config = getUnitTypeMeta({ type });
    return L.divIcon({
      className: `marker-unit-${(type || 'police').toLowerCase()}`,
      html: unitHtml(config.emoji, isSelected, config.color, status),
      iconSize: isSelected ? [90, 90] : [60, 60],
      iconAnchor: isSelected ? [45, 90] : [30, 60],
    });
  };

  const createFieldCommandIcon = (isSelected = false) => {
    const borderColor = isSelected ? '#f59e0b' : '#1d4ed8';
    // A planted command flag on a mast — reads as "field command post
    // established here", clearly distinct from the round unit markers and the
    // teardrop incident pins.
    return L.divIcon({
      className: 'marker-field-command',
      html: `
        <div style="position: relative; width: 40px; height: 44px;">
          <div style="
            position: absolute; left: 4px; top: 0;
            width: 40px; height: 40px;
            border-radius: 10px;
            background: #0b1220;
            border: 3px solid ${borderColor};
            display: flex; align-items: center; justify-content: center;
            font-size: 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
          ">🎖️</div>
          <div style="
            position: absolute; left: 0; bottom: -3px;
            width: 4px; height: 24px; background: ${borderColor};
            border-radius: 2px;
          "></div>
        </div>
      `,
      iconSize: [40, 44],
      iconAnchor: [2, 44],
    });
  };

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
    zoomToFieldCommand,
    clearZoomToFieldCommand,
    flashingIncidentId,
    spotlightIncidentIds,
    spotlightNonce,
    clearSpotlightIncidents,
    getFilteredIncidents,
    filters,
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

  // The "on its way" / "arrived" map bubble. Fired by Dashboard.jsx's SSE
  // handlers via announceOnce() -> `ecm-announce` window event, so it rides
  // the SAME once-per-broadcast localStorage dedup gate as the spoken line and
  // can never double up on a remount or a client-inferred status change.
  useEffect(() => {
    const onAnnounce = (e) => {
      const map = mapInstanceRef.current;
      const detail = e?.detail || {};
      if (!map || detail.unitId == null || !detail.message) return;
      const marker = markersRef.current[`unit-${detail.unitId}`];
      const at = marker && map.hasLayer(marker) ? marker.getLatLng() : null;
      if (!at) return;
      const popup = L.popup({ autoPan: false, closeButton: false, className: 'unit-arrival-popup' })
        .setLatLng(at)
        .setContent(`<div style="font-weight:600; padding:4px 6px;">${detail.message}</div>`);
      popup.openOn(map);
      setTimeout(() => { if (map && map.closePopup) map.closePopup(popup); }, 3000);
    };
    window.addEventListener(ANNOUNCE_EVENT, onAnnounce);
    return () => window.removeEventListener(ANNOUNCE_EVENT, onAnnounce);
  }, []);

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
      // still work as before — L.Marker defaults to bubblingMouseEvents:
      // false, so a marker click never reaches this handler, only genuine
      // empty-space clicks do. This just closes any open popup/menu, and
      // also closes the incident details panel the same way the X
      // button/Escape do.
      if (map && map.closePopup) {
        map.closePopup();
      }
      setContextMenu(null);
      setSelectedIncident(null);
      // Also drop any selected vehicle — an empty-map click means "deselect
      // everything", same as the incident panel's own dismiss.
      setSelectedUnit(null);
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
      const bounds = L.latLngBounds(validPoints);
      // Don't disturb the view if the incident (and its units) are already
      // on screen, and never zoom the operator out — pan at the current zoom.
      if (!map.getBounds().pad(-0.15).contains(bounds)) {
        map.panTo(bounds.getCenter(), { animate: true, duration: 1.0 });
      }
    } catch { /* ignore Leaflet animation errors */ }

    clearZoomToIncident();
  }, [zoomToIncidentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Jump the map to a field command post's marker (clicked in the KPI card).
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!zoomToFieldCommand?.id || !map) return;
    const fc = (Array.isArray(fieldCommands) ? fieldCommands : [])
      .find((f) => String(f.id) === String(zoomToFieldCommand.id));
    const lat = fc?.location_lat ?? fc?.lat;
    const lng = fc?.location_lng ?? fc?.lng;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      map.flyTo([lat, lng], Math.max(map.getZoom(), 14), { animate: true, duration: 1.0 });
    }
    clearZoomToFieldCommand();
  }, [zoomToFieldCommand?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Spotlight" a group of incidents (KPI header buttons): zoom the map OUT so
  // every one of them is visible, then let their markers flash for a moment
  // (~3 pulses of the 0.75s dispatch ring) before clearing.
  useEffect(() => {
    if (!spotlightNonce || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const ids = new Set((spotlightIncidentIds || []).map(String));
    const points = incidents
      .filter((i) => ids.has(String(i.id)))
      .map((i) => [i.location_lat ?? i.lat, i.location_lng ?? i.lng])
      .filter(([la, ln]) => Number.isFinite(la) && Number.isFinite(ln));
    if (points.length > 0) {
      try {
        if (points.length === 1) {
          map.flyTo(points[0], Math.min(map.getZoom(), 13), { duration: 0.8 });
        } else {
          map.flyToBounds(L.latLngBounds(points), { padding: [70, 70], duration: 0.8, maxZoom: 13 });
        }
      } catch { /* ignore Leaflet animation errors */ }
    }
    // ~3 pulses of the 0.75s dispatch ring.
    const t = setTimeout(() => clearSpotlightIncidents(), 2400);
    return () => clearTimeout(t);
  }, [spotlightNonce]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Remove stale unit markers — a unit that went offline / was released (so
    // it's no longer in activeUnits) must not leave a ghost car on the map.
    const liveUnitKeys = new Set(
      (Array.isArray(activeUnits) ? activeUnits : []).map((u) => `unit-${u.id}`),
    );
    Object.keys(markersRef.current).forEach((key) => {
      if (key.startsWith('unit-') && !liveUnitKeys.has(key)) {
        map.removeLayer(markersRef.current[key]);
        delete markersRef.current[key];
      }
    });

    // Simulation mode now relies on incidents array containing only the simulated incident

    // Add incident markers. Use the exact same filtered set the sidebar list
    // renders (store.getFilteredIncidents — hides CLOSED + whatever the
    // FilterBar chips/search exclude) so the map marker count and the
    // "Incidents (N)" header never disagree. The channel tab (ALL/FIRE/...)
    // is applied on top, matching IncidentList.
    const openIncidents = getFilteredIncidents();
    const filteredIncidents = activeFilter === 'ALL'
      ? openIncidents
      : openIncidents.filter(inc => {
        const channel = inc.channel?.toUpperCase() || '';
        return channel.includes(activeFilter);
      });

    const setSelectedIncidentId = setSelectedIncident; // alias for clarity

    filteredIncidents.forEach((incident) => {
      const lat = incident.latitude ?? incident.location_lat ?? incident.lat;
      const lng = incident.longitude ?? incident.location_lng ?? incident.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const pinColor = getPinColor(incident.priority || incident.severity);
      const isFlashing = (flashingIncidentId != null && flashingIncidentId === incident.id)
        || (Array.isArray(spotlightIncidentIds)
          && spotlightIncidentIds.some((sid) => String(sid) === String(incident.id)));
      // "Dispatch Force to Point" (MapView's right-click menu, via
      // Dashboard.jsx's handleMapDispatchForce) auto-creates a minimal
      // Incident just to carry a direct point-dispatch — it isn't a real
      // reported incident, so it gets a distinct diamond+bolt marker instead
      // of the standard circle, using this hardcoded description as the only
      // signal available (there's no dedicated backend flag for it).
      const isPointDispatch = incident.description === 'Force dispatched directly from the map.';
      // Shared agency palette (utils/agencyMeta.js), keyed by incident.channel
      // (set to the dispatched agency — "POLICE"/"FIRE"/"EMS" — in Dashboard.jsx's
      // handleMapDispatchForce), so a point-dispatch marker matches the
      // color/vehicle of the unit that was actually sent. Unknown channel →
      // a ⚡ bolt in the priority colour, not the generic 🚨.
      const dispatchAgencyMeta = getIncidentChannelMeta(incident, { emoji: '⚡', color: pinColor });
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

      const shapeHtml = isPointDispatch
        ? `<div style="width: ${markerSize}px; height: ${markerSize}px; background-color: ${dispatchAgencyMeta.color}; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.4); transition: width 0.3s ease, height 0.3s ease; transform: rotate(45deg); display: flex; align-items: center; justify-content: center;">
             <span style="transform: rotate(-45deg); font-size: ${markerSize * 0.5}px; line-height: 1;">${dispatchAgencyMeta.emoji}</span>
           </div>`
        : `<div style="background-color: ${pinColor}; width: ${markerSize}px; height: ${markerSize}px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.4); transition: width 0.3s ease, height 0.3s ease;"></div>`;

      const marker = L.marker(
        [lat, lng],
        {
          icon: L.divIcon({
            html: `
              <div style="position: relative;">
                ${flashRing}
                ${shapeHtml}
                ${assignedStar}
              </div>
            `,
            className: `marker-incident ${isPointDispatch ? 'point-dispatch' : ''} ${selectedIncidentId === incident.id ? 'selected' : ''} ${isFlashing ? 'dispatched' : ''}`,
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
          ${isPointDispatch ? `<p style="margin: 0 0 4px 0; color: ${dispatchAgencyMeta.color}; font-size: 11px; font-weight: bold;">${dispatchAgencyMeta.emoji} DIRECT POINT DISPATCH</p>` : ''}
          <strong>${incident.subtype || incident.title || 'Incident'}</strong>
          <p class="${priorityClass}" style="margin: 4px 0;">Priority: ${incident.priority || 'UNKNOWN'}</p>
          <p>Status: ${incident.status || 'UNKNOWN'}</p>
        </div>
      `);

      markersRef.current[`incident-${incident.id}`] = marker;
    });

    // Closed field command posts never get a marker either — same rationale
    // as openIncidents above. "CLOSED" matches FieldCommand.Status.CLOSED
    // exactly (backend/api/models.py).
    const fieldList = (Array.isArray(fieldCommands) ? fieldCommands : []).filter((f) => f.status !== 'CLOSED');
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
      } else if (unitStatus === 'ASSIGNED') {
        statusDisplay = 'Awaiting acceptance';
        statusTextColor = '#38bdf8';
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
  }, [incidents, filters, selectedIncidentId, selectedUnitId, activeFilter, setSelectedUnit, fieldCommands, onFieldCommandSelect, selectedFieldCommandId, flashingIncidentId, spotlightIncidentIds, activeUnits]);

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

      // The "on its way" / "arrived" bubbles are NOT decided here anymore —
      // see the `ecm-announce` listener effect above. This effect only keeps
      // the marker positions and icons in sync.
    });
  }, [activeUnits, selectedUnitIds]);

  // Pan to a newly-selected incident. Runs only when the SELECTION changes
  // (not on every incidents-array update), never zooms the operator out — it
  // keeps the current zoom and only zooms in if they were further out than 14 —
  // and does nothing if the marker is already comfortably in view.
  const flownToIncidentRef = useRef(null);
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedIncidentId) {
      flownToIncidentRef.current = null;
      return;
    }
    if (flownToIncidentRef.current === selectedIncidentId) return;

    const targetIncident = (incidents || []).find((inc) => inc.id === selectedIncidentId);
    if (!targetIncident || !Number.isFinite(targetIncident.location_lat) || !Number.isFinite(targetIncident.location_lng)) {
      return;
    }
    flownToIncidentRef.current = selectedIncidentId;

    const dest = L.latLng(targetIncident.location_lat, targetIncident.location_lng);
    const incidentMarker = markersRef.current[`incident-${targetIncident.id}`];
    if (!map.getBounds().pad(-0.25).contains(dest)) {
      map.flyTo(dest, Math.max(map.getZoom(), 14), { animate: true, duration: 1.0 });
    }
    if (incidentMarker && incidentMarker.openPopup) {
      incidentMarker.openPopup();
    }
  }, [selectedIncidentId, incidents]);

  // When a unit is freshly dispatched, make sure the action is on screen — but
  // never yank the operator's zoom out. If the unit + its incident are already
  // (even partly) visible we leave the view alone; otherwise we pan to the
  // midpoint keeping the current zoom.
  const firstEnRouteFrameRef = useRef(false);
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const renderedUnits = Array.isArray(activeUnits) ? activeUnits : [];
    const enRouteUnits = renderedUnits.filter(u => u.status === 'EN_ROUTE');
    const currentEnRouteIds = new Set(enRouteUnits.map(u => u.id));

    const newlyEnRoute = enRouteUnits.filter(u => !prevEnRouteRef.current.has(u.id));
    prevEnRouteRef.current = currentEnRouteIds;

    // Skip the batch that first appears on mount (rebuilt from DB assignments) —
    // only react to units that go en route while the operator is watching.
    if (!firstEnRouteFrameRef.current) {
      firstEnRouteFrameRef.current = true;
      return;
    }
    if (newlyEnRoute.length === 0) return;

    const points = [];
    newlyEnRoute.forEach(u => {
      const lat = (Array.isArray(u.position) && u.position[0]) ?? u.latitude ?? u.location_lat;
      const lng = (Array.isArray(u.position) && u.position[1]) ?? u.longitude ?? u.location_lng;
      if (Number.isFinite(lat) && Number.isFinite(lng)) points.push([lat, lng]);
      const inc = u.assignedTo ? incidents.find(i => String(i.id) === String(u.assignedTo)) : null;
      if (inc && Number.isFinite(inc.location_lat) && Number.isFinite(inc.location_lng)) {
        points.push([inc.location_lat, inc.location_lng]);
      }
    });
    if (points.length === 0) return;

    const bounds = L.latLngBounds(points);
    // Already visible? Don't touch the view.
    if (map.getBounds().pad(-0.15).contains(bounds)) return;
    // Otherwise pan (no zoom change) so we never zoom the operator out.
    map.panTo(bounds.getCenter(), { animate: true, duration: 0.8 });
  }, [activeUnits, incidents]);

  // Units eligible for dispatch: matching agency, not already committed
  // (EN_ROUTE / ON_SCENE), not already attached to a FieldCommand, sorted
  // nearest-first to the right-clicked point. Shared with the FieldCommand
  // creation modal's unit checklist (Dashboard.jsx) — see utils/units.js.
  const sortedAvailableUnits = getSortedAvailableUnits(
    activeUnits,
    selectedPoint,
    (unit) => (unit.type || '').toUpperCase() === dispatchAgency,
  );

  return (
    <div className="map-container">
      {/* Leaflet map — rendered imperatively into this div via the effects
          above (L.map / L.marker / L.divIcon), not react-leaflet. */}
      <div ref={mapRef} className="map-view" />
      {/* Every swatch/icon below is pulled from the SAME functions that paint
          the actual markers (getPinColor / getUnitTypeMeta) — never a second,
          hand-copied set of colors that can silently drift from what's really
          on the map. */}
      <div className="map-legend">
        <div className="map-legend-title">Incidents</div>
        <div className="legend-item">
          <span className="legend-icon" style={{ backgroundColor: getPinColor('CRITICAL') }}>●</span>
          <span>Critical / High</span>
        </div>
        <div className="legend-item">
          <span className="legend-icon" style={{ backgroundColor: getPinColor('MED') }}>●</span>
          <span>Medium</span>
        </div>
        <div className="legend-item">
          <span className="legend-icon" style={{ backgroundColor: getPinColor('LOW') }}>●</span>
          <span>Low</span>
        </div>

        <div className="map-legend-title map-legend-title-spaced">Units</div>
        <div className="legend-unit-row">
          {/* Only the 3 agencies this app actually dispatches — the same set
              IncidentDetailsPanel's Dispatch Forces tabs offer. Unit.type also
              defines "HomeFront", but nothing in this app ever creates or
              dispatches one, so it never appears on the map — showing it here
              would just be a confusing icon nobody can match to anything. */}
          {['POLICE', 'FIRE', 'EMS'].map((t) => {
            const meta = getUnitTypeMeta({ type: t });
            const label = t === 'EMS' ? 'EMS' : t.charAt(0) + t.slice(1).toLowerCase();
            return (
              <span key={t} className="legend-unit-chip" title={label}>
                <span>{meta.emoji}</span>
                <span>{label}</span>
              </span>
            );
          })}
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
                </select>

                <label style={labelStyle}>Details</label>
                <textarea
                  placeholder="Additional details..."
                  value={incidentForm.description}
                  onChange={(e) => setIncidentForm({ ...incidentForm, description: e.target.value })}
                  style={{ ...inputStyle, minHeight: '60px' }}
                />

                <label style={labelStyle}>Field Control Room (optional)</label>
                <select
                  value={incidentForm.fieldCommandId}
                  onChange={(e) => setIncidentForm({ ...incidentForm, fieldCommandId: e.target.value })}
                  style={inputStyle}
                >
                  <option value="">— None —</option>
                  {(fieldCommands || [])
                    .filter((fc) => fc.status !== 'CLOSED')
                    .map((fc) => (
                      <option key={fc.id} value={fc.id}>{fc.name}</option>
                    ))}
                </select>

                <div style={actionsRowStyle}>
                  <button type="button" onClick={handleCloseModal} style={cancelButtonStyle}>Cancel</button>
                  <button type="submit" style={{ ...submitButtonStyle, background: '#0284c7' }}>Create</button>
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
