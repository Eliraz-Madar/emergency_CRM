import { useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, StatusBar, Platform,
} from "react-native";
import * as Notifications from "expo-notifications";
import { API_BASE_URL } from "../config";
import { useUser } from "../context/UserContext";
import { getAuthHeaders } from "../utils/apiClient";
import { getDeviceLocation } from "../utils/location";

const TYPE_COLOR = {
  Police:    "#1565C0",
  EMS:       "#C62828",
  Fire:      "#E65100",
  HomeFront: "#546E7A",
};

const TYPE_ICON = {
  Police:    "🚔",
  EMS:       "🚑",
  Fire:      "🚒",
  HomeFront: "🏠",
};

function distanceKm(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function registerPushToken(unitId, token, user) {
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
      body: JSON.stringify({ mock_unit_id: unitId, token: tokenData.data }),
    });
  } catch {
    // Push setup is optional — fail silently
  }
}

export default function UnitSelectScreen({ token, onSelectUnit }) {
  const [units, setUnits]                   = useState([]);
  const [loading, setLoading]                 = useState(true);
  const [claimingId, setClaimingId]           = useState(null);
  const [error, setError]                     = useState("");
  const [locationNotice, setLocationNotice]   = useState("");
  const [deviceLocation, setDeviceLocation]   = useState(null);
  const { user } = useUser();

  const accentColor = TYPE_COLOR[user?.unit_type] ?? "#1565C0";
  const icon = TYPE_ICON[user?.unit_type] ?? "🚨";

  useEffect(() => {
    loadUnits();
  }, []);

  const loadUnits = async () => {
    setLoading(true);
    setError("");
    try {
      const location = await getDeviceLocation();
      setDeviceLocation(location);
      setLocationNotice(
        location.isMock
          ? "Live GPS unavailable — showing nearby units without distance sorting."
          : ""
      );

      const params = new URLSearchParams({
        claimable: "true",
        lat: String(location.latitude),
        lng: String(location.longitude),
      });
      if (user?.unit_type) params.set("type", user.unit_type);

      const res = await fetch(`${API_BASE_URL}/api/units/?${params.toString()}`, {
        headers: getAuthHeaders(token, user),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.length === 0) {
        setError("No unclaimed units nearby.\nAsk a dispatcher to register a unit, then retry.");
      }
      setUnits(data);
    } catch {
      setError("Could not load units. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (unit) => {
    if (claimingId) return;
    setClaimingId(unit.id);
    setError("");
    try {
      const location = deviceLocation ?? (await getDeviceLocation());
      const res = await fetch(`${API_BASE_URL}/api/units/claim/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders(token, user) },
        body: JSON.stringify({
          id: unit.id,
          location_lat: location.latitude,
          location_lng: location.longitude,
        }),
      });

      if (res.status === 409) {
        setError(`${unit.name} was just claimed by someone else. Pick another unit.`);
        loadUnits();
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const claimedUnit = await res.json();
      await registerPushToken(claimedUnit.id, token, user);
      onSelectUnit(claimedUnit);
    } catch {
      setError("Could not claim this unit. Check your connection and try again.");
    } finally {
      setClaimingId(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: accentColor }]}>
      <StatusBar barStyle="light-content" backgroundColor={accentColor} />

      <View style={styles.header}>
        <Text style={styles.headerIcon}>{icon}</Text>
        <Text style={styles.headerTitle}>SELECT YOUR UNIT</Text>
        <Text style={styles.headerSub}>
          {user?.username?.toUpperCase()}  ·  {user?.unit_type?.toUpperCase()}
        </Text>
      </View>

      {locationNotice ? (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>📍  {locationNotice}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FFFFFF" />
        </View>
      ) : error && units.length === 0 ? (
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
          onRefresh={loadUnits}
          refreshing={false}
          ListHeaderComponent={
            error ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>⚠  {error}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>No {user?.unit_type ?? ""} units available nearby.</Text>
          }
          renderItem={({ item }) => {
            const dist = deviceLocation
              ? distanceKm(deviceLocation.latitude, deviceLocation.longitude, item.location_lat, item.location_lng)
              : null;
            const isClaiming = claimingId === item.id;
            return (
              <TouchableOpacity
                style={styles.card}
                onPress={() => handleSelect(item)}
                activeOpacity={0.85}
                disabled={!!claimingId}
              >
                <View style={styles.cardLeft}>
                  <Text style={[styles.cardIcon, { color: accentColor }]}>{icon}</Text>
                  <View>
                    <Text style={styles.cardName}>{item.name}</Text>
                    <Text style={styles.cardId}>
                      ID #{item.id}  ·  {item.type}
                      {dist != null ? `  ·  ${dist.toFixed(1)} km away` : ""}
                    </Text>
                  </View>
                </View>
                {isClaiming ? (
                  <ActivityIndicator size="small" color={accentColor} />
                ) : (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>CLAIM</Text>
                  </View>
                )}
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

  noticeBox: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 10,
  },
  noticeText: { color: "#FFFFFF", fontSize: 12, textAlign: "center" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  errorText:    { color: "#FFFFFF", fontSize: 14, textAlign: "center", paddingHorizontal: 32 },
  retryBtn:     { backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 8, paddingHorizontal: 24, paddingVertical: 10 },
  retryBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13, letterSpacing: 0.5 },

  errorBanner: {
    backgroundColor: "rgba(0,0,0,0.2)",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  errorBannerText: { color: "#FFFFFF", fontSize: 13, textAlign: "center" },

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

  badge: { backgroundColor: "#E3F2FD", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 12, fontWeight: "700", color: "#1565C0" },
});
