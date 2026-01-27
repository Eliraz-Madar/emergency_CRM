import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
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
  routineUnits = null,
  isSimulation = false
}) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});

  const unitHtml = (emoji) => `
    <div style="width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; border-radius: 50%; background: white; border: 3px solid #1f2937; font-size: 35px; line-height: 60px; text-align: center;">
      ${emoji}
    </div>
  `;

  const policeIcon = L.divIcon({
    className: 'marker-unit-police',
    html: unitHtml('🚓'),
    iconSize: [60, 60],
    iconAnchor: [30, 60],
  });

  const fireIcon = L.divIcon({
    className: 'marker-unit-fire',
    html: unitHtml('🚒'),
    iconSize: [60, 60],
    iconAnchor: [30, 60],
  });

  const medicalIcon = L.divIcon({
    className: 'marker-unit-medical',
    html: unitHtml('🚑'),
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

  const { selectedIncidentId, setSelectedIncident, incidents: dashboardIncidents } = useDashboardStore();

  // Subscribe directly to the field incident store for strict reactivity
  const fieldIncidents = useFieldIncidentStore((s) => s.incidents || []);
  const units = useFieldIncidentStore((s) => s.units || []);

  // Combine incidents from both stores for display
  const incidents = React.useMemo(() => {
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
  }, [dashboardIncidents, fieldIncidents]);

  // Initialize map
  useEffect(() => {
    if (mapInstanceRef.current) return; // Already initialized

    const map = L.map(mapRef.current).setView([31.77, 35.22], 11); // Center on Tel Aviv

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear existing markers
    Object.values(markersRef.current).forEach((marker) => {
      map.removeLayer(marker);
    });
    markersRef.current = {};

    const activeUnits = isSimulation
      ? simulationUnits
      : (routineUnits || units);

    // SIMULATION MODE: Display incident and moving units
    if (isSimulation && simulationIncident) {
      const incLat = simulationIncident.lat || 31.77;
      const incLng = simulationIncident.lng || 35.22;

      const incidentHtml = `
        <div class="map-marker-incident" style="background-color: #ef4444; font-size: 1.5em;">
          🔥
        </div>
      `;

      const incidentMarker = L.marker(
        [incLat, incLng],
        {
          icon: L.divIcon({
            html: incidentHtml,
            className: 'marker-incident-simulation',
            iconSize: [50, 50],
            iconAnchor: [25, 50],
          }),
        }
      ).addTo(map);

      incidentMarker.bindPopup(`
        <div class="map-popup">
          <strong>${simulationIncident.name || 'Incident Location'}</strong>
          <p>Type: Fire</p>
          <small>Coordinates: ${incLat.toFixed(3)}, ${incLng.toFixed(3)}</small>
        </div>
      `);

      markersRef.current[`incident-${simulationIncident.name}`] = incidentMarker;

      if (activeUnits && Array.isArray(activeUnits)) {
        activeUnits.forEach((unit) => {
          if (!unit || !unit.position || unit.position.length < 2) return;

          const type = (unit.type || '').toUpperCase();
          const chosenIcon = type === 'POLICE' ? policeIcon : type === 'FIRE' ? fireIcon : type === 'MEDICAL' ? medicalIcon : null;
          const unitMarker = L.marker(
            [unit.position[0], unit.position[1]],
            {
              icon: chosenIcon || L.divIcon({
                html: unitHtml('📍'),
                className: `marker-unit-simulation ${unit.status?.toLowerCase() || 'moving'}`,
                iconSize: [60, 60],
                iconAnchor: [30, 60],
              }),
            }
          ).addTo(map);

          // Determine status color for popup text in simulation mode
          const simStatusValue = unit.status || 'MOVING';
          const simStatusTextColor =
            simStatusValue === 'AVAILABLE' || simStatusValue === 'PATROL' ? '#10b981' :
              simStatusValue === 'DISPATCHED' || simStatusValue === 'EN_ROUTE' ? '#f59e0b' :
                simStatusValue === 'ON_SCENE' || simStatusValue === 'BUSY' ? '#ef4444' :
                  '#6b7280';

          unitMarker.bindPopup(`
            <div class="map-popup">
              <strong>${unit.name || 'Unit'}</strong>
              <p>Type: ${unit.type || 'UNKNOWN'}</p>
              <p style="margin: 6px 0; color: ${simStatusTextColor}; font-weight: 600;">Status: ${simStatusValue}</p>
              <small>Position: ${unit.position[0].toFixed(3)}, ${unit.position[1].toFixed(3)}</small>
            </div>
          `);

          markersRef.current[`unit-${unit.id}`] = unitMarker;

          const pathLine = L.polyline(
            [
              [unit.position[0], unit.position[1]],
              [incLat, incLng],
            ],
            {
              color: type === 'FIRE' ? '#ef4444' : type === 'POLICE' ? '#3b82f6' : '#10b981',
              weight: 2,
              opacity: 0.4,
              dashArray: '5, 5',
            }
          ).addTo(map);

          markersRef.current[`path-${unit.id}`] = pathLine;
        });
      }

      map.setView([incLat, incLng], 14);
      return;
    }

    // SIMULATION MODE (sectors): Display sectors
    if (simulationSectors && Array.isArray(simulationSectors)) {
      simulationSectors.forEach((sector) => {
        const hazardColor = {
          CRITICAL: '#ef4444',
          HIGH: '#f59e0b',
          MODERATE: '#eab308',
          LOW: '#3b82f6',
        }[sector.hazard_level] || '#6b7280';

        const html = `
          <div class="map-marker-sector" style="background-color: ${hazardColor}">
            🏢
          </div>
        `;

        const marker = L.marker(
          [sector.center_lat || 31.77, sector.center_lng || 35.22],
          {
            icon: L.divIcon({
              html,
              className: 'marker-sector',
              iconSize: [40, 40],
              iconAnchor: [20, 40],
            }),
          }
        ).addTo(map);

        marker.bindPopup(`
          <div class="map-popup">
            <strong>${sector.name || 'Unknown Sector'}</strong>
            <p>Hazard: ${sector.hazard_level || 'UNKNOWN'}</p>
            <p>Status: ${sector.status || 'UNKNOWN'}</p>
            <small>Access: ${sector.access_status || 'UNKNOWN'}</small>
          </div>
        `);

        markersRef.current[`sector-${sector.name}`] = marker;
      });

      if (simulationSectors.length > 0 && simulationSectors[0].center_lat) {
        map.setView([simulationSectors[0].center_lat, simulationSectors[0].center_lng], 13);
      }

      return;
    }

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

      const marker = L.marker(
        [lat, lng],
        {
          icon: L.divIcon({
            html: `
              <div style="background-color: ${pinColor}; width: 24px; height: 24px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.4); transition: all 0.3s ease;"></div>
            `,
            className: `marker-incident ${selectedIncidentId === incident.id ? 'selected' : ''}`,
            iconSize: [24, 24],
            iconAnchor: [12, 24],
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

    const renderedUnits = activeUnits && Array.isArray(activeUnits) ? activeUnits : units;

    renderedUnits.forEach((unit, idx) => {
      const hasPosition = Array.isArray(unit.position) && unit.position.length >= 2;
      const unitLat = hasPosition ? unit.position[0] : unit.location_lat;
      const unitLng = hasPosition ? unit.position[1] : unit.location_lng;

      if (unitLat === undefined || unitLng === undefined) return;

      const type = (unit.type || '').toUpperCase();
      const chosenIcon = type === 'POLICE' ? policeIcon : type === 'FIRE' ? fireIcon : type === 'MEDICAL' ? medicalIcon : null;

      const marker = L.marker(
        [unitLat, unitLng],
        {
          icon: chosenIcon || L.divIcon({
            html: unitHtml('📍'),
            className: 'marker-unit marker-unit-smooth',
            iconSize: [60, 60],
            iconAnchor: [30, 60],
          }),
        }
      ).addTo(map);

      const targetIncident = unit.assignedTo ? (incidents || []).find((i) => i.id === unit.assignedTo) : null;
      const unitStatus = unit.status || 'PATROL';

      let statusDisplay = 'Status: PATROL';
      let statusTextColor = '#10b981';

      if (unitStatus === 'EN_ROUTE') {
        statusDisplay = `En Route to: ${targetIncident?.subtype || targetIncident?.type || 'Incident'}`;
        statusTextColor = '#f59e0b';
      } else if (unitStatus === 'ON_SCENE') {
        statusDisplay = 'On Scene';
        statusTextColor = '#ef4444';
      } else if (unitStatus === 'AVAILABLE' || unitStatus === 'PATROL') {
        statusDisplay = 'Patrol';
        statusTextColor = '#10b981';
      }

      marker.bindPopup(`
        <div class="map-popup">
          <strong>${unit.name || `Unit ${idx + 1}`}</strong>
          <p>${unit.type || 'Unknown'}</p>
          <p style="margin: 6px 0; color: ${statusTextColor}; font-weight: 600;">${statusDisplay}</p>
        </div>
      `);

      markersRef.current[`unit-${unit.id || idx}`] = marker;
    });
  }, [incidents, units, routineUnits, selectedIncidentId, setSelectedIncident, simulationSectors, simulationIncident, simulationUnits, activeFilter, isSimulation]);

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
          const pinHtml = `<div style='background-color: ${color}; width: 24px; height: 24px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px ${color};'></div>`;
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

        {units.map((unit, idx) => {
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
