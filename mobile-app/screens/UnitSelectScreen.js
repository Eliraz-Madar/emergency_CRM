import { useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, StatusBar, Platform,
} from "react-native";
import * as Notifications from "expo-notifications";
import { API_BASE_URL } from "../config";
import { useUser } from "../context/UserContext";
import { getAuthHeaders } from "../utils/apiClient";

// Maps DB unit type (from JWT) to the display name used for colour/icon theming
const DB_TYPE_TO_DISPLAY = {
  Police: "Police",
  EMS:    "Ambulance",
  Fire:   "Fire",
};

// Maps DB unit type to the routine type string used by the backend
const DB_TYPE_TO_ROUTINE = {
  Police: "POLICE",
  EMS:    "MEDICAL",
  Fire:   "FIRE",
};

const TYPE_COLOR = {
  Police:    "#1565C0",
  Ambulance: "#C62828",
  Fire:      "#E65100",
};

const TYPE_ICON = {
  Police:    "🚔",
  Ambulance: "🚑",
  Fire:      "🚒",
};

const STATUS_STYLE = {
  Available:  { bg: "#E8F5E9", color: "#2E7D32" },
  Dispatched: { bg: "#FFF3E0", color: "#E65100" },
  OnScene:    { bg: "#E3F2FD", color: "#1565C0" },
  Offline:    { bg: "#ECEFF1", color: "#546E7A" },
};

async function registerPushToken(mockUnitId, token, user) {
  if (Platform.OS === "web") return;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("dispatch", {
        name: "Dispatch Alerts",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        sound: "default",
      });
    }

    const tokenData = await Notifications.getExpoPushTokenAsync();
    if (!tokenData?.data) return;

    await fetch(`${API_BASE_URL}/api/push-token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders(token, user) },
      body: JSON.stringify({ mock_unit_id: mockUnitId, token: tokenData.data }),
    });
  } catch {
    // Push setup is optional — fail silently
  }
}

export default function UnitSelectScreen({ token, onSelectUnit }) {
  const [units, setUnits]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const { user } = useUser();

  const mockType = DB_TYPE_TO_DISPLAY[user?.unit_type] ?? user?.unit_type;
  const accentColor = TYPE_COLOR[mockType] ?? "#1565C0";
  const icon = TYPE_ICON[mockType] ?? "🚨";

  useEffect(() => {
    loadUnits();
  }, []);

  const loadUnits = async () => {
    setLoading(true);
    setError("");
    try {
      const routineType = DB_TYPE_TO_ROUTINE[user?.unit_type];
      const url = routineType
        ? `${API_BASE_URL}/api/mobile/units/?type=${routineType}`
        : `${API_BASE_URL}/api/mobile/units/`;
      const res = await fetch(url, {
        headers: getAuthHeaders(token, user),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.length === 0) {
        setError("No units registered yet.\nOpen the War-Room Dashboard first, then retry.");
      }
      setUnits(data);
    } catch {
      setError("Could not load units. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (unit) => {
    await registerPushToken(unit.id, token, user);
    onSelectUnit(unit);
  };

  return (
    <View style={[styles.container, { backgroundColor: accentColor }]}>
      <StatusBar barStyle="light-content" backgroundColor={accentColor} />

      <View style={styles.header}>
        <Text style={styles.headerIcon}>{icon}</Text>
        <Text style={styles.headerTitle}>SELECT YOUR UNIT</Text>
        <Text style={styles.headerSub}>
          {user?.username?.toUpperCase()}  ·  {mockType?.toUpperCase()}
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FFFFFF" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>⚠  {error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadUnits}>
            <Text style={styles.retryBtnText}>RETRY</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={units}
          keyExtractor={(u) => String(u.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No {mockType} units available.</Text>
          }
          renderItem={({ item }) => {
            const ss = STATUS_STYLE[item.status] ?? STATUS_STYLE.Offline;
            return (
              <TouchableOpacity
                style={styles.card}
                onPress={() => handleSelect(item)}
                activeOpacity={0.85}
              >
                <View style={styles.cardLeft}>
                  <Text style={[styles.cardIcon, { color: accentColor }]}>{icon}</Text>
                  <View>
                    <Text style={styles.cardName}>{item.name}</Text>
                    <Text style={styles.cardId}>ID #{item.id}  ·  {item.type}</Text>
                  </View>
                </View>
                <View style={[styles.badge, { backgroundColor: ss.bg }]}>
                  <Text style={[styles.badgeText, { color: ss.color }]}>{item.status}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: { alignItems: "center", paddingTop: 56, paddingBottom: 24, paddingHorizontal: 24 },
  headerIcon:  { fontSize: 48, marginBottom: 10 },
  headerTitle: { fontSize: 22, fontWeight: "800", color: "#FFFFFF", letterSpacing: 3 },
  headerSub:   { fontSize: 13, color: "rgba(255,255,255,0.7)", marginTop: 6, letterSpacing: 1 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  errorText:    { color: "#FFFFFF", fontSize: 14, textAlign: "center", paddingHorizontal: 32 },
  retryBtn:     { backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 8, paddingHorizontal: 24, paddingVertical: 10 },
  retryBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13, letterSpacing: 0.5 },

  list: { padding: 16, paddingBottom: 32 },
  emptyText: { textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 15, marginTop: 48 },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    marginBottom: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  cardLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  cardIcon: { fontSize: 26 },
  cardName: { fontSize: 16, fontWeight: "700", color: "#1E2A3A" },
  cardId:   { fontSize: 12, color: "#90A4AE", marginTop: 2 },

  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 12, fontWeight: "600" },
});
