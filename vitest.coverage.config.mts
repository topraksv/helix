import { defineConfig } from "vitest/config";

// The modules that decide what a number means or what gets written.
//
// What is absent from this list is absent on purpose and named below with the
// figure it misses by. It used to say only that absentees "are not gated yet",
// which named nothing and so could never become false: measured on 2026-09-09,
// six of the eleven already cleared every threshold and were being left out by
// the list alone.
const criticalDomainFiles = [
  "src/data/repo/accounts.ts",
  "src/data/repo/categories.ts",
  "src/data/repo/cell-notes.ts",
  "src/data/repo/attachments.ts",
  "src/data/repo/budgets.ts",
  "src/data/repo/expected.ts",
  "src/data/repo/computed.ts",
  "src/data/repo/errors.ts",
  "src/data/repo/import-plan.ts",
  "src/data/repo/matrix-colors.ts",
  "src/data/repo/installments.ts",
  "src/data/repo/investment-validation.ts",
  "src/data/repo/investments.ts",
  "src/data/repo/onboarding.ts",
  "src/data/repo/rule-validation.ts",
  "src/data/repo/reset.ts",
  "src/data/repo/rules.ts",
  "src/data/repo/settings.ts",
  "src/data/repo/statement-import.ts",
  "src/data/repo/transactions.ts",
  "src/domain/analytics.ts",
  "src/domain/app-guard.ts",
  "src/domain/attachments.ts",
  "src/domain/attention.ts",
  "src/domain/balance-declaration.ts",
  "src/domain/money.ts",
  "src/domain/balance.ts",
  "src/domain/budgets.ts",
  "src/domain/brand-marks.ts",
  "src/domain/cash-flow-matrix.ts",
  "src/domain/card-statements.ts",
  "src/domain/category-icons.ts",
  "src/domain/computed-columns.ts",
  "src/domain/dashboard.ts",
  "src/domain/dates.ts",
  "src/domain/diagnostics.ts",
  "src/domain/expected.ts",
  "src/domain/feedback.ts",
  "src/domain/fx-provider.ts",
  "src/domain/fx.ts",
  "src/domain/form-state.ts",
  "src/domain/input.ts",
  "src/domain/investment-projection.ts",
  "src/domain/investment-catalog.ts",
  "src/domain/installments.ts",
  "src/domain/matrix-colors.ts",
  "src/domain/matrix-preferences.ts",
  "src/domain/provenance.ts",
  "src/domain/recurrence.ts",
  "src/domain/save-summary.ts",
  "src/domain/statement-import.ts",
  "src/domain/transaction-draft.ts",
  "src/domain/investments.ts",
  "src/domain/market.ts",
  "src/domain/logo-domain.ts",
  "src/domain/notifications.ts",
  "src/domain/onboarding.ts",
  "src/domain/privacy.ts",
  "src/domain/route-params.ts",
  "src/domain/serial-queue.ts",
  "src/domain/settings.ts",
  "src/domain/subscriptions.ts",
  "src/domain/transaction-search.ts",
  "src/domain/transactions.ts",
  "src/domain/types.ts",
  "src/domain/undo-outcome.ts",
  "src/domain/upcoming.ts",
  "src/domain/user-id.ts",
  "src/domain/user-error.ts",
  "src/domain/web-security.ts",
  "src/domain/workbook-format.ts",
  "src/domain/workbook-format-guard.ts",
  "src/domain/year-columns.ts",
];

/**
 * The five that are measured and still short, with what they miss by.
 *
 * Kept as a list here rather than as an intention somewhere else, because the
 * previous wording — "are not gated yet" — named nothing and so could not
 * become false. Measured 2026-09-09 against the thresholds below:
 *
 *   src/data/repo/imports.ts       stmts 84.92  branch 73.94  funcs 84.61
 *   src/data/repo/maintenance.ts                branch 79.34  funcs 96.87
 *
 * All four absentees moved on 2026-09-09 and two of them cleared the bar and
 * are in the list above. What moved them was tests for behaviour nothing
 * exercised, never a change made to raise a percentage:
 *
 *   budgets.ts    88.31 -> 96.82 branches, by deleting two dead defences —
 *                 a `?? []` after a `.map()` and a row of `?? 0` reads on a
 *                 Map built from the very list being read.
 *   expected.ts   82.43 -> 91.21 branches, by covering what a confirmation
 *                 turns an expectation into (a card statement, a foreign
 *                 currency, a wrong person, a variable invoice) and what
 *                 undoing one may and may not delete.
 *   imports.ts    67.46 -> 84.92 statements, by covering the fail-closed guard
 *                 on an unreadable batch record, the protection that stops a
 *                 2026 import removing 2025's rows, and the instalment plan a
 *                 workbook comment reconstructs.
 *   maintenance.ts 73.13 -> 96.26 statements, because `performDataReset` now
 *                 ends with the pass, the reset's permutation suite drives it
 *                 over a realistic workspace, and one auto-payment that cannot
 *                 be priced is now proven not to stop the others.
 *
 * What is left in the two that are still out: `maintenance.ts` has two
 * error-recovery branches — an unaffordable scheduled refund, a missing FX
 * rate — that belong in `maintenance-repairs.test.ts`, and `imports.ts` still
 * needs the card-cycle repair and the aggregate-vs-itemised cell paths.
 *
 * `src/domain/brand-mark-audit.ts` is the fifth and is not a shortfall: it is
 * 180 rows of measured pixel widths and image hashes generated by
 * `scripts/audit-brand-marks.mjs`, with no function in it. It is excluded from
 * the mutation gate for the same reason, and covering a data file measures the
 * test that reads it rather than the file.
 *
 * The first two are the real gap — a third of their functions never run. The
 * last two are single branches. None of them is closed by contorting the code
 * to raise a percentage, which is what `AGENTS.md` means by not optimising for
 * coverage: they are closed by tests for behaviour nothing exercises today.
 */

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      enabled: true,
      provider: "v8",
      include: criticalDomainFiles,
      reportsDirectory: "coverage/critical-domain",
      reporter: ["text", "json-summary"],
      reportOnFailure: true,
      skipFull: false,
      thresholds: {
        perFile: true,
        branches: 90,
        functions: 100,
        lines: 95,
        statements: 90,
      },
    },
  },
});
