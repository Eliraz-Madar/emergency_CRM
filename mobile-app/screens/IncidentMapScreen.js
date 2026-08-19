import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from "react-native";
import MapView, { Marker, Callout, Polyline } from "react-native-maps";
import { API_BASE_URL } from "../config";
import { useUser } from "../context/UserContext";
import { getAuthHeaders } from "../utils/apiClient";
import { getDeviceLocation, watchDeviceLocation } from "../utils/location";
import { fetchRealRoute } from "../utils/routing";

const PRIORITY_COLOR = {
  CRITICAL: "#D32F2F",
  HIGH:     "#F57C00",
  MEDIUM:   "#FBC02D",
  MED:      "#FBC02D",
  LOW:      "#388E3C",
};

const STATUS_LABEL = {
  OPEN:        "Open",
  PENDING:     "Pending",
  EN_ROUTE:    "En Route",
  ON_SCENE:    "On Scene",
  IN_PROGRESS: "In Progress",
  RESOLVED:    "Resolved",
  CLOSED:      "Closed",
};

// A task's route is only worth calculating while its incident is in one of
// these states — before PENDING there's nothing to drive to yet, and after
// ON_SCENE the unit has already arrived.
const ROUTABLE_STATUSES = new Set(["PENDING", "EN_ROUTE", "ON_SCENE"]);

// Keeps both the unit and the incident comfortably inside the visible map
// area (not hard against the screen edge, and clear of the bottom route card).
const FIT_EDGE_PADDING = { top: 80, right: 60, bottom: 260, left: 60 };

function deduplicateIncidents(tasks) {
  const seen = new Set();
  const result = [];
  for (const t of tasks) {
    if (t.incident_lat == null || t.incident_lng == null) continue;
    if (seen.has(t.incident)) continue;
    seen.add(t.incident);
    result.push({
      id:       t.incident,
      title:    t.incident_title    ?? `Incident #${t.incident}`,
      lat:      t.incident_lat,
      lng:      t.incident_lng,
      priority: t.incident_priority ?? "LOW",
      status:   t.incident_status   ?? "OPEN",
    });
  }
  return result;
}

