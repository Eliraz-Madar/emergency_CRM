import { useState } from "react";
import { View, TextInput, Button, Text } from "react-native";

export default function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleLogin = async () => {
    try {
      const res = await fetch("http://localhost:8000/api/token/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) throw new Error("Bad credentials");
      const data = await res.json();
      onLogin(data.access);
    } catch (err) {
      setError("Login failed");
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
