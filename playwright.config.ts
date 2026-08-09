import { defineConfig, devices } from "@playwright/test";
import { DEV_PORT } from "./ports";

// Vitest owns tests/unit; this suite drives a real browser against a live dev server, so it
// stays a separate config with its own testDir, not just a different `include` glob.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: `http://localhost:${DEV_PORT}`,
    trace: "on-first-retry",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${DEV_PORT}`,
    url: `http://localhost:${DEV_PORT}`,
    reuseExistingServer: !process.env.CI,
  },
  workers: 6,
});
