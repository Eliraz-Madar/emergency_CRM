import { useCallback, useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { Surface } from "react-native-paper";
import { API_BASE_URL } from "../config";
import { useUser } from "../context/UserContext";
import { getAuthHeaders } from "../utils/apiClient";

// Unit.type (Police / EMS / Fire / HomeFront) -> the war room's POLICE / FIRE /
// MEDICAL force_type scheme.
function forceTypeOf(unitType) {
  const t = String(unitType || "").toUpperCase();
  if (t === "FIRE") return "FIRE";
  if (t === "EMS" || t === "AMBULANCE" || t === "MEDICAL") return "MEDICAL";
  return "POLICE";
}

const STATUS_META = {
  OPEN:        { label: "Open",   color: "#E65100", bg: "#FFF3E0" },
  IN_PROGRESS: { label: "On it",  color: "#1565C0", bg: "#E3F2FD" },
  DONE:        { label: "Done",   color: "#2E7D32", bg: "#E8F5E9" },
};

export default function MissionsScreen({ selectedTask, selectedUnit, token }) {
  const { user } = useUser();
  const isFocused = useIsFocused();
  const [missions, setMissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const fieldKey = selectedTask?.field_command_key;
  const incidentId = selectedTask?.incident;
  const force = forceTypeOf(selectedUnit?.type);

  const load = useCallback(async (silent = false) => {
    if (!fieldKey || incidentId == null) { setLoading(false); return; }
    if (!silent) setLoading(true);
    try {
      const url = `${API_BASE_URL}/api/field-commands/${fieldKey}/missions/`
        + `?incident=${incidentId}&force_type=${force}`;
      const res = await fetch(url, { headers: getAuthHeaders(token, user), cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMissions(Array.isArray(data) ? data : []);
      setError("");
    } catch (_) {
      if (!silent) setError("Could not load missions. Pull to refresh.");
    } finally {
      setLoading(false);
    }
  }, [fieldKey, incidentId, force, token, user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!isFocused) return undefined;
    const iv = setInterval(() => load(true), 10000);
    return () => clearInterval(iv);
  }, [isFocused, load]);

  const setStatus = async (mission, status) => {
    setBusyId(mission.id);
    // optimistic
    setMissions((prev) => prev.map((m) => (m.id === mission.id ? { ...m, status } : m)));
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/field-commands/${fieldKey}/missions/${mission.id}/`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getAuthHeaders(token, user) },
          body: JSON.stringify({ status }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load(true);
    } catch (_) {
      setError("Could not update the mission. Pull to refresh.");
      load(true);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#5E35B1" />
        <Text style={styles.hint}>Loading missions…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={missions}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={styles.list}
        onRefresh={() => load()}
        refreshing={false}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.sectionLabel}>MISSIONS · {force}</Text>
            <Text style={styles.incident} numberOfLines={1}>
              {selectedTask?.incident_title || `Incident #${incidentId}`}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>🗂</Text>
            <Text style={styles.emptyTitle}>No missions for your force yet</Text>
            <Text style={styles.emptyHint}>The command center assigns these per incident.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const cfg = STATUS_META[item.status] || STATUS_META.OPEN;
          const busy = busyId === item.id;
          return (
            <Surface style={styles.card} elevation={2}>
              <View style={styles.cardTop}>
                <Text style={styles.title} numberOfLines={3}>{item.title}</Text>
                <View style={[styles.pill, { backgroundColor: cfg.bg }]}>
                  <Text style={[styles.pillText, { color: cfg.color }]}>{cfg.label}</Text>
                </View>
              </View>
              {item.details ? <Text style={styles.details}>{item.details}</Text> : null}
              <View style={styles.btnRow}>
                <TouchableOpacity
                  style={[styles.btn, styles.onItBtn, item.status === "IN_PROGRESS" && styles.btnActive]}
                  disabled={busy || item.status === "IN_PROGRESS"}
                  onPress={() => setStatus(item, "IN_PROGRESS")}
                  activeOpacity={0.85}
                >
                  <Text style={styles.btnText}>{busy ? "…" : "ON IT"}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.doneBtn, item.status === "DONE" && styles.btnActive]}
                  disabled={busy || item.status === "DONE"}
                  onPress={() => setStatus(item, "DONE")}
                  activeOpacity={0.85}
                >
                  <Text style={styles.btnText}>{busy ? "…" : "FINISHED"}</Text>
                </TouchableOpacity>
              </View>
            </Surface>
          );
        }}
      />
      {error ? (
        <View style={styles.errorBanner}><Text style={styles.errorText}>⚠  {error}</Text></View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F0F4F8" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#F0F4F8" },
  hint: { color: "#546E7A", fontSize: 14 },

  list: { padding: 16, paddingBottom: 32 },
  header: { marginBottom: 14 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#5E35B1", letterSpacing: 1 },
  incident: { fontSize: 13, color: "#90A4AE", marginTop: 3 },

  card: { borderRadius: 14, marginBottom: 12, backgroundColor: "#FFFFFF", padding: 16 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  title: { flex: 1, fontSize: 15, fontWeight: "600", color: "#1E2A3A", lineHeight: 21 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, flexShrink: 0 },
  pillText: { fontSize: 12, fontWeight: "700" },
  details: { fontSize: 13, color: "#546E7A", marginTop: 6, lineHeight: 18 },

  btnRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  btn: { flex: 1, borderRadius: 9, paddingVertical: 12, alignItems: "center" },
  onItBtn: { backgroundColor: "#1565C0" },
  doneBtn: { backgroundColor: "#2E7D32" },
  btnActive: { opacity: 0.4 },
  btnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", letterSpacing: 0.6 },

  emptyBox: { alignItems: "center", paddingVertical: 56 },
  emptyIcon: { fontSize: 44, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: "#1E2A3A" },
  emptyHint: { fontSize: 13, color: "#90A4AE", marginTop: 6, textAlign: "center", paddingHorizontal: 24 },

  errorBanner: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#FFEBEE", padding: 12, borderTopWidth: 1, borderTopColor: "#FFCDD2",
  },
  errorText: { color: "#C62828", fontSize: 13, textAlign: "center" },
});
