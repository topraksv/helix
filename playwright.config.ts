import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  // Sharding granularity, not concurrency. Playwright splits by FILE unless
  // this is set and by TEST when it is
  // (https://playwright.dev/docs/test-sharding), and this suite's specs are
  // very unevenly sized: measured, two shards received 65 and 10 tests, so CI
  // waited 6m05 on one runner while the other finished in 3m16. With it, 38 and
  // 37. `workers: 1` still means one browser at a time on each runner, which is
  // what keeps a single static server from being shared by two of them.
  fullyParallel: true,
  timeout: 90_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4173/helix",
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    colorScheme: "light",
    contextOptions: { reducedMotion: "reduce" },
    // Evidence on failure only. There are no committed baselines to compare
    // against any more, so a passing run produces nothing to store; a failing
    // one still yields the screenshot and trace needed to read it.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: "node scripts/serve-static.mjs dist-e2e 4173 helix",
    url: "http://127.0.0.1:4173/helix/",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
