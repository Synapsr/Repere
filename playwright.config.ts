import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: ".env", quiet: true });

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? process.env.APP_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "api", testMatch: /api\.spec\.ts/ },
    {
      name: "chromium",
      testMatch: /ui\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], locale: "fr-FR" },
    },
    {
      name: "firefox",
      testMatch: /ui\.spec\.ts/,
      use: { ...devices["Desktop Firefox"], locale: "fr-FR" },
    },
  ],
});
