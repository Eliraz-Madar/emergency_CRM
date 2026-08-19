import * as Location from "expo-location";

// Fallback used only when the device can't provide a real GPS fix
export const MOCK_LOCATION = { latitude: 32.0, longitude: 34.0 };

export async function getDeviceLocation() {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      return { ...MOCK_LOCATION, isMock: true, reason: "permission_denied" };
    }

    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) {
      return { ...MOCK_LOCATION, isMock: true, reason: "gps_disabled" };
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      isMock: false,
      reason: null,
    };
  } catch {
    return { ...MOCK_LOCATION, isMock: true, reason: "unavailable" };
  }
}

// How far the device must move before a route is recalculated — avoids
// re-querying OSRM on every tiny GPS jitter while walking/driving.
const ROUTE_UPDATE_DISTANCE_METERS = 50;
const ROUTE_UPDATE_INTERVAL_MS = 15000;

// Streams live GPS updates for as long as the caller needs a moving route
// (e.g. while a task is EN_ROUTE). Returns a stop function; resolves to a
// no-op stop function if permissions/services are unavailable so callers
// don't need a separate error path.
export async function watchDeviceLocation(onUpdate) {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return () => {};

    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) return () => {};

    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: ROUTE_UPDATE_DISTANCE_METERS,
        timeInterval: ROUTE_UPDATE_INTERVAL_MS,
      },
      (position) => {
        onUpdate({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          isMock: false,
          reason: null,
        });
      }
    );
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}
