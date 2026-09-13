import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:1420", trace: "retain-on-failure", colorScheme: "dark" },
  projects: [
    { name: "desk", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "small", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 640 } } },
  ],
  webServer: {
    command: "VITE_IPC_MOCK=1 bun run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
