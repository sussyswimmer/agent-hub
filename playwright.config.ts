import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:1420",
    trace: "retain-on-failure",
    colorScheme: "dark",
    // Open on the roster unless a test asks for the floor.
    //
    // The floor is the application's default (§8) and `floor.spec.ts` turns it back on. It is
    // off here because it builds a WebGL context on every `goto`, and this runner has no GPU —
    // every test in the suite was paying for a software-rasterised tower it had no opinion
    // about, and the whole run went from three minutes to over twelve. It is a stored
    // preference (§8.7), so setting it is the same thing a person clicking Roster would do.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://localhost:1420",
          localStorage: [{ name: "grimoire.floor", value: "0" }],
        },
      ],
    },
  },
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
