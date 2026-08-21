import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: async (_algorithm: string, value: string) => createHash("sha256").update(value).digest("hex"),
}));

import { deterministicId, naturalKeys } from "../src/db/ids";
import {
  buildIdRemap,
  isDeterministicId,
} from "../src/services/backup-remap";
import type { ExportBundle } from "../src/services/backup-validation";

const SOURCE_USER = "11111111-1111-4111-8111-111111111111";
const TARGET_USER = "22222222-2222-4222-8222-222222222222";
const SUBSCRIPTION_ID = "00000000-0000-7000-8000-000000000001";
const STATEMENT_KEY = "stmt:visa:2026-08:0007";

async function coverageBundle(): Promise<ExportBundle> {
  const categoryId = await deterministicId(naturalKeys.seedCategory(SOURCE_USER, "Market"));
  const importedSourceId = await deterministicId(naturalKeys.importSource(SOURCE_USER, "Visa"));
  const onboardingSourceId = await deterministicId(naturalKeys.onboardingSource(SOURCE_USER, 0));
  const planId = await deterministicId(naturalKeys.importInstallmentPlan(SOURCE_USER, "Laptop", 1000, 3, "2026-08"));
  const expectedId = await deterministicId(naturalKeys.expected(SOURCE_USER, "subscription", SUBSCRIPTION_ID, "2026-08-15"));

  return {
    version: 1,
    exportedAt: "2026-08-10T12:00:00.000Z",
    tables: {
      persons: [
        { id: await deterministicId(naturalKeys.selfPerson(SOURCE_USER)) },
        { id: await deterministicId(naturalKeys.onboardingPerson(SOURCE_USER, 1)) },
      ],
      categories: [{ id: categoryId, name: "Market" }],
      payment_sources: [
        { id: importedSourceId, name: "Visa" },
        { id: onboardingSourceId, name: "Cash" },
      ],
      fx_rates: [{ id: await deterministicId(naturalKeys.fxRate(SOURCE_USER, "USD", "2026-08-10")), currency: "USD", rate_date: "2026-08-10" }],
      settings: [{ id: await deterministicId(naturalKeys.setting(SOURCE_USER, "last_entry_at")), key: "last_entry_at" }],
      investment_profiles: [{ id: await deterministicId(naturalKeys.investmentProfile(SOURCE_USER)) }],
      installment_plans: [{
        id: planId,
        title: "Laptop",
        monthly_amount_minor: 1000,
        installment_count: 3,
        start_month: "2026-08",
      }],
      computed_columns: [{ id: await deterministicId(naturalKeys.ccColumn(SOURCE_USER)) }],
      balance_adjustments: [{ id: await deterministicId(naturalKeys.balanceAdjustment(SOURCE_USER, "2026-08-10")), date: "2026-08-10" }],
      category_budgets: [{
        id: await deterministicId(naturalKeys.categoryBudget(SOURCE_USER, "2026-08", categoryId)),
        month: "2026-08",
        category_id: categoryId,
      }],
      cell_notes: [{
        id: await deterministicId(naturalKeys.cellNote(SOURCE_USER, "2026-08", categoryId)),
        month: "2026-08",
        category_id: categoryId,
      }],
      credit_card_statements: [{
        id: await deterministicId(naturalKeys.cardStatement(SOURCE_USER, importedSourceId, "2026-08")),
        payment_source_id: importedSourceId,
        period_month: "2026-08",
      }],
      subscriptions: [{ id: SUBSCRIPTION_ID }],
      expected_payments: [{
        id: expectedId,
        kind: "subscription",
        ref_id: SUBSCRIPTION_ID,
        due_date: "2026-08-15",
        transaction_id: await deterministicId(naturalKeys.confirmTx(expectedId)),
      }],
      transactions: [
        {
          id: await deterministicId(naturalKeys.installmentTx(planId, 1)),
          installment_plan_id: planId,
          installment_no: 1,
        },
        { id: await deterministicId(naturalKeys.confirmTx(expectedId)) },
        {
          id: await deterministicId(naturalKeys.statementTx(SOURCE_USER, STATEMENT_KEY)),
          import_key: STATEMENT_KEY,
          origin: "statement",
        },
      ],
      matrix_colors: [{
        id: await deterministicId(naturalKeys.matrixColor(SOURCE_USER, "cell", categoryId, "2026-08")),
        scope: "cell",
        item_key: categoryId,
        month: "2026-08",
        token: "warning",
      }],
    },
  };
}

describe("cross-account backup remap coverage", () => {
  it("remaps every deterministic row exactly once", async () => {
    const bundle = await coverageBundle();
    const idMap = await buildIdRemap(bundle, SOURCE_USER, TARGET_USER);
    const deterministicRows = Object.entries(bundle.tables).flatMap(([table, rows]) =>
      rows.filter((row) => isDeterministicId(row.id)).map((row) => ({ table, id: String(row.id) })),
    );
    const unresolved = deterministicRows.filter(({ id }) => !idMap.has(id));

    expect(unresolved, "every deterministic fixture row must be proven by a resolver").toEqual([]);
    expect(new Set(idMap.values()).size).toBe(deterministicRows.length);
    expect([...idMap.values()].every((id) => isDeterministicId(id))).toBe(true);
  });
});
