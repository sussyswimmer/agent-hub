import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// Tauri expects a fixed port; `strictPort` makes a clash fail loudly.
const host = process.env["TAURI_DEV_HOST"];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    watch: { ignored: ["**/src-tauri/**", "**/target/**", "**/mcp/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // macOS WebKit (Tauri) and Chromium (Playwright) both handle this.
    target: "safari17",
    minify: !process.env["TAURI_ENV_DEBUG"],
    sourcemap: !!process.env["TAURI_ENV_DEBUG"],
  },
});
