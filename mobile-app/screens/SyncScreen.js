import { useEffect, useState } from "react";
import { View, Text, Button, Switch } from "react-native";
import { getReports, clearReports } from "../storage/offlineDB";
import { API_BASE_URL } from "../config";

export default function SyncScreen({ token, online, setOnline }) {
  const [reports, setReports] = useState([]);
  const [error, setError] = useState("");

  const loadReports = async () => {
    const data = await getReports();
    setReports(data);
  };

  useEffect(() => {
    loadReports();
  }, []);

  const syncNow = async () => {
    if (!online) return;
    try {
      for (const report of reports) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        
        await fetch(`${API_BASE_URL}/api/incidents/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: `Offline ${report.title}`,
            description: report.details,
            location_lat: 32.0,
            location_lng: 34.0,
            severity: "LOW",
            status: "OPEN",
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
      }
      await clearReports();
      setReports([]);
      setError("");
    } catch (err) {
      setError("Sync failed. Check your connection.");
      console.warn(err);
    }
  };

  return (
    <View style={{ padding: 16 }}>
      {error ? <Text style={{ color: "red", marginBottom: 12 }}>{error}</Text> : null}
      <Text>Offline Reports: {reports.length}</Text>
      <Button title="Refresh" onPress={loadReports} />
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 16 }}>
        <Text>Online Mode</Text>
        <Switch value={online} onValueChange={setOnline} />
      </View>
      <Button title="Sync" onPress={syncNow} disabled={!online} />
    </View>
  );
}
