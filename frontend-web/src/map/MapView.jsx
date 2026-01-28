import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect } from "react";

const severityColors = {
  low: "green",
  med: "orange",
  high: "red",
};

const createIcon = (color) =>
  L.divIcon({
    html: `<div style="background:${color};width:16px;height:16px;border-radius:50%"></div>`,
    className: "",
  });

const createVehicleIcon = (type) => {
  const colors = {
    POLICE: '#3b82f6',
    FIRE: '#ef4444',
    MEDICAL: '#10b981',
  };
  const color = colors[type] || '#6b7280';

  return L.divIcon({
    html: `<div style="background:${color};width:20px;height:20px;border-radius:50%;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3)"></div>`,
    className: "",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
};

const AutoResize = () => {
  const map = useMap();
  useEffect(() => {
    const resize = () => map.invalidateSize();
    // trigger once on mount and after a tick to ensure container is laid out
    setTimeout(resize, 100);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [map]);
  return null;
};

export default function MapView({ incidents = [], units = [], includeUnits = false }) {
  const center = [32.08, 34.78];

  return (
    <div className="map-shell">
      <MapContainer
        center={center}
        zoom={9}
        className="leaflet-map"
        style={{ height: "420px", width: "100%" }}
      >
        <AutoResize />
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {/* Render incidents */}
        {incidents.map((inc) => (
          <Marker
            key={`incident-${inc.id}`}
            position={[inc.location_lat, inc.location_lng]}
            icon={createIcon(severityColors[(inc.priority || inc.severity || "").toLowerCase()] || "gray")}
          >
            <Popup>
              <strong>{inc.title}</strong>
              <p>{inc.status}</p>
            </Popup>
          </Marker>
        ))}

        {/* Render units with routes */}
        {includeUnits &&
          units.map((unit) => {
            const lat = unit.latitude ?? (Array.isArray(unit.position) ? unit.position[0] : null);
            const lng = unit.longitude ?? (Array.isArray(unit.position) ? unit.position[1] : null);

            if (!lat || !lng) return null;

            return (
              <div key={`unit-${unit.id}`}>
                {/* Render route line if unit is en route and has a route */}
                {unit.status === 'EN_ROUTE' && unit.route && Array.isArray(unit.route) && unit.route.length > 0 && (
                  <Polyline
                    positions={unit.route}
                    color={unit.type === 'POLICE' ? '#3b82f6' : unit.type === 'FIRE' ? '#ef4444' : '#10b981'}
                    weight={3}
                    opacity={0.6}
                    dashArray="5, 10"
                  />
                )}

                {/* Render unit marker */}
                <Marker
                  position={[lat, lng]}
                  icon={createVehicleIcon(unit.type)}
                >
                  <Popup>
                    <strong>{unit.name}</strong>
                    <p>Type: {unit.type}</p>
                    <p>Status: {unit.status}</p>
                    {unit.assignedTo && <p>Assigned to: {unit.assignedTo}</p>}
                  </Popup>
                </Marker>
              </div>
            );
          })}
      </MapContainer>
    </div>
  );
}
