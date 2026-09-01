import { useCallback, useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { Surface } from "react-native-paper";
import { API_BASE_URL } from "../config";
import { useUser } from "../context/UserContext";
import { getAuthHeaders } from "../utils/apiClient";

// The five headcounts a crew reports for an incident. Ready format — the crew
// only taps the steppers, never types a sentence.
const FIELDS = [
  { key: "injured",   label: "Injured",   icon: "🩹", color: "#E65100" },
  { key: "trapped",   label: "Trapped",   icon: "⛓️", color: "#C62828" },
  { key: "dead",      label: "Dead",      icon: "🕯️", color: "#607D8B" },
  { key: "treated",   label: "Treated",   icon: "➕", color: "#1565C0" },
  { key: "evacuated", label: "Evacuated", icon: "🚸", color: "#2E7D32" },
];

const EMPTY = { injured: 0, dead: 0, trapped: 0, treated: 0, evacuated: 0 };

export default function FiguresScreen({ selectedTask, selectedUnit, token }) {
  const { user } = useUser();
  const isFocused = useIsFocused();
  const incidentId = selectedTask?.incident;
  const incidentTitle = selectedTask?.incident_title || `Incident #${incidentId}`;

  const [counts, setCounts] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [lastSaved, setLastSaved] = useState(null);

  // Pull this crew's own last-submitted row so the form starts where they
  // left off (this is a running headcount, not a fresh log every time).
  const load = useCallback(async () => {
    if (incidentId == null) { setLoading(false); return; }
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/incidents/${incidentId}/figures/`,
        { headers: getAuthHeaders(token, user), cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      const mine = Array.isArray(rows)
        ? rows.find((r) => r.unit === selectedUnit?.id) : null;
      if (mine) {
        setCounts({
          injured: mine.injured, dead: mine.dead, trapped: mine.trapped,
          treated: mine.treated, evacuated: mine.evacuated,
        });
        setLastSaved(mine.updated_at);
      }
      setError("");
    } catch (_) {
      setError("Could not load current figures. Pull to refresh.");
    } finally {
      setLoading(false);
    }
  }, [incidentId, selectedUnit?.id, token, user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (isFocused) load(); }, [isFocused, load]);

  const bump = (key, delta) =>
    setCounts((c) => ({ ...c, [key]: Math.max(0, (c[key] || 0) + delta) }));

  const submit = async () => {
    if (incidentId == null) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/incidents/${incidentId}/figures/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders(token, user) },
          body: JSON.stringify(counts),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setLastSaved(new Date().toISOString());
      Alert.alert("Figures sent", "The field war-room has your updated numbers.");
    } catch (_) {
      setError("Could not send figures. Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1565C0" />
        <Text style={styles.hint}>Loading figures…</Text>
      </View>
    );
  }

  const total = FIELDS.reduce((n, f) => n + (counts[f.key] || 0), 0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.sectionLabel}>CASUALTY FIGURES</Text>
        <Text style={styles.incident} numberOfLines={1}>{incidentTitle}</Text>
        {lastSaved ? (
          <Text style={styles.lastSaved}>Last sent {timeAgo(lastSaved)}</Text>
        ) : (
          <Text style={styles.lastSaved}>Not reported yet</Text>
        )}
      </View>

      {error ? (
        <View style={styles.errorBox}><Text style={styles.errorText}>⚠  {error}</Text></View>
      ) : null}

      {FIELDS.map((f) => (
        <Surface key={f.key} style={styles.row} elevation={1}>
          <View style={styles.rowLabel}>
            <Text style={styles.rowIcon}>{f.icon}</Text>
            <Text style={styles.rowText}>{f.label}</Text>
          </View>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={[styles.stepBtn, styles.stepMinus]}
              onPress={() => bump(f.key, -1)}
              activeOpacity={0.7}
            >
              <Text style={styles.stepBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={[styles.count, { color: f.color }]}>{counts[f.key] || 0}</Text>
            <TouchableOpacity
              style={[styles.stepBtn, styles.stepPlus]}
              onPress={() => bump(f.key, 1)}
              activeOpacity={0.7}
            >
              <Text style={styles.stepBtnText}>＋</Text>
            </TouchableOpacity>
          </View>
        </Surface>
      ))}

      <TouchableOpacity
        style={[styles.submit, saving && styles.submitDisabled]}
        onPress={submit}
        disabled={saving}
        activeOpacity={0.85}
      >
        {saving
          ? <ActivityIndicator color="#FFFFFF" />
          : <Text style={styles.submitText}>SEND FIGURES  ({total})</Text>}
      </TouchableOpacity>

      <Text style={styles.note}>
        These numbers replace your previous report for this incident and roll
        up into the field war-room's totals.
      </Text>
    </ScrollView>
  );
}

function timeAgo(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F0F4F8" },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#F0F4F8" },
  hint: { color: "#546E7A", fontSize: 14 },

  header: { marginBottom: 16 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#546E7A", letterSpacing: 1 },
  incident: { fontSize: 15, fontWeight: "700", color: "#1E2A3A", marginTop: 3 },
  lastSaved: { fontSize: 12, color: "#90A4AE", marginTop: 2 },

  errorBox: {
    backgroundColor: "#FFEBEE", borderRadius: 10, padding: 12, marginBottom: 14,
    borderLeftWidth: 3, borderLeftColor: "#C62828",
  },
  errorText: { color: "#C62828", fontSize: 13 },

  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#FFFFFF", borderRadius: 12, padding: 14, marginBottom: 10,
  },
  rowLabel: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowIcon: { fontSize: 20 },
  rowText: { fontSize: 15, fontWeight: "600", color: "#1E2A3A" },

  stepper: { flexDirection: "row", alignItems: "center", gap: 14 },
  stepBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center",
  },
  stepMinus: { backgroundColor: "#ECEFF1" },
  stepPlus: { backgroundColor: "#E3F2FD" },
  stepBtnText: { fontSize: 20, fontWeight: "800", color: "#37474F" },
  count: { fontSize: 20, fontWeight: "800", minWidth: 32, textAlign: "center" },

  submit: {
    backgroundColor: "#1565C0", borderRadius: 12, paddingVertical: 16,
    alignItems: "center", marginTop: 8,
  },
  submitDisabled: { backgroundColor: "#90A4AE" },
  submitText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800", letterSpacing: 1 },

  note: { fontSize: 12, color: "#90A4AE", marginTop: 12, lineHeight: 17, textAlign: "center" },
});
