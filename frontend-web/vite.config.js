import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "localhost",
    strictPort: false, // Use next available port if 5173 is taken
    cors: true,
  },
});
