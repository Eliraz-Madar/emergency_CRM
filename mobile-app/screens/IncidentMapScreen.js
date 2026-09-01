import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from "react-native";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import NetInfo from "@react-native-community/netinfo";
import MapView, { Marker, Callout, Polyline } from "react-native-maps";
import { API_BASE_URL } from "../config";
import { useUser } from "../context/UserContext";
import { getAuthHeaders } from "../utils/apiClient";
import { getDeviceLocation, watchDeviceLocation } from "../utils/location";
import { markOnMyWay, markArrived } from "../utils/taskActions";
import { fetchTrip, tripState, haversineKm } from "../utils/trip";

// Match TasksScreen — device must be this close to the incident before the
// crew can confirm arrival.
const ARRIVAL_RADIUS_KM = 0.25;

// Only 3 severity tiers are actually reachable from the UI (the war-room's
// Incident Settings tab offers just Low/Medium/High) — CRITICAL is legacy
// data, not a distinct level a dispatcher can set, so it's folded into HIGH's
// color rather than given its own unreachable swatch in the legend below.
const PRIORITY_COLOR = {
  CRITICAL: "#F57C00",
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

const VEHICLE_ICON = { Police: "🚓", EMS: "🚑", Fire: "🚒", HomeFront: "🚙" };

// Used only for the "opened the map with no task selected" fallback — pick an
// incident some unit is already driving to. This crew's own route is driven by
// its task status, not this.
const EN_ROUTE_INCIDENT_STATUSES = new Set(["EN_ROUTE", "ON_SCENE"]);

// Keeps both the unit and the incident comfortably inside the visible map
// area (not hard against the screen edge, and clear of the bottom route card).
const FIT_EDGE_PADDING = { top: 80, right: 60, bottom: 260, left: 60 };

function deduplicateIncidents(tasks) {
  const seen = new Set();
  const result = [];
  for (const t of tasks) {
    if (t.incident_lat == null || t.incident_lng == null) continue;
    // Finished/cancelled tasks and closed incidents are not live dispatches.
    if (t.status === "DONE" || t.status === "CANCELLED") continue;
    if (t.incident_status === "CLOSED") continue;
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
  // Raw task list from the API, kept so we can track the *live* status of the
  // task the crew is driving to — the selectedTask prop is a stale snapshot
  // from whenever they opened this screen.
  const [taskList, setTaskList]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [deviceLocation, setDeviceLocation] = useState(null);
  const [onMyWayBusy, setOnMyWayBusy] = useState(false);
  const [arrivedBusy, setArrivedBusy] = useState(false);
  // Shared en-route trip (same object the war-room map reads) + a 1 s clock so
  // the interpolated position / ETA re-render smoothly.
  const [trip, setTrip] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const { user } = useUser();
  const isFocused = useIsFocused();
  const mapRef = useRef(null);
  // Camera is auto-framed exactly ONCE per target, then left entirely to the
  // user — no re-fits fighting their pinch-zoom.
  const fittedForRef = useRef(null);
  // Separately: once the crew accepts and the road route is known, frame the
  // WHOLE route + vehicle exactly once (per task) so tapping "On My Way" zooms
  // to the journey rather than leaving whatever zoom the pending view had.
  const framedRouteForRef = useRef(null);

  useEffect(() => {
    if (!token) return;
    load(true /* isFirst — show the full-screen loader only once */);
    const iv = setInterval(() => load(false), 5000); // silent background refresh
    return () => clearInterval(iv);
  }, [token]);

  // Re-pull the instant this screen regains focus so a dispatch the war-room
  // cancelled while we were away (a vehicle whose association to the event was
  // removed) drops off without a manual pull-to-refresh.
  useEffect(() => {
    if (isFocused && token) load(false);
  }, [isFocused, token]);

  // ...and again the moment connectivity returns.
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      if (token && state.isConnected && state.isInternetReachable !== false) load(false);
    });
    return unsub;
  }, [token]);

  // The live version of the task the crew is driving to (the prop is a stale
  // snapshot from when this screen mounted). Once the list has loaded, trust
  // it: a task that's gone — or came back cancelled/done — is no longer an
  // active association and must NOT fall back to the stale prop.
  const liveTask = taskList.find((t) => t.id === selectedTask?.id);
  const task = liveTask
    ? (["DONE", "CANCELLED"].includes(liveTask.status) ? null : liveTask)
    : (loading ? selectedTask : null);

  const myTaskAccepted = task?.status === "IN_PROGRESS";
  const hasCoords = task?.incident_lat != null && task?.incident_lng != null;
  const incidentFinished =
    task?.incident_status === "RESOLVED" || task?.incident_status === "CLOSED";

  // A selected task that still needs accepting — drives the "On My Way" prompt.
  const pendingTask =
    task && task.status === "PENDING" && !incidentFinished && hasCoords ? task : null;

  // The incident this crew is engaged with: whenever THIS task is accepted
  // (IN_PROGRESS) — regardless of the incident's shared status, which another
  // unit may already have pushed to ON_SCENE. Falls back to the first
  // already-en-route incident only when this crew has nothing of its own.
  const activeIncident =
    myTaskAccepted && hasCoords && !incidentFinished
      ? {
          id:       task.incident,
          title:    task.incident_title ?? `Incident #${task.incident}`,
          lat:      task.incident_lat,
          lng:      task.incident_lng,
          status:   task.incident_status,
        }
      : pendingTask
        ? null
        : incidents.find((inc) => EN_ROUTE_INCIDENT_STATUSES.has(inc.status)) ?? null;

  // What the map frames on / shows the device dot for — the active drive if
  // there is one, otherwise the incident this crew is being dispatched to.
  const focusIncident =
    activeIncident
    || (pendingTask
      ? {
          id:     pendingTask.incident,
          title:  pendingTask.incident_title ?? `Incident #${pendingTask.incident}`,
          lat:    pendingTask.incident_lat,
          lng:    pendingTask.incident_lng,
          status: pendingTask.incident_status,
        }
      : null);

  const handleOnMyWay = async () => {
    if (!pendingTask) return;
    setOnMyWayBusy(true);
    try {
      await markOnMyWay(pendingTask, token, user);
      await load();
    } catch (_) {
      setError("Could not mark en route. Try again.");
    } finally {
      setOnMyWayBusy(false);
    }
  };

  const handleArrived = async () => {
    if (!task?.id) return;
    setArrivedBusy(true);
    try {
      await markArrived(task, token, user);
      await load();
    } catch (_) {
      setError("Could not confirm arrival. Try again.");
    } finally {
      setArrivedBusy(false);
    }
  };

  // One GPS fix (+ a light watch) — only used for the vehicle marker and the
  // first camera framing before the crew accepts. Once a trip is running the
  // shared trip owns the position.
  useEffect(() => {
    if (!focusIncident) return undefined;
    let stopWatch;
    let cancelled = false;
    getDeviceLocation().then((loc) => { if (!cancelled) setDeviceLocation(loc); });
    watchDeviceLocation((loc) => { if (!cancelled) setDeviceLocation(loc); })
      .then((stop) => { if (cancelled) stop(); else stopWatch = stop; });
    return () => { cancelled = true; stopWatch?.(); };
  }, [focusIncident?.id]);

  // Fetch the shared trip as soon as THIS crew has accepted (task IN_PROGRESS)
  // — not gated on the incident's shared status, which another unit may have
  // pushed past EN_ROUTE. Re-fetched on a slow interval so a server-side
  // rebuild (after a restart) or a corrected path is picked up.
  const driving =
    myTaskAccepted && hasCoords && !incidentFinished && task?.id != null;
  useEffect(() => {
    if (!driving) { setTrip(null); return undefined; }
    let cancelled = false;
    const pull = () => fetchTrip(task.id, token, user)
      .then((t) => { if (!cancelled && t) setTrip(t); });
    pull();
    const iv = setInterval(pull, 10000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [driving, task?.id, token, user]);

  // 1 s clock — only while a trip is live — to advance the interpolated marker.
  useEffect(() => {
    if (!trip) return undefined;
    const iv = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [trip]);

  const ts = trip ? tripState(trip, nowMs) : null;

  // Just accepted ("On My Way") and the road route is now known → zoom the
  // camera to the whole route + the vehicle, once per task.
  useEffect(() => {
    if (!mapRef.current || !task?.id || !myTaskAccepted) return;
    const route = ts?.fullRoute;
    if (!Array.isArray(route) || route.length < 2) return;
    if (framedRouteForRef.current === task.id) return;
    framedRouteForRef.current = task.id;
    // Mark the plain fit as done too so it doesn't fight this one.
    fittedForRef.current = focusIncident?.id ?? fittedForRef.current;
    mapRef.current.fitToCoordinates(route, { edgePadding: FIT_EDGE_PADDING, animated: true });
  }, [task?.id, myTaskAccepted, ts?.fullRoute?.length]);

  // Frame the vehicle + incident once when the trip first appears, then FOLLOW
  // the vehicle — re-centre the camera on it every tick while it's moving so
  // "the screen moves according to the mobile's progress". Stops following
  // once arrived so the crew can look around the scene.
  useEffect(() => {
    if (!mapRef.current || !focusIncident) return;
    if (fittedForRef.current !== focusIncident.id) {
      const start = ts?.position
        || (deviceLocation && { latitude: deviceLocation.latitude, longitude: deviceLocation.longitude });
      if (!start) return;
      fittedForRef.current = focusIncident.id;
      mapRef.current.fitToCoordinates(
        [start, { latitude: focusIncident.lat, longitude: focusIncident.lng }],
        { edgePadding: FIT_EDGE_PADDING, animated: true },
      );
      return;
    }
    if (ts?.position && !ts.arrived) {
      mapRef.current.animateCamera(
        { center: { latitude: ts.position.latitude, longitude: ts.position.longitude } },
        { duration: 900 },
      );
    }
  }, [focusIncident?.id, ts?.position?.latitude, ts?.position?.longitude, ts?.arrived, deviceLocation]);

  // Every time the crew opens / switches back to the Map screen, zoom the
  // camera to the vehicle and the road still ahead of it to the event. The
  // fit effects above only run ONCE per task, so a return visit to this tab
  // would otherwise keep whatever zoom the crew left behind. useFocusEffect
  // fires on every focus (fresh mount AND re-focus of a kept-mounted screen),
  // which useIsFocused's render signal alone did not reliably do under the
  // native-stack navigator. Live trip/GPS values are read from a ref at fire
  // time so the callback identity stays stable (no re-fit mid-drive).
  const focusFitRef = useRef({});
  focusFitRef.current = { ts, deviceLocation, focusIncident };
  useFocusEffect(
    useCallback(() => {
      // Let the fit effects re-run for a fresh task after this focus, too.
      framedRouteForRef.current = null;
      // Wait out the screen transition — fitToCoordinates is a no-op if the
      // MapView hasn't laid out yet.
      const timer = setTimeout(() => {
        const { ts: t, deviceLocation: dl, focusIncident: fi } = focusFitRef.current;
        const vehicle = t?.position
          || (dl && { latitude: dl.latitude, longitude: dl.longitude });
        const remaining = Array.isArray(t?.remaining) ? t.remaining : [];
        let target = null;
        if (remaining.length >= 2) {
          target = remaining;                         // vehicle → road ahead → event
        } else if (vehicle && fi) {
          target = [vehicle, { latitude: fi.lat, longitude: fi.lng }];
        }
        if (target && mapRef.current) {
          mapRef.current.fitToCoordinates(target, { edgePadding: FIT_EDGE_PADDING, animated: true });
        }
      }, 450);
      return () => clearTimeout(timer);
    }, []),
  );

  const load = async (isFirst = false) => {
    if (isFirst) { setLoading(true); setError(""); }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), isFirst ? 8000 : 12000);
      const url = selectedUnit?.id
        ? `${API_BASE_URL}/api/tasks/?mock_unit=${selectedUnit.id}`
        : `${API_BASE_URL}/api/tasks/`;
      const res = await fetch(url, {
        headers: getAuthHeaders(token, user),
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tasks = await res.json();
      setTaskList(Array.isArray(tasks) ? tasks : []);
      setIncidents(deduplicateIncidents(tasks));
      setError("");
    } catch (err) {
      // Only block the whole screen on the very first load — a dropped
      // background poll must not replace the live route with an error card.
      if (isFirst) setError("Could not load incident map. Check your connection.");
    } finally {
      if (isFirst) setLoading(false);
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
        <TouchableOpacity style={styles.retryBtn} onPress={() => load(true)}>
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

  // Vehicle position + remaining road from the shared trip (interpolated by the
  // 1 s clock). Before the trip is live, fall back to the device's GPS.
  const vehiclePos = ts?.position
    || (deviceLocation && { latitude: deviceLocation.latitude, longitude: deviceLocation.longitude })
    || null;
  const routeLine = ts?.remaining ?? [];
  const vehicleIcon = VEHICLE_ICON[selectedUnit?.type] || "🚓";

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

        {vehiclePos && (
          <Marker coordinate={vehiclePos} title={selectedUnit?.name || "Your vehicle"} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.vehicleMarker}>
              <Text style={styles.vehicleMarkerIcon}>{vehicleIcon}</Text>
            </View>
          </Marker>
        )}

        {routeLine.length > 1 && (
          <Polyline coordinates={routeLine} strokeColor="#1d4ed8" strokeWidth={5} />
        )}
      </MapView>

      {incidents.length === 0 && (
        <View style={styles.emptyBadge}>
          <Text style={styles.emptyBadgeText}>No active incidents for your unit</Text>
        </View>
      )}

      {pendingTask && !activeIncident && (
        <View style={styles.routeCard}>
          <Text style={styles.routeCardTitle} numberOfLines={2}>
            {pendingTask.incident_title ?? `Incident #${pendingTask.incident}`}
          </Text>
          <Text style={styles.routeCardStatus}>Dispatched — accept to start</Text>
          <TouchableOpacity
            style={[styles.onMyWayBtn, onMyWayBusy && styles.onMyWayBtnBusy]}
            onPress={handleOnMyWay}
            disabled={onMyWayBusy}
            activeOpacity={0.85}
          >
            {onMyWayBusy
              ? <ActivityIndicator color="#FFFFFF" size="small" />
              : <Text style={styles.onMyWayBtnText}>🚗  ON MY WAY</Text>}
          </TouchableOpacity>
        </View>
      )}

      {activeIncident && (() => {
        // "On scene" reflects ONLY this crew's own confirmed arrival — never
        // the shared incident status (another unit may have driven the
        // incident to ON_SCENE while this crew is still on the road).
        const confirmed = !!task?.arrived_at;
        const nearScene = deviceLocation && Number.isFinite(activeIncident.lat)
          ? (deviceLocation.isMock || haversineKm(
              deviceLocation.latitude, deviceLocation.longitude,
              activeIncident.lat, activeIncident.lng,
            ) <= ARRIVAL_RADIUS_KM)
          : false;
        const canConfirmArrival = !confirmed
          && task?.status === "IN_PROGRESS"
          && (nearScene || (ts && ts.arrived));
        return (
          <View style={styles.routeCard}>
            <Text style={styles.routeCardTitle} numberOfLines={2}>{activeIncident.title}</Text>
            <Text style={styles.routeCardStatus}>
              {confirmed ? "On Scene" : "En Route"}
            </Text>
            {confirmed ? (
              <Text style={styles.routeCardHint}>Arrived on scene — begin operations.</Text>
            ) : canConfirmArrival ? (
              <TouchableOpacity
                style={[styles.onMyWayBtn, { backgroundColor: "#1565C0" }, arrivedBusy && styles.onMyWayBtnBusy]}
                onPress={handleArrived}
                disabled={arrivedBusy}
                activeOpacity={0.85}
              >
                {arrivedBusy
                  ? <ActivityIndicator color="#FFFFFF" size="small" />
                  : <Text style={styles.onMyWayBtnText}>✓  ARRIVED AT SCENE</Text>}
              </TouchableOpacity>
            ) : ts ? (
              <View style={styles.routeMetrics}>
                <View style={styles.routeMetric}>
                  <Text style={styles.routeMetricValue}>{ts.remainingKm.toFixed(1)} km</Text>
                  <Text style={styles.routeMetricLabel}>DISTANCE</Text>
                </View>
                <View style={styles.routeMetric}>
                  <Text style={styles.routeMetricValue}>
                    {`${Math.max(1, Math.round(ts.remainingMin))} min`}
                  </Text>
                  <Text style={styles.routeMetricLabel}>ETA</Text>
                </View>
              </View>
            ) : (
              <Text style={styles.routeCardHint}>Calculating route…</Text>
            )}
          </View>
        );
      })()}

      {/* Legend — priority dots use the exact same PRIORITY_COLOR map the
          incident pins above are colored from, so this can't drift out of
          sync with what's actually on the map. Also explains the two other
          markers this screen draws: the vehicle emoji and the route line. */}
      <View style={styles.legend}>
        {[["HIGH",PRIORITY_COLOR.HIGH],["MED",PRIORITY_COLOR.MED],["LOW",PRIORITY_COLOR.LOW]].map(
          ([label, color]) => (
            <View key={label} style={styles.legendRow}>
              <View style={[styles.dot, { backgroundColor: color }]} />
              <Text style={styles.legendText}>{label}</Text>
            </View>
          )
        )}
        <View style={styles.legendDivider} />
        <View style={styles.legendRow}>
          <Text style={styles.legendVehicleIcon}>{vehicleIcon}</Text>
          <Text style={styles.legendText}>Your vehicle</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={styles.legendRouteLine} />
          <Text style={styles.legendText}>Route</Text>
        </View>
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

  vehicleMarker: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "#FFFFFF",
    borderWidth: 2, borderColor: "#1d4ed8",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3, shadowRadius: 3, elevation: 4,
  },
  vehicleMarkerIcon: { fontSize: 18, lineHeight: 22 },

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
  legendDivider: { height: 1, backgroundColor: "#E0E6EB", marginVertical: 2 },
  legendVehicleIcon: { fontSize: 14, width: 14, textAlign: "center", lineHeight: 14 },
  legendRouteLine: { width: 14, height: 4, borderRadius: 2, backgroundColor: "#1d4ed8" },

  routeCard: {
    position: "absolute", bottom: 20, left: 16, right: 16,
    backgroundColor: "#FFFFFF", borderRadius: 14, padding: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18, shadowRadius: 10, elevation: 5,
  },
  routeCardTitle:  { fontSize: 15, fontWeight: "700", color: "#1E2A3A" },
  routeCardStatus: { fontSize: 12, color: "#546E7A", marginTop: 2, marginBottom: 10 },
  onMyWayBtn: {
    backgroundColor: "#E65100",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 4,
  },
  onMyWayBtnBusy: { backgroundColor: "#90A4AE" },
  onMyWayBtnText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800", letterSpacing: 0.6 },
  routeCardHint:   { fontSize: 12, color: "#90A4AE", marginTop: 4 },
  routeMetrics:    { flexDirection: "row", gap: 24 },
  routeMetric:      { alignItems: "flex-start" },
  routeMetricValue: { fontSize: 20, fontWeight: "800", color: "#1565C0" },
  routeMetricLabel: { fontSize: 10, fontWeight: "700", color: "#90A4AE", letterSpacing: 0.5, marginTop: 2 },
});
