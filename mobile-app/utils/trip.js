// Shared en-route trip maths. MUST stay identical to the web
// frontend-web/src/pages/Dashboard.jsx helpers so the war-room map and this
// screen place the vehicle in exactly the same spot with the same ETA.

import { API_BASE_URL } from "../config";
import { getAuthHeaders } from "./apiClient";

// Drive compression — MUST match TRIP_SPEEDUP on the backend and in the web app.
export const TRIP_SPEEDUP = 8;

const EARTH_KM = 6371;

export function haversineKm(aLat, aLng, bLat, bLng) {
  if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) return 0;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function polylineLengthKm(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;
  let km = 0;
  for (let i = 1; i < coords.length; i += 1) {
    km += haversineKm(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return km;
}

// Point at cumulative-distance fraction `frac` along `coords` ([[lat,lng]...]),
// plus the index of the segment it lands on.
export function pointAtFraction(coords, frac) {
  if (!Array.isArray(coords) || coords.length < 2) {
    return { point: coords && coords[0], segIndex: 0 };
  }
  const segLen = [];
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const d = haversineKm(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
    segLen.push(d);
    total += d;
  }
  if (total === 0) return { point: coords[coords.length - 1], segIndex: coords.length - 2 };
  let target = Math.max(0, Math.min(1, frac)) * total;
  for (let i = 0; i < segLen.length; i += 1) {
    if (target <= segLen[i] || i === segLen.length - 1) {
      const t = segLen[i] > 0 ? Math.max(0, Math.min(1, target / segLen[i])) : 0;
      return {
        point: [
          coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
          coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
        ],
        segIndex: i,
      };
    }
    target -= segLen[i];
  }
  return { point: coords[coords.length - 1], segIndex: coords.length - 2 };
}

// Fetch the shared trip for a task, or null if there's no active drive.
export async function fetchTrip(taskId, token, user) {
  if (taskId == null) return null;
  try {
    const res = await fetch(`${API_BASE_URL}/api/tasks/${taskId}/trip/`, {
      headers: getAuthHeaders(token, user),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Given a trip payload and "now", where is the vehicle and how far / how long
// to go. Returns react-native-maps-ready { latitude, longitude } coordinates.
export function tripState(trip, nowMs = Date.now()) {
  const coords = Array.isArray(trip?.coords) ? trip.coords : [];
  if (coords.length < 2 || !trip.accepted_at || !trip.duration_s) return null;
  const speedup = trip.speedup || TRIP_SPEEDUP;
  const elapsedS = (nowMs - new Date(trip.accepted_at).getTime()) / 1000;
  const progress = Math.max(0, Math.min(1, (elapsedS * speedup) / trip.duration_s));
  const { point, segIndex } = pointAtFraction(coords, progress);
  const arrived = progress >= 1;
  const remainingLatLng = arrived
    ? [coords[coords.length - 1]]
    : [point, ...coords.slice(segIndex + 1)];
  const totalKm = (trip.distance_m || 0) / 1000 || polylineLengthKm(coords);
  return {
    progress,
    arrived,
    position: { latitude: point[0], longitude: point[1] },
    remaining: remainingLatLng.map(([lat, lng]) => ({ latitude: lat, longitude: lng })),
    remainingKm: arrived ? 0 : totalKm * (1 - progress),
    remainingMin: arrived ? 0 : (trip.duration_s / 60 / speedup) * (1 - progress),
    fullRoute: coords.map(([lat, lng]) => ({ latitude: lat, longitude: lng })),
  };
}
