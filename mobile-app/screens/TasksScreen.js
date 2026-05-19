import { useEffect, useState } from "react";
import { Platform, View, Text, Button, FlatList } from "react-native";

export default function TasksScreen({ token, onSelectTask }) {
  const API_BASE_URL = Platform.OS === "android" ? "http://10.0.2.2:8000" : "http://localhost:8000";
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState("");

  const fetchTasks = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/tasks/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load tasks");
      const data = await res.json();
      setTasks(data);
      setError("");
    } catch (err) {
      setError("Unable to load tasks. Check your backend URL and network.");
      console.warn(err);
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 18, marginBottom: 12 }}>My Tasks</Text>
      {error ? <Text style={{ color: "red", marginBottom: 12 }}>{error}</Text> : null}
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
