import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
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
        {incidents.map((inc) => (
          <Marker
            key={`incident-${inc.id}`}
            position={[inc.location_lat, inc.location_lng]}
            icon={createIcon(severityColors[inc.severity.toLowerCase()] || "gray")}
          >
            <Popup>
              <strong>{inc.title}</strong>
              <p>{inc.status}</p>
            </Popup>
          </Marker>
        ))}
        {includeUnits &&
          units.map((unit) => (
            <Marker
              key={`unit-${unit.id}`}
              position={[unit.location_lat, unit.location_lng]}
              icon={createIcon("blue")}
            >
              <Popup>
                <strong>{unit.name}</strong>
                <p>{unit.type}</p>
              </Popup>
            </Marker>
          ))}
      </MapContainer>
    </div>
  );
}
