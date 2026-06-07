import { useState, useEffect, useRef } from "react";
import {
  TouchableOpacity, Text, Alert, StyleSheet,
  Modal, Pressable, View,
} from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createNavigationContainerRef } from "@react-navigation/native";
import { PaperProvider } from "react-native-paper";
import NetInfo from "@react-native-community/netinfo";
import * as Notifications from "expo-notifications";
import { UserProvider, useUser } from "./context/UserContext";
import LoginScreen        from "./screens/LoginScreen";
import UnitSelectScreen   from "./screens/UnitSelectScreen";
import TasksScreen        from "./screens/TasksScreen";
import ReportScreen       from "./screens/ReportScreen";
import SyncScreen         from "./screens/SyncScreen";
import IncidentMapScreen  from "./screens/IncidentMapScreen";

// Show alerts for notifications received while the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  false,
  }),
});

const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

const NAV_HEADER = {
  headerStyle:      { backgroundColor: "#1565C0" },
  headerTintColor:  "#FFFFFF",
  headerTitleStyle: { fontWeight: "700", fontSize: 16, letterSpacing: 0.5 },
  headerBackTitle:  "",
};

function AppContent() {
  const [token,        setToken]        = useState(null);
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [online,       setOnline]       = useState(true);
  const [menuVisible,  setMenuVisible]  = useState(false);
  const wasOnlineRef = useRef(true);
  const { user, setUser } = useUser();

  // Network change listener
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = !!(state.isConnected && state.isInternetReachable !== false);
      if (wasOnlineRef.current && !connected) {
        Alert.alert(
          "Connection Lost",
          "You appear to be offline. How would you like to proceed?",
          [
            { text: "Continue Offline", style: "cancel", onPress: () => setOnline(false) },
            {
              text: "Retry",
              onPress: () =>
                NetInfo.fetch().then((s) =>
                  setOnline(!!(s.isConnected && s.isInternetReachable !== false))
                ),
            },
          ],
          { cancelable: false }
        );
      } else {
        setOnline(connected);
      }
      wasOnlineRef.current = connected;
    });
    return unsubscribe;
  }, []);

  // Foreground notification tap → navigate to Tasks and refresh
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      if (navigationRef.isReady()) navigationRef.navigate("Tasks");
    });
    return () => sub.remove();
  }, []);

  const handleLogout = () => {
    setMenuVisible(false);
    setToken(null);
    setUser(null);
    setSelectedUnit(null);
  };

  // ── Routing ──────────────────────────────────────────────────────────────
  if (!token) return <LoginScreen onLogin={setToken} />;

  if (!selectedUnit) {
    return (
      <UnitSelectScreen
        token={token}
        onSelectUnit={(unit) => setSelectedUnit(unit)}
      />
    );
  }

  return (
    <>
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator screenOptions={NAV_HEADER}>

          <Stack.Screen
            name="Tasks"
            options={{
              title: `${selectedUnit.name}`,
              headerRight: () => (
                <TouchableOpacity
                  onPress={() => setMenuVisible(true)}
                  style={styles.headerBtn}
                >
                  <Text style={styles.headerBtnDots}>⋮</Text>
                </TouchableOpacity>
              ),
            }}
          >
            {(props) => (
              <TasksScreen
                {...props}
                token={token}
                selectedUnit={selectedUnit}
                onSelectTask={(task) => {
                  setSelectedTask(task);
                  props.navigation.navigate("Report");
                }}
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="Report" options={{ title: "File Report" }}>
            {(props) => (
              <ReportScreen
                {...props}
                selectedTask={selectedTask}
                token={token}
                online={online}
                onDone={() => props.navigation.navigate("Tasks")}
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="Sync" options={{ title: "Sync" }}>
            {(props) => (
              <SyncScreen {...props} token={token} online={online} setOnline={setOnline} />
            )}
          </Stack.Screen>

          <Stack.Screen name="Map" options={{ title: "Incident Map" }}>
            {(props) => (
              <IncidentMapScreen {...props} token={token} selectedUnit={selectedUnit} />
            )}
          </Stack.Screen>

        </Stack.Navigator>
      </NavigationContainer>

      {/* ── Bottom-sheet menu ── */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable style={styles.menuOverlay} onPress={() => setMenuVisible(false)}>
          <Pressable style={styles.menuSheet} onPress={() => {}}>

            <View style={styles.menuUserRow}>
              <View style={styles.menuAvatar}>
                <Text style={styles.menuAvatarText}>
                  {(user?.username?.[0] ?? "U").toUpperCase()}
                </Text>
              </View>
              <View>
                <Text style={styles.menuUsername}>{user?.username ?? "Field Unit"}</Text>
                <Text style={styles.menuRole}>
                  {selectedUnit?.name ?? (user?.unit_type ? `${user.unit_type} Unit` : "")}
                </Text>
              </View>
            </View>

            <View style={styles.menuDivider} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                if (navigationRef.isReady()) navigationRef.navigate("Map");
              }}
            >
              <Text style={styles.menuItemIcon}>🗺</Text>
              <Text style={styles.menuItemText}>Incident Map</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                if (navigationRef.isReady()) navigationRef.navigate("Sync");
              }}
            >
              <Text style={styles.menuItemIcon}>🔄</Text>
              <Text style={styles.menuItemText}>Sync</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                setSelectedUnit(null); // go back to unit selection
              }}
            >
              <Text style={styles.menuItemIcon}>🔁</Text>
              <Text style={styles.menuItemText}>Change Unit</Text>
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
              <Text style={styles.menuItemIcon}>🚪</Text>
              <Text style={[styles.menuItemText, styles.menuItemDanger]}>Disconnect</Text>
            </TouchableOpacity>

          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

export default function App() {
  return (
    <UserProvider>
      <PaperProvider>
        <AppContent />
      </PaperProvider>
    </UserProvider>
  );
}

const styles = StyleSheet.create({
  headerBtn: {
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBtnDots: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 22,
    lineHeight: 26,
  },

  menuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  menuSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
    paddingTop: 8,
  },
  menuUserRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  menuAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "#1565C0",
    alignItems: "center", justifyContent: "center",
  },
  menuAvatarText: { color: "#FFF", fontSize: 18, fontWeight: "700" },
  menuUsername:   { fontSize: 16, fontWeight: "700", color: "#1E2A3A" },
  menuRole:       { fontSize: 12, color: "#90A4AE", marginTop: 1 },

  menuDivider: { height: 1, backgroundColor: "#ECEFF1", marginVertical: 4 },

  menuItem: {
    flexDirection: "row", alignItems: "center",
    gap: 14, paddingHorizontal: 20, paddingVertical: 16,
  },
  menuItemIcon:   { fontSize: 20, width: 28, textAlign: "center" },
  menuItemText:   { fontSize: 16, color: "#1E2A3A", fontWeight: "500" },
  menuItemDanger: { color: "#C62828" },
});
