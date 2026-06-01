import { useState, useEffect, useRef } from "react";
import { TouchableOpacity, Text, Alert, StyleSheet } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { PaperProvider } from "react-native-paper";
import NetInfo from "@react-native-community/netinfo";
import { UserProvider } from "./context/UserContext";
import LoginScreen from "./screens/LoginScreen";
import TasksScreen from "./screens/TasksScreen";
import ReportScreen from "./screens/ReportScreen";
import SyncScreen from "./screens/SyncScreen";

const Stack = createNativeStackNavigator();

const NAV_HEADER = {
  headerStyle: { backgroundColor: "#1565C0" },
  headerTintColor: "#FFFFFF",
  headerTitleStyle: { fontWeight: "700", fontSize: 16, letterSpacing: 0.5 },
  headerBackTitle: "",
};

function AppContent() {
  const [token, setToken] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [online, setOnline] = useState(true);
  const wasOnlineRef = useRef(true);

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
              onPress: () => {
                NetInfo.fetch().then((s) =>
                  setOnline(!!(s.isConnected && s.isInternetReachable !== false))
                );
              },
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

  if (!token) return <LoginScreen onLogin={setToken} />;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={NAV_HEADER}>
        <Stack.Screen
          name="Tasks"
          options={({ navigation }) => ({
            title: "Field Tasks",
            headerRight: () => (
              <TouchableOpacity
                onPress={() => navigation.navigate("Sync")}
                style={styles.headerBtn}
              >
                <Text style={styles.headerBtnText}>SYNC</Text>
              </TouchableOpacity>
            ),
          })}
        >
          {(props) => (
            <TasksScreen
              {...props}
              token={token}
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
      </Stack.Navigator>
    </NavigationContainer>
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
    paddingVertical: 6,
    borderRadius: 6,
  },
  headerBtnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
    letterSpacing: 0.5,
  },
});
