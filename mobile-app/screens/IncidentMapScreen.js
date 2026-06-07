import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from "react-native";
import MapView, { Marker, Callout } from "react-native-maps";
import { API_BASE_URL } from "../config";
import { useUser } from "../context/UserContext";
import { getAuthHeaders } from "../utils/apiClient";

const PRIORITY_COLOR = {
  CRITICAL: "#D32F2F",
  HIGH:     "#F57C00",
  MEDIUM:   "#FBC02D",
  MED:      "#FBC02D",
  LOW:      "#388E3C",
};

const STATUS_LABEL = {
  OPEN:        "Open",
  IN_PROGRESS: "In Progress",
  CLOSED:      "Closed",
};

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

export default function IncidentMapScreen({ token, selectedUnit }) {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const { user } = useUser();

  useEffect(() => {
    if (!token) return;
    load();
  }, [token]);

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
      <MapView style={StyleSheet.absoluteFill} initialRegion={initialRegion}>
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
      </MapView>

      {incidents.length === 0 && (
        <View style={styles.emptyBadge}>
          <Text style={styles.emptyBadgeText}>No active incidents for your unit</Text>
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
});
