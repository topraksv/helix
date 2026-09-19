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
  "src/data/repo/imports.ts",
  "src/data/repo/maintenance.ts",
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
  "src/services/spreadsheet-import.ts",
];

/**
 * `src/domain/brand-mark-audit.ts` is the one file left out, and not as a
 * shortfall: it is 180 rows of measured pixel widths and image hashes generated
 * by `scripts/audit-brand-marks.mjs`, with no function in it. It is excluded
 * from the mutation gate for the same reason, and covering a data file measures
 * the test that reads it rather than the file.
 *
 * The workbook importer and the maintenance pass were the last write paths out
 * (2026-09-17). What brought them in was tests for behaviour nothing exercised —
 * a batch recorded before plans were listed, the ZIP and grid limits a hostile
 * file meets, a card with no cycle — and the removal of defences the code
 * before them already made impossible. Never a change made to raise a
 * percentage: that is what `AGENTS.md` means by not optimising for coverage.
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
