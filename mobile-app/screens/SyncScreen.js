import { useEffect, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, Switch, StyleSheet, ScrollView,
  ActivityIndicator,
} from "react-native";
import { Surface } from "react-native-paper";
import { getReports, clearReports } from "../storage/offlineDB";
import { API_BASE_URL } from "../config";
import { useUser } from "../context/UserContext";
import { getAuthHeaders } from "../utils/apiClient";
import { getDeviceLocation } from "../utils/location";

export default function SyncScreen({ token, online, setOnline }) {
  const [reports, setReports] = useState([]);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [locationNotice, setLocationNotice] = useState("");
  const isSyncingRef = useRef(false);
  const { user } = useUser();

  const loadReports = async () => {
    const data = await getReports();
    setReports(data);
  };

  useEffect(() => { loadReports(); }, []);

  const syncNow = async (pendingReports) => {
    if (!online || isSyncingRef.current) return;
    const toSync = pendingReports ?? reports;
    if (toSync.length === 0) return;
    isSyncingRef.current = true;
    setSyncing(true);
    setError("");
    try {
      const location = await getDeviceLocation();
      setLocationNotice(
        location.isMock
          ? "Live GPS unavailable — using default location for this sync."
          : ""
      );
      for (const report of toSync) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        await fetch(`${API_BASE_URL}/api/incidents/`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders(token, user) },
          body: JSON.stringify({
            title: `Offline ${report.title}`,
            description: report.details,
            location_lat: location.latitude,
            location_lng: location.longitude,
            severity: "LOW",
            status: "OPEN",
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
      }
      await clearReports();
      setReports([]);
    } catch (err) {
      setError("Sync failed. Check your connection and try again.");
      console.warn(err);
    } finally {
      isSyncingRef.current = false;
      setSyncing(false);
    }
  };

  // Auto-sync when connection restored
  useEffect(() => {
    if (online && reports.length > 0) syncNow(reports);
  }, [online]);

  const canSync = online && reports.length > 0 && !syncing;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Connection status card */}
      <Surface
        style={[styles.statusCard, { borderLeftColor: online ? "#2E7D32" : "#C62828" }]}
        elevation={2}
      >
        <View style={[styles.statusDot, { backgroundColor: online ? "#4CAF50" : "#EF5350" }]} />
        <View style={styles.statusText}>
          <Text style={styles.statusTitle}>{online ? "ONLINE" : "OFFLINE"}</Text>
          <Text style={styles.statusSubtitle}>
            {online ? "Connected to command server" : "Operating without server connection"}
          </Text>
        </View>
      </Surface>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>⚠  {error}</Text>
        </View>
      ) : null}

      {locationNotice ? (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>📍  {locationNotice}</Text>
        </View>
      ) : null}

      {/* Offline queue */}
      <Text style={styles.sectionLabel}>OFFLINE QUEUE</Text>
      <Surface style={styles.card} elevation={2}>
        <View style={styles.queueRow}>
          <View>
            <Text style={styles.queueCount}>{reports.length}</Text>
            <Text style={styles.queueLabel}>
              {reports.length === 1 ? "report pending upload" : "reports pending upload"}
            </Text>
          </View>
          <TouchableOpacity style={styles.refreshBtn} onPress={loadReports}>
            <Text style={styles.refreshBtnText}>REFRESH</Text>
          </TouchableOpacity>
        </View>
      </Surface>

      {/* Connectivity toggle */}
      <Text style={styles.sectionLabel}>CONNECTIVITY</Text>
      <Surface style={styles.card} elevation={2}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleTitle}>Online Mode</Text>
            <Text style={styles.toggleSubtitle}>
              {online ? "Reports submitted to server" : "Reports saved locally"}
            </Text>
          </View>
          <Switch
            value={online}
            onValueChange={setOnline}
            trackColor={{ false: "#CFD8DC", true: "#90CAF9" }}
            thumbColor={online ? "#1565C0" : "#90A4AE"}
          />
        </View>
      </Surface>

      {/* Sync button */}
      <TouchableOpacity
        style={[styles.syncBtn, !canSync && styles.syncBtnDisabled]}
        onPress={() => syncNow()}
        disabled={!canSync}
        activeOpacity={0.85}
      >
        {syncing ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <Text style={styles.syncBtnText}>
            {reports.length > 0 ? `SYNC  (${reports.length})` : "SYNC"}
          </Text>
        )}
      </TouchableOpacity>

      {!online && reports.length > 0 && (
        <Text style={styles.autoSyncNote}>
          Reports will sync automatically when you reconnect.
        </Text>
      )}

      {online && reports.length === 0 && (
        <Text style={styles.allSyncedNote}>✓  All reports have been synced.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F0F4F8" },
  content: { padding: 16, paddingBottom: 40 },

  // Status card
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    borderLeftWidth: 5,
    marginBottom: 20,
    overflow: "hidden",
  },
  statusDot: { width: 14, height: 14, borderRadius: 7 },
  statusText: { flex: 1 },
  statusTitle: { fontSize: 15, fontWeight: "700", color: "#1E2A3A", letterSpacing: 0.5 },
  statusSubtitle: { fontSize: 12, color: "#546E7A", marginTop: 2 },

  // Error
  errorBox: {
    backgroundColor: "#FFEBEE",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: "#C62828",
  },
  errorText: { color: "#C62828", fontSize: 13, fontWeight: "500" },

  // Location fallback notice
  noticeBox: {
    backgroundColor: "#FFF8E1",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: "#F9A825",
  },
  noticeText: { color: "#8D6E00", fontSize: 13, fontWeight: "500" },

  // Section label
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#546E7A",
    letterSpacing: 1,
    marginBottom: 10,
  },

  // Generic card
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },

  // Queue row
  queueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  queueCount: { fontSize: 32, fontWeight: "800", color: "#1E2A3A" },
  queueLabel: { fontSize: 12, color: "#546E7A", marginTop: 2 },
  refreshBtn: {
    backgroundColor: "#E3F2FD",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  refreshBtnText: { color: "#1565C0", fontSize: 13, fontWeight: "700", letterSpacing: 0.5 },

  // Toggle row
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toggleInfo: { flex: 1, marginRight: 12 },
  toggleTitle: { fontSize: 15, fontWeight: "600", color: "#1E2A3A" },
  toggleSubtitle: { fontSize: 12, color: "#546E7A", marginTop: 2 },

  // Sync button
  syncBtn: {
    backgroundColor: "#1565C0",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 12,
  },
  syncBtnDisabled: { backgroundColor: "#CFD8DC" },
  syncBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800", letterSpacing: 1 },

  autoSyncNote: { textAlign: "center", color: "#90A4AE", fontSize: 12, lineHeight: 18 },
  allSyncedNote: { textAlign: "center", color: "#2E7D32", fontSize: 13, fontWeight: "600" },
});
