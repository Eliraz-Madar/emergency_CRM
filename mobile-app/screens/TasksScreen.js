import { useEffect, useState } from "react";
import { View, Text, Button, FlatList } from "react-native";

export default function TasksScreen({ token, onSelectTask }) {
  const [tasks, setTasks] = useState([]);

  const fetchTasks = async () => {
    const res = await fetch("http://localhost:8000/api/tasks/", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    setTasks(data);
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 18, marginBottom: 12 }}>My Tasks</Text>
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
