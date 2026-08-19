import { useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
} from "react-native";
import { Surface } from "react-native-paper";
import { API_BASE_URL } from "../config";
import { useUser } from "../context/UserContext";
import { getAuthHeaders } from "../utils/apiClient";

const STATUS_CONFIG = {
  DONE:        { bg: "#E8F5E9", color: "#2E7D32", label: "Done" },
  IN_PROGRESS: { bg: "#FFF3E0", color: "#E65100", label: "In Progress" },
  PENDING:     { bg: "#ECEFF1", color: "#546E7A", label: "Pending" },
};

function getStatusCfg(status) {
  return STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;
}

export default function TasksScreen({ token, selectedUnit, onSelectTask, onViewRoute }) {
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { user } = useUser();

  const fetchTasks = async (isPull = false) => {
    if (isPull) setRefreshing(true);
    // No setLoading(true) here — loading starts true from useState and is cleared
    // after the first fetch. Background interval calls stay silent.
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const url = selectedUnit?.id
        ? `${API_BASE_URL}/api/tasks/?mock_unit=${selectedUnit.id}`
        : `${API_BASE_URL}/api/tasks/`;
      const res = await fetch(url, {
        headers: getAuthHeaders(token, user),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTasks(data);
      setError("");
    } catch (err) {
      setError("Could not load tasks. Pull to refresh.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    fetchTasks();
    const interval = setInterval(() => fetchTasks(), 8000); // 8s silent background poll
    return () => clearInterval(interval);
  }, [token, selectedUnit?.id]);

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
            <Text style={styles.sectionLabel}>MY TASKS</Text>
            <Text style={styles.taskCount}>{tasks.length} assigned</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>✅</Text>
            <Text style={styles.emptyTitle}>No tasks assigned</Text>
            <Text style={styles.emptyHint}>Pull down to refresh</Text>
          </View>
        }
        renderItem={({ item }) => {
          const cfg = getStatusCfg(item.status);
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
                  <Text style={styles.incidentRef}>Incident #{item.incident}</Text>
                ) : null}
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

  actionRow: { flexDirection: "row", gap: 10 },
  reportBtn: {
    flex: 1,
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
