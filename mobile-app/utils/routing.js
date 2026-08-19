// Real road-network routing for the mobile app, backed by the OSRM public API.
// Mirrors frontend-web/src/services/routingService.js but returns the shape
// the mobile map screen needs directly: a react-native-maps-ready coordinate
// array plus distance/ETA, with a straight-line fallback when OSRM is
// unreachable so a route always renders even without connectivity.

const OSRM_BASE_URL = "https://router.project-osrm.org/route/v1/driving";
const FETCH_TIMEOUT_MS = 8000;
const AVERAGE_FALLBACK_SPEED_KMH = 40;

const EARTH_RADIUS_METERS = 6371000;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function haversineMeters(origin, destination) {
  const dLat = toRadians(destination.latitude - origin.latitude);
  const dLng = toRadians(destination.longitude - origin.longitude);
  const lat1 = toRadians(origin.latitude);
  const lat2 = toRadians(destination.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

function isValidPoint(point) {
  return (
    point &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude)
  );
}

function buildFallbackRoute(origin, destination) {
  const distanceMeters = haversineMeters(origin, destination);
  const durationMinutes =
    (distanceMeters / 1000 / AVERAGE_FALLBACK_SPEED_KMH) * 60;

  return {
    coordinates: [
      { latitude: origin.latitude, longitude: origin.longitude },
      { latitude: destination.latitude, longitude: destination.longitude },
    ],
    distanceMeters,
    distanceKm: distanceMeters / 1000,
    durationMinutes,
    isFallback: true,
  };
}

// Fetches the real driving route between two { latitude, longitude } points.
// Always resolves — falls back to a straight line on any network/API failure
// so callers never need a second error path.
export async function fetchRealRoute(origin, destination) {
  if (!isValidPoint(origin) || !isValidPoint(destination)) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const url =
      `${OSRM_BASE_URL}/${origin.longitude},${origin.latitude};` +
      `${destination.longitude},${destination.latitude}` +
      `?overview=full&geometries=geojson`;

    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return buildFallbackRoute(origin, destination);

    const data = await res.json();
    const route = data?.routes?.[0];
    const geoCoords = route?.geometry?.coordinates;
    if (!Array.isArray(geoCoords) || geoCoords.length === 0) {
      return buildFallbackRoute(origin, destination);
    }

    const coordinates = geoCoords.map(([lng, lat]) => ({
      latitude: lat,
      longitude: lng,
    }));

    return {
      coordinates,
      distanceMeters: route.distance,
      distanceKm: route.distance / 1000,
      durationMinutes: route.duration / 60,
      isFallback: false,
    };
  } catch {
    return buildFallbackRoute(origin, destination);
  } finally {
    clearTimeout(timeout);
  }
}
