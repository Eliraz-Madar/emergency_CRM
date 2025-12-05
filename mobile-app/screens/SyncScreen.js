import { useEffect, useState } from "react";
import { View, Text, Button, Switch } from "react-native";
import { getReports, clearReports } from "../storage/offlineDB";

export default function SyncScreen({ token, online, setOnline }) {
  const [reports, setReports] = useState([]);

  const loadReports = async () => {
    const data = await getReports();
    setReports(data);
  };

  useEffect(() => {
    loadReports();
  }, []);

  const syncNow = async () => {
    if (!online) return;
    for (const report of reports) {
      await fetch("http://localhost:8000/api/incidents/", {
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
      });
    }
    await clearReports();
    setReports([]);
  };

  return (
    <View style={{ padding: 16 }}>
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
