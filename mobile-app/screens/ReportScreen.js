import { useState } from "react";
import { Platform, View, Text, TextInput, Button } from "react-native";
import { saveReport } from "../storage/offlineDB";

export default function ReportScreen({ selectedTask, token, online, onDone }) {
  const API_BASE_URL = Platform.OS === "android" ? "http://10.0.2.2:8000" : "http://localhost:8000";
  const [status, setStatus] = useState("IN_PROGRESS");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const taskTitle = selectedTask?.title || "task";

  const sendUpdate = async () => {
    if (!selectedTask) throw new Error("No task selected");
    const payload = { status };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const res = await fetch(`${API_BASE_URL}/api/tasks/${selectedTask.id}/`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    
    if (!res.ok) throw new Error("Failed to update task");
  };

  const handleSubmit = async () => {
    if (!selectedTask) return;
    try {
      if (online) {
        await sendUpdate();
        onDone();
      } else {
        await saveReport(taskTitle, notes, status, null);
        onDone();
      }
    } catch (err) {
      setError("Unable to submit report. Saved locally.");
      console.warn(err);
      await saveReport(taskTitle, notes, status, null);
      onDone();
    }
  };

  return (
    <View style={{ padding: 16 }}>
      <Text>Report Update for {selectedTask?.title || "selected task"}</Text>
      {error ? <Text style={{ color: "red", marginBottom: 8 }}>{error}</Text> : null}
      <TextInput placeholder="Status" value={status} onChangeText={setStatus} />
      <TextInput placeholder="Notes" value={notes} onChangeText={setNotes} />
      <Button title="Submit" onPress={handleSubmit} />
    </View>
  );
}
