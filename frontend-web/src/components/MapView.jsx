import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useDashboardStore } from '../store/dashboard.js';

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

  const {
    incidents,
    units,
    selectedIncidentId,
    setSelectedIncident,
  } = useDashboardStore();

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

          unitMarker.bindPopup(`
            <div class="map-popup">
              <strong>${unit.name || 'Unit'}</strong>
              <p>Type: ${unit.type || 'UNKNOWN'}</p>
              <p>Status: ${unit.status || 'MOVING'}</p>
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

    filteredIncidents.forEach((incident) => {
      const severityColor = {
        CRITICAL: '#ef4444',
        HIGH: '#f59e0b',
        MED: '#eab308',
        LOW: '#3b82f6',
      }[incident.severity] || '#6b7280';

      const html = `
        <div class="map-marker-incident" style="background-color: ${severityColor}">
          📍
        </div>
      `;

      const marker = L.marker(
        [incident.location_lat, incident.location_lng],
        {
          icon: L.divIcon({
            html,
            className: `marker-incident ${selectedIncidentId === incident.id ? 'selected' : ''
              }`,
            iconSize: [40, 40],
            iconAnchor: [20, 40],
          }),
        }
      ).addTo(map);

      marker.on('click', () => {
        setSelectedIncident(incident.id);
      });

      marker.bindPopup(`
        <div class="map-popup">
          <strong>${incident.title}</strong>
          <p>${incident.location_name}</p>
          <small>Severity: ${incident.severity}</small>
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
            className: 'marker-unit',
            iconSize: [60, 60],
            iconAnchor: [30, 60],
          }),
        }
      ).addTo(map);

      marker.bindPopup(`
        <div class="map-popup">
          <strong>${unit.name || `Unit ${idx + 1}`}</strong>
          <p>${unit.type || 'Unknown'}</p>
          <small>Status: ${unit.status || 'PATROL'}</small>
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
