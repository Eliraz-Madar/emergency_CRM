import { getDeviceLocation } from "./location";
import { getAuthHeaders } from "./apiClient";
import { API_BASE_URL } from "../config";

const HEARTBEAT_INTERVAL_MS = 25000;

// Streams the device's live GPS to the backend while a unit is claimed, so
// the unit's map marker and is_online status stay current. If heartbeats
// stop (app closed, network lost), the backend treats the unit as offline
// again on its own after Unit.HEARTBEAT_STALE_AFTER — no explicit stop call
// is required for that half of the contract, but callers should still call
// the returned stop function on logout/unmount to save battery.
export function startHeartbeatLoop(token, user) {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const location = await getDeviceLocation();
      await fetch(`${API_BASE_URL}/api/units/heartbeat/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders(token, user) },
        body: JSON.stringify({
          location_lat: location.latitude,
          location_lng: location.longitude,
          // Flags a no-GPS-fix fallback reading (see utils/location.js
          // MOCK_LOCATION) so the backend keeps the unit's last real position
          // instead of teleporting the marker to a fixed fallback point.
          is_mock_location: location.isMock,
        }),
      });
    } catch {
      // Best-effort — a dropped beat just delays the next successful one.
    }
  };

  tick(); // fire immediately so the unit goes online without waiting a full interval
  const interval = setInterval(tick, HEARTBEAT_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

// Explicit logout signal — flips the claimed unit offline immediately
// instead of waiting for the heartbeat to go stale.
export async function disconnectUnit(token, user) {
  try {
    await fetch(`${API_BASE_URL}/api/units/disconnect/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders(token, user) },
    });
  } catch {
    // Best-effort — server-side staleness will also mark it offline eventually.
  }
}
