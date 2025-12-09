import { useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import LoginScreen from "./screens/LoginScreen";
import TasksScreen from "./screens/TasksScreen";
import ReportScreen from "./screens/ReportScreen";
import SyncScreen from "./screens/SyncScreen";

const Stack = createNativeStackNavigator();

export default function App() {
  const AUTH_BYPASS = true; // temporary disable auth
  const [token, setToken] = useState(AUTH_BYPASS ? "dev-token" : null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [online, setOnline] = useState(true);

  if (!token) {
    return <LoginScreen onLogin={setToken} />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Tasks">
          {(props) => (
            <TasksScreen {...props} token={token} onSelectTask={(task) => setSelectedTask(task)} />
          )}
        </Stack.Screen>
        <Stack.Screen name="Report">
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
        <Stack.Screen name="Sync">
          {(props) => (
            <SyncScreen {...props} token={token} online={online} setOnline={setOnline} />
          )}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
