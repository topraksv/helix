// Ceilings are loose on purpose: they catch an order-of-magnitude change (a synchronous
// migration on the boot path, a blocking font), not 40 ms of variance on a noisy runner.
// `scripts/check-web-budget.mjs` bounds the bytes; this bounds what the browser does with them.

import { expect, test } from "@playwright/test";
import { isolateExternalData, onboard } from "./helpers";

const FIRST_CONTENTFUL_PAINT_BUDGET_MS = 6_000;
const FIRST_SCREEN_BUDGET_MS = 15_000;
const INITIAL_SCRIPT_BUDGET_BYTES = 4_500_000;

test.beforeEach(async ({ context }) => isolateExternalData(context));

test("opens within its measured startup budget @cross-browser", async ({ page }, testInfo) => {
  const startedAt = Date.now();
  await page.goto("/helix/");
  await expect(page.getByRole("heading", { name: "Hoş geldin", exact: true })).toBeVisible();
  const firstScreenMs = Date.now() - startedAt;

  // Chromium fills the paint-timing buffer asynchronously; reading it at once returns null about one run in eight.
  await page.waitForFunction(
    () => performance.getEntriesByType("paint").some((entry) => entry.name === "first-contentful-paint"),
    null,
    { timeout: 10_000 },
  );
  const paint = await page.evaluate(() =>
    performance.getEntriesByType("paint").find((entry) => entry.name === "first-contentful-paint")?.startTime ?? null,
  );

  // Route code is in the initial load on purpose (asyncRoutes), so this is the honest figure.
  const initialScriptBytes = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry): entry is PerformanceResourceTiming => entry.entryType === "resource")
      .filter((entry) => entry.initiatorType === "script")
      .reduce((total, entry) => total + (entry.decodedBodySize || entry.transferSize || 0), 0),
  );

  await testInfo.attach("startup", {
    body: JSON.stringify({ firstScreenMs, firstContentfulPaintMs: paint, initialScriptBytes }, null, 2),
    contentType: "application/json",
  });

  expect(firstScreenMs, "first usable screen").toBeLessThan(FIRST_SCREEN_BUDGET_MS);
  expect(paint ?? Infinity, "first contentful paint").toBeLessThan(FIRST_CONTENTFUL_PAINT_BUDGET_MS);
  expect(initialScriptBytes, "scripts fetched before the first screen").toBeLessThan(INITIAL_SCRIPT_BUDGET_BYTES);
  // A zero would pass every ceiling above while proving nothing.
  expect(initialScriptBytes, "resource timing available").toBeGreaterThan(500_000);
});

// Asserts the STATE, not timing (a long-task threshold on CI is a coin toss): `useWarmRoute`
// preloads the table so its mount does not land on the navigator's fade.
test("has the ledger mounted before its tab is opened", async ({ page }) => {
  await onboard(page);

  // Durum is still selected, yet the ledger's column headers are in the tree: only preloading explains it.
  await expect(page.getByTestId("table-column-label").first()).toBeAttached({ timeout: 15_000 });
  await expect(page.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();
});
