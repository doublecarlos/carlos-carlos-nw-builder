import { defineConfig, devices } from '@playwright/test';

// Vitest owns tests/unit; this suite drives a real browser against a live dev server, so it
// stays a separate config with its own testDir, not just a different `include` glob.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    // Playwright's own Chromium build -- the closest stand-in for Chrome that needs no
    // system install (a real `channel: 'chrome'` requires an admin-elevated install this
    // machine doesn't have).
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' }, dependencies: ['chromium'] },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, dependencies: ['chromium']},
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
