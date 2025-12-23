import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useDashboardStore } from '../store/dashboard.js';

/**
 * Map View Component - displays incidents and units on map
 */
export function MapView() {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  
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

    // Add incident markers
    incidents.forEach((incident) => {
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
            className: `marker-incident ${
              selectedIncidentId === incident.id ? 'selected' : ''
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

    // Add unit markers
    units.forEach((unit) => {
      const unitIcon = {
        Ambulance: '🚑',
        Police: '🚓',
        Fire: '🚒',
        Rescue: '🆘',
      }[unit.type] || '📍';

      const statusColor = {
        Available: '#10b981',
        Dispatched: '#f59e0b',
        OnScene: '#ef4444',
        Offline: '#6b7280',
      }[unit.status] || '#6b7280';

      const html = `
        <div class="map-marker-unit" style="border-color: ${statusColor}">
          ${unitIcon}
        </div>
      `;

      const marker = L.marker(
        [unit.location_lat, unit.location_lng],
        {
          icon: L.divIcon({
            html,
            className: 'marker-unit',
            iconSize: [40, 40],
            iconAnchor: [20, 40],
          }),
        }
      ).addTo(map);

      marker.bindPopup(`
        <div class="map-popup">
          <strong>${unit.name}</strong>
          <p>${unit.type}</p>
          <small>Status: ${unit.status}</small>
        </div>
      `);

      markersRef.current[`unit-${unit.id}`] = marker;
    });
  }, [incidents, units, selectedIncidentId, setSelectedIncident]);

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
