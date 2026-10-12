// INP and CLS after the app has opened; startup.spec.ts and check-web-budget.mjs cover paint and bytes.
// Ceilings are the published "good" thresholds with CI headroom, to catch a synchronous
// derivation on the tap path or an unreserved box, not to police 20ms.
//
// BLIND SPOT: the workspace is onboard plus one expense, far under the shape
// docs/ARCHITECTURE.md "How a performance claim is produced" requires, so an O(ledger)
// derivation would not show. Layout shift is proven (Amount's font ladder walks on any
// row); read green INP as "nothing unconditional landed on the tap path".

import { expect, test, type Page } from "@playwright/test";
import { addMarketExpense, isolateExternalData, onboard, openCashFlow } from "./helpers";

// "Good" INP is 200ms at p75 of real users; doubled for a single cold CI run.
const INP_BUDGET_MS = 400;
// "Good" CLS is 0.1; nothing here may move after it settles.
const CLS_BUDGET = 0.05;

/** Arm both observers before the interactions that have to be measured. */
async function observeVitals(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as { __vitals: { events: number[]; shifts: number[] } };
    store.__vitals = { events: [], shifts: [] };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const event = entry as PerformanceEntry & { interactionId?: number };
        if (event.interactionId) store.__vitals.events.push(entry.duration);
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        // CLS excludes shifts within 500ms of an input.
        if (!shift.hadRecentInput) store.__vitals.shifts.push(shift.value);
      }
    }).observe({ type: "layout-shift", buffered: true } as PerformanceObserverInit);
  });
}

async function readVitals(page: Page) {
  const { events, shifts } = await page.evaluate(
    () => (window as unknown as { __vitals: { events: number[]; shifts: number[] } }).__vitals,
  );
  return {
    interactions: events.length,
    worstInteractionMs: Math.round(Math.max(0, ...events)),
    cumulativeLayoutShift: Number(shifts.reduce((total, value) => total + value, 0).toFixed(4)),
  };
}

test("answers a pointer inside the interaction budget, and does not move under it", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await isolateExternalData(page.context());
  await onboard(page);
  await addMarketExpense(page, "vitals");

  await observeVitals(page);

  // A real interaction mix, not a synthetic click loop.
  await openCashFlow(page);
  await page.getByRole("tab", { name: "Durum" }).click();
  await openCashFlow(page);
  await page.getByRole("tab", { name: "Ayarlar" }).click();
  await page.getByRole("tab", { name: "Durum" }).click();
  await page.waitForTimeout(1_500);

  const vitals = await readVitals(page);
  await testInfo.attach("web-vitals", { body: JSON.stringify(vitals, null, 2), contentType: "application/json" });

  // A run that measured nothing would pass every ceiling below.
  expect(vitals.interactions, "interactions observed").toBeGreaterThan(0);
  expect(vitals.worstInteractionMs, "slowest interaction").toBeLessThan(INP_BUDGET_MS);
  expect(vitals.cumulativeLayoutShift, "cumulative layout shift").toBeLessThan(CLS_BUDGET);
});
