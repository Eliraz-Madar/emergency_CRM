/**
 * Lightweight offline geo helpers for Israel — no network geocoding.
 *
 * `ISRAEL_CITIES` is the single list of major-city reference points, shared by
 * the training simulation's random placement (store/fieldIncident.js) and
 * `nearestCityName()`, which labels an incident/point by the closest city so
 * the UI can show "Near Tel Aviv" instead of raw coordinates or "Unknown
 * location".
 */

// Major Israeli cities (inland-safe centres) — name + approx lat/lng.
export const ISRAEL_CITIES = [
  // מרכז
  { name: 'Tel Aviv', lat: 32.0853, lng: 34.7818 },
  { name: 'Ramat Gan', lat: 32.0853, lng: 34.8103 },
  { name: 'Petah Tikva', lat: 32.0878, lng: 34.8879 },
  { name: 'Rishon LeZion', lat: 31.9730, lng: 34.7925 },
  { name: 'Holon', lat: 32.0167, lng: 34.7667 },
  { name: 'Rehovot', lat: 31.8944, lng: 34.8081 },
  // ירושלים והסביבה
  { name: 'Jerusalem', lat: 31.7683, lng: 35.2137 },
  { name: 'Beit Shemesh', lat: 31.7522, lng: 34.9897 },
  { name: "Modi'in", lat: 31.8969, lng: 35.0106 },
  // צפון
  { name: 'Haifa', lat: 32.7940, lng: 34.9896 },
  { name: 'Nazareth', lat: 32.7028, lng: 35.2978 },
  { name: 'Tiberias', lat: 32.7940, lng: 35.5309 },
  { name: 'Kiryat Shmona', lat: 33.2073, lng: 35.5711 },
  { name: 'Safed', lat: 32.9658, lng: 35.4983 },
  // דרום
  { name: 'Beer Sheva', lat: 31.2518, lng: 34.7913 },
  { name: 'Ashdod', lat: 31.8018, lng: 34.6479 },
  { name: 'Ashkelon', lat: 31.6688, lng: 34.5742 },
  { name: 'Netivot', lat: 31.4203, lng: 34.5952 },
];

// Squared-degree distance is enough for a nearest-of-N pick (no sqrt, no
// haversine — we only compare, never report the number).
function roughSqDist(lat1, lng1, lat2, lng2) {
  const dLat = lat1 - lat2;
  const dLng = (lng1 - lng2) * Math.cos((lat1 * Math.PI) / 180);
  return dLat * dLat + dLng * dLng;
}

/**
 * Name of the closest city to a coordinate, or `null` if the coordinate is
 * missing/invalid. Callers decide the phrasing ("Near " + name, etc.).
 */
export function nearestCityName(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best = null;
  let bestD = Infinity;
  for (const city of ISRAEL_CITIES) {
    const d = roughSqDist(lat, lng, city.lat, city.lng);
    if (d < bestD) {
      bestD = d;
      best = city;
    }
  }
  return best ? best.name : null;
}
