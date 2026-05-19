import { useEffect, useState } from "react";
import { Platform, View, Text, Button, FlatList, ActivityIndicator } from "react-native";

export default function TasksScreen({ token, onSelectTask }) {
  const API_BASE_URL = Platform.OS === "android" ? "http://10.0.2.2:8000" : "http://localhost:8000";
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      console.log(`[TasksScreen] Fetching from: ${API_BASE_URL}/api/tasks/`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const res = await fetch(`${API_BASE_URL}/api/tasks/`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      
      console.log(`[TasksScreen] Response status: ${res.status}`);
      if (!res.ok) throw new Error(`Failed to load tasks: ${res.status}`);
      const data = await res.json();
      console.log(`[TasksScreen] Tasks loaded: ${data.length} items`);
      setTasks(data);
      setError("");
    } catch (err) {
      console.error(`[TasksScreen] Error:`, err.message);
      setError(`Unable to load tasks. Backend: ${API_BASE_URL} | Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, [token]);

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 18, marginBottom: 12 }}>My Tasks</Text>
      {loading && <ActivityIndicator size="large" color="#0000ff" />}
      {error ? <Text style={{ color: "red", marginBottom: 12, fontSize: 12 }}>{error}</Text> : null}
      <FlatList
        data={tasks}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <View style={{ marginBottom: 12, padding: 12, borderWidth: 1 }}>
            <Text>{item.title}</Text>
            <Text>Status: {item.status}</Text>
            <Button title="Report" onPress={() => onSelectTask(item)} />
          </View>
        )}
      />
    </View>
  );
}