export default function IncidentMapScreen({ token, selectedUnit, selectedTask }) {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [deviceLocation, setDeviceLocation] = useState(null);
  const [route, setRoute]         = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const { user } = useUser();
  const mapRef = useRef(null);
  // Tracks how far we've auto-focused the camera for the current target, so
  // we fit once when the unit/incident pair first appears and again once the
  // real route arrives — without fighting the user's own pan/zoom on every
  // subsequent GPS tick.
  const fitStageRef = useRef({ incidentId: null, stage: "none" });

  useEffect(() => {
    if (!token) return;
    load();
  }, [token]);

  // The task the unit is actively working, if any — prefer the task the
  // user tapped "View Route" on; otherwise fall back to the first routable
  // incident on the map so opening the screen directly still shows a route.
  const activeIncident =
    selectedTask?.incident_lat != null &&
    selectedTask?.incident_lng != null &&
    ROUTABLE_STATUSES.has(selectedTask?.incident_status)
      ? {
          id:       selectedTask.incident,
          title:    selectedTask.incident_title ?? `Incident #${selectedTask.incident}`,
          lat:      selectedTask.incident_lat,
          lng:      selectedTask.incident_lng,
          status:   selectedTask.incident_status,
        }
      : incidents.find((inc) => ROUTABLE_STATUSES.has(inc.status)) ?? null;

  // Live GPS: one immediate fix so the route doesn't wait for the first
  // watch callback, then continuous updates so the route redraws as the
  // unit moves toward the incident.
  useEffect(() => {
    if (!activeIncident) return undefined;
    let stopWatch;
    let cancelled = false;

    getDeviceLocation().then((loc) => {
      if (!cancelled) setDeviceLocation(loc);
    });
    watchDeviceLocation((loc) => {
      if (!cancelled) setDeviceLocation(loc);
    }).then((stop) => {
      if (cancelled) stop();
      else stopWatch = stop;
    });

    return () => {
      cancelled = true;
      stopWatch?.();
    };
  }, [activeIncident?.id]);

  // Recalculate the road route whenever the target incident or the unit's
  // live position changes.
  useEffect(() => {
    if (!activeIncident || !deviceLocation) {
      setRoute(null);
      return;
    }
    let cancelled = false;
    setRouteLoading(true);
    fetchRealRoute(
      { latitude: deviceLocation.latitude, longitude: deviceLocation.longitude },
      { latitude: activeIncident.lat, longitude: activeIncident.lng }
    ).then((result) => {
      if (!cancelled) {
        setRoute(result);
        setRouteLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [activeIncident?.id, deviceLocation?.latitude, deviceLocation?.longitude]);

  // Auto-focus the camera so the unit and the incident (and, once it
  // arrives, the full route) are both immediately visible without the user
  // having to pan/zoom manually.
  useEffect(() => {
    if (!mapRef.current || !activeIncident) return;

    if (fitStageRef.current.incidentId !== activeIncident.id) {
      fitStageRef.current = { incidentId: activeIncident.id, stage: "none" };
    }

    if (route?.coordinates?.length > 1 && fitStageRef.current.stage !== "route") {
      mapRef.current.fitToCoordinates(route.coordinates, {
        edgePadding: FIT_EDGE_PADDING,
        animated: true,
      });
      fitStageRef.current.stage = "route";
    } else if (deviceLocation && fitStageRef.current.stage === "none") {
      mapRef.current.fitToCoordinates(
        [
          { latitude: deviceLocation.latitude, longitude: deviceLocation.longitude },
          { latitude: activeIncident.lat, longitude: activeIncident.lng },
        ],
        { edgePadding: FIT_EDGE_PADDING, animated: true }
      );
      fitStageRef.current.stage = "points";
    }
  }, [activeIncident?.id, route, deviceLocation]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      const url = selectedUnit?.id
        ? `${API_BASE_URL}/api/tasks/?mock_unit=${selectedUnit.id}`
        : `${API_BASE_URL}/api/tasks/`;
      const res = await fetch(url, {
        headers: getAuthHeaders(token, user),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tasks = await res.json();
      setIncidents(deduplicateIncidents(tasks));
      setError("");
    } catch (err) {
      setError("Could not load incident map. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1565C0" />
        <Text style={styles.hint}>Loading incident map…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>⚠  {error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryBtnText}>RETRY</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const initialRegion =
    incidents.length > 0
      ? {
          latitude:  incidents.reduce((s, i) => s + i.lat, 0) / incidents.length,
          longitude: incidents.reduce((s, i) => s + i.lng, 0) / incidents.length,
          latitudeDelta:  3.0,
          longitudeDelta: 3.0,
        }
      : { latitude: 31.5, longitude: 34.8, latitudeDelta: 4.0, longitudeDelta: 4.0 };

  return (
    <View style={styles.container}>
      <MapView ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={initialRegion}>
        {incidents.map((inc) => (
          <Marker
            key={inc.id}
            coordinate={{ latitude: inc.lat, longitude: inc.lng }}
            pinColor={PRIORITY_COLOR[inc.priority] ?? PRIORITY_COLOR.LOW}
          >
            <Callout tooltip={false}>
              <View style={styles.callout}>
                <Text style={styles.calloutTitle} numberOfLines={2}>{inc.title}</Text>
                <Text style={styles.calloutMeta}>
                  {inc.priority}  ·  {STATUS_LABEL[inc.status] ?? inc.status}
                </Text>
              </View>
            </Callout>
          </Marker>
        ))}

        {deviceLocation && (
          <Marker
            coordinate={{ latitude: deviceLocation.latitude, longitude: deviceLocation.longitude }}
            pinColor="#1565C0"
            title="Your location"
          />
        )}

        {route?.coordinates?.length > 0 && (
          <Polyline
            coordinates={route.coordinates}
            strokeColor={route.isFallback ? "#90A4AE" : "#1d4ed8"}
            strokeWidth={5}
            lineDashPattern={route.isFallback ? [8, 6] : undefined}
          />
        )}
      </MapView>

      {incidents.length === 0 && (
        <View style={styles.emptyBadge}>
          <Text style={styles.emptyBadgeText}>No active incidents for your unit</Text>
        </View>
      )}

      {activeIncident && (
        <View style={styles.routeCard}>
          <Text style={styles.routeCardTitle} numberOfLines={2}>{activeIncident.title}</Text>
          <Text style={styles.routeCardStatus}>
            {STATUS_LABEL[activeIncident.status] ?? activeIncident.status}
          </Text>
          {routeLoading && !route ? (
            <Text style={styles.routeCardHint}>Calculating route…</Text>
          ) : route ? (
            <View style={styles.routeMetrics}>
              <View style={styles.routeMetric}>
                <Text style={styles.routeMetricValue}>{route.distanceKm.toFixed(1)} km</Text>
                <Text style={styles.routeMetricLabel}>DISTANCE</Text>
              </View>
              <View style={styles.routeMetric}>
                <Text style={styles.routeMetricValue}>{Math.max(1, Math.round(route.durationMinutes))} min</Text>
                <Text style={styles.routeMetricLabel}>ETA</Text>
              </View>
              {route.isFallback && (
                <Text style={styles.routeCardHint}>Straight-line estimate — road routing unavailable</Text>
              )}
            </View>
          ) : (
            <Text style={styles.routeCardHint}>Waiting for GPS fix…</Text>
          )}
        </View>
      )}

      {/* Legend */}
      <View style={styles.legend}>
        {[["CRITICAL","#D32F2F"],["HIGH","#F57C00"],["MED","#FBC02D"],["LOW","#388E3C"]].map(
          ([label, color]) => (
            <View key={label} style={styles.legendRow}>
              <View style={[styles.dot, { backgroundColor: color }]} />
              <Text style={styles.legendText}>{label}</Text>
            </View>
          )
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#E8EEF4" },

  center: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: 14, backgroundColor: "#F0F4F8",
  },
  hint:      { color: "#546E7A", fontSize: 14 },
  errorText: { color: "#C62828", fontSize: 14, textAlign: "center", paddingHorizontal: 24 },
  retryBtn: {
    backgroundColor: "#1565C0", borderRadius: 8,
    paddingHorizontal: 24, paddingVertical: 10,
  },
  retryBtnText: { color: "#FFF", fontWeight: "700", fontSize: 13, letterSpacing: 0.5 },

  callout: { padding: 10, minWidth: 160, maxWidth: 220 },
  calloutTitle: { fontSize: 14, fontWeight: "700", color: "#1E2A3A", marginBottom: 4 },
  calloutMeta:  { fontSize: 12, color: "#546E7A" },

  emptyBadge: {
    position: "absolute", bottom: 24, alignSelf: "center",
    backgroundColor: "#FFFFFF", paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 24,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 8, elevation: 4,
  },
  emptyBadgeText: { color: "#546E7A", fontSize: 14 },

  legend: {
    position: "absolute", top: 12, right: 12,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 10, padding: 10, gap: 6,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12, shadowRadius: 4, elevation: 3,
  },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot:        { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, color: "#37474F", fontWeight: "600" },

  routeCard: {
    position: "absolute", bottom: 20, left: 16, right: 16,
    backgroundColor: "#FFFFFF", borderRadius: 14, padding: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18, shadowRadius: 10, elevation: 5,
  },
  routeCardTitle:  { fontSize: 15, fontWeight: "700", color: "#1E2A3A" },
  routeCardStatus: { fontSize: 12, color: "#546E7A", marginTop: 2, marginBottom: 10 },
  routeCardHint:   { fontSize: 12, color: "#90A4AE", marginTop: 4 },
  routeMetrics:    { flexDirection: "row", gap: 24 },
  routeMetric:      { alignItems: "flex-start" },
  routeMetricValue: { fontSize: 20, fontWeight: "800", color: "#1565C0" },
  routeMetricLabel: { fontSize: 10, fontWeight: "700", color: "#90A4AE", letterSpacing: 0.5, marginTop: 2 },
});
