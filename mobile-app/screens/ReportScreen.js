import { useState, useEffect, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Image, Alert, ActivityIndicator,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Surface } from "react-native-paper";
import { saveReport } from "../storage/offlineDB";
import { API_BASE_URL } from "../config";
import { useUser } from "../context/UserContext";
import { getAuthHeaders } from "../utils/apiClient";
import { markOnMyWay, markArrived } from "../utils/taskActions";

// Field workflow, not raw task states:
//  EN_ROUTE  -> markOnMyWay  (task IN_PROGRESS + incident EN_ROUTE)
//  ON_SCENE  -> markArrived  (task IN_PROGRESS + incident ON_SCENE) = "in progress"
//  DONE      -> task DONE
const STATUS_OPTIONS = [
  { value: "EN_ROUTE", label: "En Route",    color: "#E65100", bg: "#FFF3E0" },
  { value: "ON_SCENE", label: "In Progress", color: "#1565C0", bg: "#E3F2FD" },
  { value: "DONE",     label: "Done",        color: "#2E7D32", bg: "#E8F5E9" },
];

// Pre-select the option that matches where the crew already is.
function defaultStatusFor(task) {
  if (task?.status === "DONE") return "DONE";
  if (task?.incident_status === "ON_SCENE") return "ON_SCENE";
  return "EN_ROUTE";
}

const MAX_ATTACHMENTS = 5;

