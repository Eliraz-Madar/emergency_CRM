/**
 * Perimeter Map Picker
 *
 * Self-contained, click-to-draw perimeter builder. Renders its own small
 * Leaflet map, lets the field operator click points to build an ordered
 * boundary, previews it as a connecting line (and a closing polygon fill
 * once 3+ points exist), and exposes the current points array to its
 * parent via onPointsChange. Does not call the API itself — submission is
 * the modal's responsibility (see FieldIncidentDashboard.jsx).
 */

import { useState, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Polygon, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

// Custom numbered divIcon markers — matches the existing convention in both
// MapView.jsx files (never Leaflet's default icon, so no marker-image
// assets need importing).
const createPointIcon = (index) =>
  L.divIcon({
    html: `<div style="
      background: #f59e0b;
      color: #111827;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 2px solid #78350f;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      box-shadow: 0 2px 4px rgba(0,0,0,0.4);
    ">${index + 1}</div>`,
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

function ClickCapture({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

const PerimeterMapPicker = ({ center, onPointsChange }) => {
  const [points, setPoints] = useState([]);

  const safeCenter = [
    Number.isFinite(center?.lat) ? center.lat : 32.08,
    Number.isFinite(center?.lng) ? center.lng : 34.78,
  ];

  const emit = useCallback((next) => {
    setPoints(next);
    onPointsChange?.(next);
  }, [onPointsChange]);

  const handleMapClick = useCallback((point) => {
    emit([...points, point]);
  }, [points, emit]);

  const handleUndo = () => {
    if (points.length === 0) return;
    emit(points.slice(0, -1));
  };

  const handleClear = () => {
    emit([]);
  };

  // Let the parent know the (empty) starting state too.
  useEffect(() => {
    onPointsChange?.(points);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const polylinePositions = points.map((p) => [p.lat, p.lng]);

  return (
    <div>
      <div style={{ height: '360px', width: '100%', borderRadius: '8px', overflow: 'hidden', border: '1px solid #334155' }}>
        <MapContainer center={safeCenter} zoom={15} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <ClickCapture onMapClick={handleMapClick} />

          {points.length >= 2 && (
            <Polyline positions={polylinePositions} color="#f59e0b" weight={3} />
          )}
          {points.length >= 3 && (
            <Polygon positions={polylinePositions} color="#f59e0b" fillColor="#f59e0b" fillOpacity={0.15} weight={2} />
          )}

          {points.map((p, idx) => (
            <Marker key={idx} position={[p.lat, p.lng]} icon={createPointIcon(idx)} />
          ))}
        </MapContainer>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
          Click the map to add points — {points.length} point{points.length === 1 ? '' : 's'} placed.
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={handleUndo}
            disabled={points.length === 0}
            style={{
              background: 'transparent',
              border: '1px solid #475569',
              color: '#e2e8f0',
              borderRadius: '6px',
              padding: '5px 12px',
              fontSize: '0.78rem',
              cursor: points.length === 0 ? 'not-allowed' : 'pointer',
              opacity: points.length === 0 ? 0.5 : 1,
            }}
          >
            ↩ Undo
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={points.length === 0}
            style={{
              background: 'transparent',
              border: '1px solid #ef4444',
              color: '#ef4444',
              borderRadius: '6px',
              padding: '5px 12px',
              fontSize: '0.78rem',
              cursor: points.length === 0 ? 'not-allowed' : 'pointer',
              opacity: points.length === 0 ? 0.5 : 1,
            }}
          >
            ✕ Clear All
          </button>
        </div>
      </div>
    </div>
  );
};

export default PerimeterMapPicker;
