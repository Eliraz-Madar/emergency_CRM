import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, StatusBar,
} from "react-native";
import { API_BASE_URL } from "../config";
import { useUser } from "../context/UserContext";

export default function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { setUser } = useUser();

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError("Please enter your username and password.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${API_BASE_URL}/api/token/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error("invalid_credentials");
      const data = await res.json();
      setUser({
        id:        data.user_id,
        username:  data.username,
        role:      data.role,
        unit_id:   data.unit_id   ?? null,
        unit_type: data.unit_type ?? null,
      });
      onLogin(data.access);
    } catch (err) {
      if (err.message === "invalid_credentials") {
        setError("Invalid username or password.");
      } else {
        setError("Server unreachable. Check your connection.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <StatusBar barStyle="light-content" backgroundColor="#0D47A1" />

      {/* Brand block */}
      <View style={styles.brand}>
        <Text style={styles.brandIcon}>🚨</Text>
        <Text style={styles.brandTitle}>FIELD OPS</Text>
        <Text style={styles.brandSubtitle}>COMMAND UNIT</Text>
      </View>

      {/* Form card */}
      <View style={styles.card}>
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠  {error}</Text>
          </View>
        ) : null}

        <Text style={styles.fieldLabel}>USERNAME</Text>
        <TextInput
          placeholder="Enter username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor="#90A4AE"
          style={styles.input}
          returnKeyType="next"
        />

        <Text style={styles.fieldLabel}>PASSWORD</Text>
        <TextInput
          placeholder="Enter password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholderTextColor="#90A4AE"
          style={styles.input}
          returnKeyType="done"
          onSubmitEditing={handleLogin}
        />

        <TouchableOpacity
          style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
          onPress={handleLogin}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.loginBtnText}>SIGN IN</Text>
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>Authorized personnel only</Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1565C0",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  brand: {
    alignItems: "center",
    marginBottom: 32,
  },
  brandIcon: {
    fontSize: 52,
    marginBottom: 10,
  },
  brandTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 4,
  },
  brandSubtitle: {
    fontSize: 13,
    color: "rgba(255,255,255,0.7)",
    letterSpacing: 3,
    marginTop: 4,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  errorBox: {
    backgroundColor: "#FFEBEE",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: "#C62828",
  },
  errorText: {
    color: "#C62828",
    fontSize: 13,
    fontWeight: "500",
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#546E7A",
    letterSpacing: 1,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1.5,
    borderColor: "#CFD8DC",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1E2A3A",
    marginBottom: 16,
    backgroundColor: "#F8FAFC",
  },
  loginBtn: {
    backgroundColor: "#1565C0",
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 4,
  },
  loginBtnDisabled: {
    backgroundColor: "#90A4AE",
  },
  loginBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  footer: {
    textAlign: "center",
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    marginTop: 24,
    letterSpacing: 0.5,
  },
});