// Short "how long ago" label for the report history list.
function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export default function ReportScreen({ selectedTask, token, online, onDone }) {
  const originalStatus = defaultStatusFor(selectedTask);
  const [status, setStatus] = useState(originalStatus);
  const [notes, setNotes] = useState("");
  const [mediaFiles, setMediaFiles] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { user } = useUser();
  const taskTitle = selectedTask?.title || "task";
  const activeCfg = STATUS_OPTIONS.find((s) => s.value === status) || STATUS_OPTIONS[0];

  // ── Previously-sent reports for this task ──────────────────────────────────
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    if (selectedTask?.id == null) { setHistoryLoading(false); return; }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(
        `${API_BASE_URL}/api/tasks/${selectedTask.id}/reports/`,
        { headers: getAuthHeaders(token, user), signal: controller.signal },
      );
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        setHistory(Array.isArray(data) ? data : []);
      }
    } catch (_) {
      // History is non-critical — the form still works without it.
    } finally {
      setHistoryLoading(false);
    }
  }, [selectedTask?.id, token, user]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // ── Media helpers ──────────────────────────────────────────────────────────

  const requestLibraryPermission = async () => {
    const { status: ps } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (ps !== "granted") {
      Alert.alert("Permission Required", "Allow photo library access in Settings to attach files.");
      return false;
    }
    return true;
  };

  const requestCameraPermission = async () => {
    const { status: ps } = await ImagePicker.requestCameraPermissionsAsync();
    if (ps !== "granted") {
      Alert.alert("Permission Required", "Allow camera access in Settings to take photos.");
      return false;
    }
    return true;
  };

  const appendAssets = (assets) => {
    const newFiles = assets.map((a) => ({
      uri: a.uri,
      type: a.mimeType || (a.type === "video" ? "video/mp4" : "image/jpeg"),
      name: a.fileName || `attachment_${Date.now()}.${a.type === "video" ? "mp4" : "jpg"}`,
      mediaType: a.type === "video" ? "video" : "image",
    }));
    setMediaFiles((prev) => [...prev, ...newFiles].slice(0, MAX_ATTACHMENTS));
  };

  const takePhoto = async () => {
    if (!(await requestCameraPermission())) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (!result.canceled) appendAssets(result.assets);
  };

  const pickImages = async () => {
    if (!(await requestLibraryPermission())) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.7,
    });
    if (!result.canceled) appendAssets(result.assets);
  };

  const pickVideos = async () => {
    if (!(await requestLibraryPermission())) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      allowsMultipleSelection: true,
      videoMaxDuration: 120,
    });
    if (!result.canceled) appendAssets(result.assets);
  };

  const recordVideo = async () => {
    if (!(await requestCameraPermission())) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["videos"],
      videoMaxDuration: 120,
      quality: 0.8,
    });
    if (!result.canceled) appendAssets(result.assets);
  };

  const removeMedia = (index) =>
    setMediaFiles((prev) => prev.filter((_, i) => i !== index));

  // ── Network calls ──────────────────────────────────────────────────────────

  const sendTaskUpdate = async () => {
    // "En Route" / "In Progress" (arrived) are field-workflow steps, not raw
    // Task statuses — the helpers move both the task and the incident.
    if (status === "EN_ROUTE") {
      await markOnMyWay(selectedTask, token, user);
      return;
    }
    if (status === "ON_SCENE") {
      await markArrived(selectedTask, token, user);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${API_BASE_URL}/api/tasks/${selectedTask.id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...getAuthHeaders(token, user) },
      body: JSON.stringify({ status: "DONE" }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${res.status}`);
    }
  };

  const sendEventWithMedia = async () => {
    const statusLabel = STATUS_OPTIONS.find((s) => s.value === status)?.label || status;
    const descParts = [];
    if (status !== originalStatus) descParts.push(`Status set to: ${statusLabel}`);
    if (notes.trim()) descParts.push(`Notes: ${notes.trim()}`);

    try {
      const formData = new FormData();
      formData.append("event_type", "STATUS_CHANGE");
      formData.append("severity", "INFO");
      formData.append("title", `Task Update: ${taskTitle}`);
      formData.append("description", descParts.join("\n"));
      formData.append("created_by", user?.username || "Field Unit");
      // Link the report to its incident so it reaches the regional event feed
      // and any linked Field Command Post's timeline.
      if (selectedTask?.incident != null) {
        formData.append("incident_id", String(selectedTask.incident));
      }
      if (selectedTask?.id != null) {
        formData.append("task_id", String(selectedTask.id));
      }
      for (const file of mediaFiles) {
        formData.append("files", { uri: file.uri, type: file.type, name: file.name });
      }
      await fetch(`${API_BASE_URL}/api/field/add-event/?fieldId=default`, {
        method: "POST",
        // add-event requires X-Actor-Role to tag the timeline source; the
        // mobile app always reports as a field UNIT.
        headers: { ...getAuthHeaders(token, user), "X-Actor-Role": "UNIT" },
        body: formData,
      });
    } catch (err) {
      console.warn("[ReportScreen] Event/media upload non-fatal:", err.message);
    }
  };

  const handleSubmit = async () => {
    if (!selectedTask) { setError("No task selected."); return; }
    // Offline queue stores a raw task status: EN_ROUTE / ON_SCENE both map to
    // IN_PROGRESS; DONE stays DONE.
    const offlineStatus = status === "DONE" ? "DONE" : "IN_PROGRESS";
    setLoading(true);
    setError("");
    try {
      if (online) {
        await sendTaskUpdate();
        await sendEventWithMedia();
        loadHistory(); // refresh the "previously sent" list before leaving
      } else {
        await saveReport(taskTitle, notes, offlineStatus, null);
      }
      onDone();
    } catch (err) {
      setError(err.message || "Failed to submit report.");
      try { await saveReport(taskTitle, notes, offlineStatus, null); } catch (_) {}
    } finally {
      setLoading(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Task header card */}
      <Surface style={styles.taskCard} elevation={2}>
        <View style={[styles.taskCardStripe, { backgroundColor: activeCfg.bg }]} />
        <View style={styles.taskCardInner}>
          <Text style={styles.taskTitle}>{taskTitle}</Text>
          <View style={[styles.statusPill, { backgroundColor: activeCfg.bg }]}>
            <Text style={[styles.statusPillText, { color: activeCfg.color }]}>
              {activeCfg.label}
            </Text>
          </View>
        </View>
      </Surface>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>⚠  {error}</Text>
        </View>
      ) : null}

      {/* ── Status selector ─────────────────────────────────────────────── */}
      <Text style={styles.sectionLabel}>UPDATE STATUS</Text>
      <View style={styles.statusRow}>
        {STATUS_OPTIONS.map((opt) => {
          const active = status === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.statusChip,
                active && { backgroundColor: opt.bg, borderColor: opt.color },
              ]}
              onPress={() => setStatus(opt.value)}
              activeOpacity={0.8}
            >
              {active && <View style={[styles.statusChipDot, { backgroundColor: opt.color }]} />}
              <Text style={[styles.statusChipText, active && { color: opt.color, fontWeight: "700" }]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Notes ───────────────────────────────────────────────────────── */}
      <Text style={styles.sectionLabel}>NOTES</Text>
      <TextInput
        placeholder="Add situational notes…"
        value={notes}
        onChangeText={setNotes}
        multiline
        numberOfLines={4}
        placeholderTextColor="#90A4AE"
        style={styles.notesInput}
        textAlignVertical="top"
      />

      {/* ── Attachments ─────────────────────────────────────────────────── */}
      <Text style={styles.sectionLabel}>
        ATTACHMENTS{mediaFiles.length > 0 ? `  ${mediaFiles.length} / ${MAX_ATTACHMENTS}` : ""}
      </Text>
      <View style={styles.attachButtonRow}>
        <TouchableOpacity style={styles.attachBtn} onPress={takePhoto} activeOpacity={0.85}>
          <Text style={styles.attachBtnIcon}>📷</Text>
          <Text style={styles.attachBtnText}>Photo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.attachBtn} onPress={recordVideo} activeOpacity={0.85}>
          <Text style={styles.attachBtnIcon}>🎬</Text>
          <Text style={styles.attachBtnText}>Record</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.attachBtn} onPress={pickImages} activeOpacity={0.85}>
          <Text style={styles.attachBtnIcon}>🖼</Text>
          <Text style={styles.attachBtnText}>Photos</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.attachBtn} onPress={pickVideos} activeOpacity={0.85}>
          <Text style={styles.attachBtnIcon}>🎥</Text>
          <Text style={styles.attachBtnText}>Videos</Text>
        </TouchableOpacity>
      </View>

      {/* Thumbnails */}
      {mediaFiles.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.thumbRow}
          contentContainerStyle={styles.thumbRowContent}
        >
          {mediaFiles.map((file, idx) => (
            <View key={idx} style={styles.thumbWrapper}>
              {file.mediaType === "image" ? (
                <Image source={{ uri: file.uri }} style={styles.thumb} />
              ) : (
                <View style={styles.videoThumb}>
                  <Text style={styles.videoThumbIcon}>▶</Text>
                  <Text style={styles.videoThumbLabel}>Video</Text>
                </View>
              )}
              <TouchableOpacity style={styles.removeBtn} onPress={() => removeMedia(idx)}>
                <Text style={styles.removeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* ── Submit ──────────────────────────────────────────────────────── */}
      <TouchableOpacity
        style={[styles.submitBtn, loading && styles.submitBtnLoading]}
        onPress={handleSubmit}
        disabled={loading}
        activeOpacity={0.85}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <Text style={styles.submitBtnText}>
            {online ? "SUBMIT REPORT" : "SAVE OFFLINE"}
          </Text>
        )}
      </TouchableOpacity>

      {!online && (
        <Text style={styles.offlineNote}>
          📶  Offline — report will sync when connection is restored
        </Text>
      )}

      {/* ── Previously sent ─────────────────────────────────────────────── */}
      <View style={styles.historyHeader}>
        <Text style={styles.sectionLabel}>
          PREVIOUSLY SENT{history.length > 0 ? `  ${history.length}` : ""}
        </Text>
        <TouchableOpacity onPress={loadHistory} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.historyRefresh}>↻</Text>
        </TouchableOpacity>
      </View>

      {historyLoading ? (
        <ActivityIndicator color="#90A4AE" style={{ marginVertical: 12 }} />
      ) : history.length === 0 ? (
        <Text style={styles.historyEmpty}>No reports sent for this task yet.</Text>
      ) : (
        history.map((ev) => (
          <View key={ev.id} style={styles.historyCard}>
            <View style={styles.historyCardTop}>
              <Text style={styles.historyTitle} numberOfLines={1}>{ev.title}</Text>
              <Text style={styles.historyTime}>{timeAgo(ev.created_at)}</Text>
            </View>
            {ev.description ? (
              <Text style={styles.historyDesc}>{ev.description}</Text>
            ) : null}
            {Array.isArray(ev.media) && ev.media.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.historyThumbRow}
                contentContainerStyle={styles.thumbRowContent}
              >
                {ev.media.map((m) => (
                  m.media_type === "image" ? (
                    <Image key={m.id} source={{ uri: m.file_url }} style={styles.historyThumb} />
                  ) : (
                    <View key={m.id} style={styles.historyVideoThumb}>
                      <Text style={styles.videoThumbIcon}>▶</Text>
                    </View>
                  )
                ))}
              </ScrollView>
            )}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F0F4F8" },
  content: { padding: 16, paddingBottom: 40 },

  // Task header card
  taskCard: {
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
    marginBottom: 16,
    flexDirection: "row",
  },
  taskCardStripe: { width: 5 },
  taskCardInner: {
    flex: 1,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  taskTitle: { flex: 1, fontSize: 16, fontWeight: "600", color: "#1E2A3A", lineHeight: 22 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusPillText: { fontSize: 12, fontWeight: "600" },

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

  // Section labels
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#546E7A",
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 4,
  },

  // Status chips
  statusRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  statusChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1.5,
    borderColor: "#CFD8DC",
    borderRadius: 10,
    paddingVertical: 11,
    backgroundColor: "#FFFFFF",
  },
  statusChipDot: { width: 7, height: 7, borderRadius: 4 },
  statusChipText: { fontSize: 13, color: "#546E7A", fontWeight: "500" },

  // Notes
  notesInput: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#CFD8DC",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1E2A3A",
    minHeight: 100,
    marginBottom: 20,
  },

  // Attach buttons
  attachButtonRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 },
  attachBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#CFD8DC",
    gap: 4,
  },
  attachBtnIcon: { fontSize: 22 },
  attachBtnText: { fontSize: 12, fontWeight: "600", color: "#546E7A" },

  // Thumbnails
  thumbRow: { marginBottom: 20 },
  thumbRowContent: { gap: 10, paddingRight: 4 },
  thumbWrapper: { position: "relative" },
  thumb: { width: 88, height: 88, borderRadius: 10, backgroundColor: "#E0E0E0" },
  videoThumb: {
    width: 88, height: 88, borderRadius: 10,
    backgroundColor: "#1E2A3A",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  videoThumbIcon: { fontSize: 22, color: "#FFFFFF" },
  videoThumbLabel: { fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: "600" },
  removeBtn: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: "#C62828",
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  removeBtnText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },

  // Submit
  submitBtn: {
    backgroundColor: "#1565C0",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 12,
  },
  submitBtnLoading: { backgroundColor: "#90A4AE" },
  submitBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800", letterSpacing: 1 },

  offlineNote: {
    textAlign: "center",
    color: "#90A4AE",
    fontSize: 12,
    lineHeight: 18,
  },

  // Previously-sent history
  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
    marginBottom: 4,
  },
  historyRefresh: { fontSize: 18, color: "#546E7A", paddingHorizontal: 4 },
  historyEmpty: { color: "#90A4AE", fontSize: 13, fontStyle: "italic", marginBottom: 8 },
  historyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E0E6EB",
    padding: 12,
    marginBottom: 10,
  },
  historyCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  historyTitle: { flex: 1, fontSize: 13, fontWeight: "700", color: "#1E2A3A" },
  historyTime:  { fontSize: 11, color: "#90A4AE" },
  historyDesc:  { fontSize: 13, color: "#546E7A", marginTop: 4, lineHeight: 18 },
  historyThumbRow: { marginTop: 8 },
  historyThumb: { width: 60, height: 60, borderRadius: 8, backgroundColor: "#E0E0E0" },
  historyVideoThumb: {
    width: 60, height: 60, borderRadius: 8,
    backgroundColor: "#1E2A3A",
    alignItems: "center", justifyContent: "center",
  },
});
