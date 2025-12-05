import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";

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

export default function MapView({ incidents = [], units = [], includeUnits = false }) {
  const center = [32.08, 34.78];

  return (
    <MapContainer center={center} zoom={9} style={{ height: "300px", width: "100%" }}>
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
  );
}
