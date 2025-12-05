import { useState } from "react";
import { View, Text, TextInput, Button } from "react-native";
import { saveReport } from "../storage/offlineDB";

export default function ReportScreen({ selectedTask, token, online, onDone }) {
  const [status, setStatus] = useState("IN_PROGRESS");
  const [notes, setNotes] = useState("");

  const sendUpdate = async () => {
    const payload = { status };
    const res = await fetch(`http://localhost:8000/api/tasks/${selectedTask.id}/`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Failed");
  };

  const handleSubmit = async () => {
    if (!selectedTask) return;
    try {
      if (online) {
        await sendUpdate();
        onDone();
      } else {
        await saveReport(selectedTask.title, notes, status, null);
        onDone();
      }
    } catch (err) {
      await saveReport(selectedTask.title, notes, status, null);
      onDone();
    }
  };

  return (
    <View style={{ padding: 16 }}>
      <Text>Report Update for {selectedTask?.title}</Text>
      <TextInput placeholder="Status" value={status} onChangeText={setStatus} />
      <TextInput placeholder="Notes" value={notes} onChangeText={setNotes} />
      <Button title="Submit" onPress={handleSubmit} />
    </View>
  );
}
