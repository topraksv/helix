import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  // Shards split by test rather than file, so unevenly sized specs balance.
  // `workers: 1` keeps the one static server from being shared.
  fullyParallel: true,
  timeout: 90_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // `github` annotates failures and flaky passes on the run; `line` shows a hung shard's progress.
  reporter: process.env.CI ? [["github"], ["line"], ["html", { open: "never" }]] : "list",
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:4173/helix",
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    colorScheme: "light",
    contextOptions: { reducedMotion: "reduce" },
    // Evidence on failure only: there are no committed baselines to compare.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "firefox-critical",
      grep: /@cross-browser/,
      use: { ...devices["Desktop Firefox"] },
    },
  ],
  webServer: {
    command: "node scripts/serve-web-export.mjs dist-e2e 4173",
    url: "http://127.0.0.1:4173/helix/",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
