import { useEffect, useRef, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import NetInfo from "@react-native-community/netinfo";
import { Surface } from "react-native-paper";
import { API_BASE_URL } from "../config";
import { useUser } from "../context/UserContext";
import { getAuthHeaders } from "../utils/apiClient";
import { markOnMyWay, markArrived } from "../utils/taskActions";
import { getDeviceLocation } from "../utils/location";
import { haversineKm } from "../utils/trip";

// Within this distance of the incident the crew is treated as "on scene" and
// the Arrived button appears. Generous enough to absorb GPS drift and the
// mock-location fallback.
const ARRIVAL_RADIUS_KM = 0.25;

const STATUS_CONFIG = {
  DONE:        { bg: "#E8F5E9", color: "#2E7D32", label: "Done" },
  ON_SCENE:    { bg: "#E3F2FD", color: "#1565C0", label: "On Scene" },
  EN_ROUTE:    { bg: "#FFF3E0", color: "#E65100", label: "On the Way" },
  PENDING:     { bg: "#ECEFF1", color: "#546E7A", label: "Pending" },
};

// A task's displayed status is NOT its raw DB status — IN_PROGRESS covers both
// "driving" and "on scene". Resolve it from THIS crew's own confirmed arrival
// (task.arrived_at) — never the shared incident status, which another unit may
// already have driven to ON_SCENE while this crew is still on the road.
function displayStatusFor(task) {
  if (task?.status === "DONE") return "DONE";
  if (task?.status !== "IN_PROGRESS") return "PENDING";
  if (task?.arrived_at) return "ON_SCENE";
  return "EN_ROUTE";
}

function getStatusCfg(task) {
  return STATUS_CONFIG[displayStatusFor(task)] || STATUS_CONFIG.PENDING;
}

// Button visibility is driven by THIS task's own status, not the shared
// incident status — a crew added to an incident that another unit already
// took ON_SCENE must still be able to tap "On My Way" for its own leg.
//   task PENDING            -> show "On My Way" (this crew hasn't accepted yet)
//   task IN_PROGRESS + near -> show "Arrived at Scene" (only within the geofence)
//   task IN_PROGRESS + far  -> show a hint to drive to the incident
//   arrived / incident done -> show nothing
const FINISHED_INCIDENT_STATUSES = ["RESOLVED", "CLOSED"];

export default function TasksScreen({ token, selectedUnit, onSelectTask, onViewRoute, onViewMissions, onViewFigures }) {
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [enRouteId, setEnRouteId] = useState(null);
  const [deviceLoc, setDeviceLoc] = useState(null);
  const { user } = useUser();
  const isFocused = useIsFocused();

  const fetchTasks = async (isPull = false) => {
    if (isPull) setRefreshing(true);
    // No setLoading(true) here — loading starts true from useState and is cleared
    // after the first fetch. Background interval calls stay silent.
    try {
      const controller = new AbortController();
      // Give a background poll longer to complete on a slow tunnel/emulator
      // link — a poll that times out at 5 s used to leave a cancelled dispatch
      // sitting in the list until the user pulled to refresh.
      const timeout = setTimeout(() => controller.abort(), isPull ? 8000 : 12000);
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
      const data = await res.json();
      // Drop finished/cancelled tasks and anything on a closed incident — the
      // dispatch is over, the unit shouldn't still see it in its queue.
      setTasks(
        (Array.isArray(data) ? data : []).filter(
          (t) => t.status !== "DONE"
            && t.status !== "CANCELLED"
            && t.incident_status !== "CLOSED",
        ),
      );
      setError("");
    } catch (err) {
      // A dropped background poll must not surface an error banner or wipe the
      // list — only a user-initiated pull reports failure.
      if (isPull) setError("Could not load tasks. Check your connection.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Keep the interval calling the *latest* fetchTasks closure (fresh `user`,
  // etc.) instead of the one captured when the effect first ran.
  const fetchTasksRef = useRef(fetchTasks);
  fetchTasksRef.current = fetchTasks;

  useEffect(() => {
    if (!token) return;
    fetchTasksRef.current();
    const interval = setInterval(() => fetchTasksRef.current(), 5000); // 5s silent background poll
    return () => clearInterval(interval);
  }, [token, selectedUnit?.id]);

  // Re-pull as soon as connectivity comes back so a change made while the
  // device was offline (e.g. the war-room removed this dispatch) shows up
  // without a manual refresh.
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        fetchTasksRef.current();
      }
    });
    return unsub;
  }, []);

  // Refresh the moment this screen regains focus — e.g. coming back from the
  // report/map screen — so a dispatch the war-room cancelled while we were away
  // (a vehicle whose association was removed) clears without a manual pull.
  useEffect(() => {
    if (isFocused && token) fetchTasksRef.current();
  }, [isFocused, token]);

  // Track the device position so the "Arrived at scene" button can appear only
  // once the crew is actually at the incident. Refreshed on focus and on a
  // slow interval — a GPS fix per 15 s is plenty for a geofence check.
  useEffect(() => {
    if (!isFocused) return undefined;
    let cancelled = false;
    const pull = () => getDeviceLocation().then((loc) => { if (!cancelled) setDeviceLoc(loc); });
    pull();
    const iv = setInterval(pull, 15000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [isFocused]);

  // True when the device is within ARRIVAL_RADIUS_KM of this task's incident.
  // With no real GPS fix (permission denied / emulator) we can't geofence, so
  // don't block the workflow — show the button and trust the crew.
  const isAtScene = (task) => {
    if (!deviceLoc || task?.incident_lat == null || task?.incident_lng == null) return false;
    if (deviceLoc.isMock) return true;
    return haversineKm(
      deviceLoc.latitude, deviceLoc.longitude, task.incident_lat, task.incident_lng,
    ) <= ARRIVAL_RADIUS_KM;
  };

  const handleOnMyWay = async (task) => {
    setEnRouteId(task.id);
    try {
      await markOnMyWay(task, token, user);
      await fetchTasks();
    } catch (_) {
      setError("Could not mark en route. Pull to refresh.");
    } finally {
      setEnRouteId(null);
    }
  };

  const handleArrived = async (task) => {
    setEnRouteId(task.id);
    try {
      await markArrived(task, token, user);
      await fetchTasks();
    } catch (_) {
      setError("Could not mark arrived. Pull to refresh.");
    } finally {
      setEnRouteId(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1565C0" />
        <Text style={styles.loadingText}>Loading tasks…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={tasks}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        onRefresh={() => fetchTasks(true /* isPull */)}
        refreshing={refreshing}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={styles.sectionLabel}>INCIDENTS</Text>
            <Text style={styles.taskCount}>{tasks.length} active</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>✅</Text>
            <Text style={styles.emptyTitle}>No incidents assigned</Text>
            <Text style={styles.emptyHint}>Pull down to refresh</Text>
          </View>
        }
        renderItem={({ item }) => {
          const cfg = getStatusCfg(item);
          // This crew can confirm its OWN arrival regardless of the shared
          // incident status (another unit may already be on scene).
          const showArrived = item.incident != null
            && item.status === "IN_PROGRESS"
            && !item.arrived_at
            && !FINISHED_INCIDENT_STATUSES.includes(item.incident_status)
            && isAtScene(item);
          return (
            <Surface style={styles.card} elevation={2}>
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <Text style={styles.taskTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
                    <Text style={[styles.badgeText, { color: cfg.color }]}>
                      {cfg.label}
                    </Text>
                  </View>
                </View>
                {item.incident ? (
                  <Text style={styles.incidentRef}>
                    {displayStatusFor(item) === "ON_SCENE"
                      ? `On scene · ${item.incident_title || `Incident #${item.incident}`}`
                      : displayStatusFor(item) === "EN_ROUTE"
                        ? `On the way · ${item.incident_title || `Incident #${item.incident}`}`
                        : item.incident_title || `Incident #${item.incident}`}
                  </Text>
                ) : null}
                {item.incident != null
                  && item.status === "PENDING"
                  && !FINISHED_INCIDENT_STATUSES.includes(item.incident_status) && (
                  <TouchableOpacity
                    style={styles.enRouteBtn}
                    onPress={() => handleOnMyWay(item)}
                    disabled={enRouteId === item.id}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.enRouteBtnText}>
                      {enRouteId === item.id ? "SENDING…" : "🚗  ON MY WAY"}
                    </Text>
                  </TouchableOpacity>
                )}
                {showArrived && (
                  <TouchableOpacity
                    style={styles.arrivedBtn}
                    onPress={() => handleArrived(item)}
                    disabled={enRouteId === item.id}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.enRouteBtnText}>
                      {enRouteId === item.id ? "SENDING…" : "✓  ARRIVED AT SCENE"}
                    </Text>
                  </TouchableOpacity>
                )}
                {item.incident != null
                  && item.status === "IN_PROGRESS"
                  && !item.arrived_at
                  && !FINISHED_INCIDENT_STATUSES.includes(item.incident_status)
                  && !isAtScene(item) && (
                  <Text style={styles.arriveHint}>
                    📍  Arrive at the incident to confirm you're on scene
                  </Text>
                )}
                <View style={styles.actionRow}>
                  {onViewRoute && item.incident_lat != null && item.incident_lng != null && (
                    <TouchableOpacity
                      style={styles.routeBtn}
                      onPress={() => onViewRoute(item)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.routeBtnText}>🗺 ROUTE</Text>
                    </TouchableOpacity>
                  )}
                  {onViewMissions && item.field_command_key && (
                    <TouchableOpacity
                      style={styles.missionsBtn}
                      onPress={() => onViewMissions(item)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.missionsBtnText}>🗂 MISSIONS</Text>
                    </TouchableOpacity>
                  )}
                  {onViewFigures && item.incident != null && (
                    <TouchableOpacity
                      style={styles.figuresBtn}
                      onPress={() => onViewFigures(item)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.figuresBtnText}>🔢 FIGURES</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.reportBtn}
                    onPress={() => onSelectTask(item)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.reportBtnText}>FILE REPORT  →</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Surface>
          );
        }}
      />

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>⚠  {error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F0F4F8" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#F0F4F8" },
  loadingText: { color: "#546E7A", fontSize: 14 },

  list: { padding: 16, paddingBottom: 32 },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#546E7A", letterSpacing: 1 },
  taskCount:    { fontSize: 12, color: "#90A4AE" },

  card: {
    borderRadius: 14,
    marginBottom: 12,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  cardBody: { padding: 16 },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 12,
  },
  taskTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#1E2A3A",
    lineHeight: 22,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    flexShrink: 0,
  },
  badgeText: { fontSize: 12, fontWeight: "600", letterSpacing: 0.3 },

  incidentRef: { fontSize: 12, color: "#90A4AE", marginBottom: 12 },

  enRouteBtn: {
    backgroundColor: "#E65100",
    borderRadius: 9,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 10,
  },
  arrivedBtn: {
    backgroundColor: "#1565C0",
    borderRadius: 9,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 10,
  },
  enRouteBtnText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800", letterSpacing: 0.6 },
  arriveHint: { color: "#90A4AE", fontSize: 12, marginBottom: 10, fontStyle: "italic" },

  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  reportBtn: {
    flexGrow: 1,
    flexBasis: "100%",
    backgroundColor: "#1565C0",
    borderRadius: 9,
    paddingVertical: 12,
    alignItems: "center",
  },
  reportBtnText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700", letterSpacing: 0.5 },
  routeBtn: {
    backgroundColor: "#E3F2FD",
    borderRadius: 9,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  routeBtnText: { color: "#1565C0", fontSize: 13, fontWeight: "700", letterSpacing: 0.3 },
  missionsBtn: {
    backgroundColor: "#EDE7F6",
    borderRadius: 9,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  missionsBtnText: { color: "#5E35B1", fontSize: 13, fontWeight: "700", letterSpacing: 0.3 },
  figuresBtn: {
    backgroundColor: "#FFF3E0",
    borderRadius: 9,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  figuresBtnText: { color: "#E65100", fontSize: 13, fontWeight: "700", letterSpacing: 0.3 },

  emptyBox: { alignItems: "center", paddingVertical: 64 },
  emptyIcon:  { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: "600", color: "#1E2A3A" },
  emptyHint:  { fontSize: 13, color: "#90A4AE", marginTop: 6 },

  errorBanner: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#FFEBEE",
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#FFCDD2",
  },
  errorBannerText: { color: "#C62828", fontSize: 13, textAlign: "center" },
});
