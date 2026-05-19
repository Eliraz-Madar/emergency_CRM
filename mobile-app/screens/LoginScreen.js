import { useState } from "react";
import { Platform, View, TextInput, Button, Text } from "react-native";

export default function LoginScreen({ onLogin }) {
  const API_BASE_URL = Platform.OS === "android" ? "http://10.0.2.2:8000" : "http://localhost:8000";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleLogin = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/token/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) throw new Error("Bad credentials");
      const data = await res.json();
      onLogin(data.access);
    } catch (err) {
      setError("Login failed");
      console.warn(err);
    }
  };

  return (
    <View style={{ padding: 20 }}>
      <Text>Field Unit Login</Text>
      {error ? <Text style={{ color: "red" }}>{error}</Text> : null}
      <TextInput placeholder="Username" value={username} onChangeText={setUsername} />
      <TextInput
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <Button title="Login" onPress={handleLogin} />
    </View>
  );
}
