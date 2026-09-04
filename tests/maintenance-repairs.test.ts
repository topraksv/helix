/**
 * The repairs the maintenance pass performs on every app open.
 *
 * Measured before this file existed: `src/data/repo/maintenance.ts` ran at
 * 62.7% of statements and 47.8% of branches, and the uncovered half was the
 * half that WRITES — the orphan-budget cascade, the one-time computed-column
 * removal, and the cleanup of obligations belonging to a watch-only person.
 * Code that tombstones rows without a test is the worst kind to leave
 * unexercised: its mistakes are silent and there is no undo.
 *
 * Each case below pairs the removal with the thing that must SURVIVE it. That
 * pairing is the point — a sweep that deletes too much passes any test which
 * only checks that it deleted something.
 */
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrationStatements } from "./helpers";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null }));

vi.mock("../src/db/client", async () => {
  const { sqliteClientMock: make } = await import("./helpers");
  return make(() => harness.db!);
});
vi.mock("../src/db/ids", () => ({
  deterministicId: async (key: string) => `det:${key}`,
  naturalKeys: new Proxy({}, {
    get: (_t, property) => (...parts: unknown[]) => `${String(property)}|${parts.join("|")}`,
  }),
}));
vi.mock("../src/sync/engine", () => ({ scheduleSync: vi.fn() }));
// The only leaf that reaches react-native. Everything above it — the repo
// layer, `db/mutations`, the real migrations — runs for real, which is the
// whole point: the writes under test are the writes that ship.
vi.mock("../src/services/fx-fetch", () => ({ lookupRate: vi.fn() }));
vi.mock("../src/services/markets", () => ({ marketSellRateTry: vi.fn() }));

import { runMaintenance } from "../src/data/repo/maintenance";

const USER = "user-1";
const NOW = "2026-09-04T09:00:00.000Z";

function insert(table: string, row: Record<string, unknown>): void {
  const columns = Object.keys(row);
  harness.db!
    .prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .run(...(columns.map((c) => row[c]) as never[]));
}

const stamps = { user_id: USER, created_at: NOW, updated_at: NOW, deleted_at: null, tombstone_version: 0 };

function live(table: string, id: string): boolean {
  const row = harness.db!
    .prepare(`SELECT deleted_at FROM ${table} WHERE id = ?`)
    .get(id) as { deleted_at: string | null } | undefined;
  if (!row) throw new Error(`${table}/${id} is not in the database at all`);
  return row.deleted_at == null;
}

beforeEach(() => {
  harness.db = new DatabaseSync(":memory:");
  for (const statement of migrationStatements) harness.db.exec(statement);
  insert("persons", { ...stamps, id: "self", name: "Ben", is_self: 1 });
});

describe("the orphan-budget cascade", () => {
  /**
   * A budget whose category is gone must go too — but ONLY when the category
   * is provably deleted. A category that is merely ABSENT has not necessarily
   * been deleted; on a fresh device mid-first-pull it simply has not arrived,
   * and tombstoning its budgets there destroys data the pull was about to
   * explain.
   */
  it("tombstones a budget whose category is deleted", async () => {
    insert("categories", { ...stamps, id: "cat-gone", deleted_at: NOW, name: "Silinen", kind: "expense", sort_order: 0, is_column: 0, is_transfer: 0 });
    insert("category_budgets", { ...stamps, id: "budget-orphan", category_id: "cat-gone", month: "2026-09", amount_minor: 50_000 });

    await runMaintenance(USER);

    expect(live("category_budgets", "budget-orphan")).toBe(false);
  });

  it("leaves a budget alone when its category has simply not arrived yet", async () => {
    insert("category_budgets", { ...stamps, id: "budget-unsynced", category_id: "cat-not-here", month: "2026-09", amount_minor: 50_000 });

    await runMaintenance(USER);

    expect(live("category_budgets", "budget-unsynced")).toBe(true);
  });

  it("leaves a budget whose category is alive alone", async () => {
    insert("categories", { ...stamps, id: "cat-live", name: "Market", kind: "expense", sort_order: 0, is_column: 0, is_transfer: 0 });
    insert("category_budgets", { ...stamps, id: "budget-live", category_id: "cat-live", month: "2026-09", amount_minor: 50_000 });

    await runMaintenance(USER);

    expect(live("category_budgets", "budget-live")).toBe(true);
  });
});

describe("the one-time removal of the derived installment column", () => {
  const CC_ID = `det:ccColumn|${USER}`;

  it("tombstones the auto-created column once and records that it did", async () => {
    insert("computed_columns", { ...stamps, id: CC_ID, name: "KK Taksit", definition: "{}", sort_order: 0 });

    await runMaintenance(USER);

    expect(live("computed_columns", CC_ID)).toBe(false);
    const flag = harness.db!
      .prepare(`SELECT value FROM settings WHERE user_id = ? AND key = 'cc_column_removed'`)
      .get(USER) as { value: string } | undefined;
    expect(flag, "the removal must be recorded, or it repeats on every pass").toBeDefined();
  });

  /**
   * The flag is what stops the removal happening twice. Without it a column the
   * owner deliberately recreated under the same deterministic id would be
   * deleted again on the next app open, for ever.
   */
  it("does not delete a column the owner brought back after the one-time pass", async () => {
    insert("computed_columns", { ...stamps, id: CC_ID, name: "KK Taksit", definition: "{}", sort_order: 0 });
    await runMaintenance(USER);
    expect(live("computed_columns", CC_ID)).toBe(false);

    harness.db!.prepare(`UPDATE computed_columns SET deleted_at = NULL WHERE id = ?`).run(CC_ID);
    await runMaintenance(USER);

    expect(live("computed_columns", CC_ID)).toBe(true);
  });

  it("records the flag even when there is no such column to remove", async () => {
    await runMaintenance(USER);
    const flag = harness.db!
      .prepare(`SELECT value FROM settings WHERE user_id = ? AND key = 'cc_column_removed'`)
      .get(USER);
    expect(flag).toBeDefined();
  });
});

describe("obligations belonging to a person who is only watched", () => {
  function seedWatchedSubscription(): void {
    insert("persons", { ...stamps, id: "watched", name: "Kardeşim", is_self: 0 });
    insert("subscriptions", {
      ...stamps, id: "sub-watched", name: "Spotify", amount_minor: 10_000, currency: "TRY",
      cycle: "monthly", interval_months: 1, billing_day: 15, next_due_date: "2026-09-15",
      person_id: "watched", is_active: 1, auto_pay: 0, logo_source: "none", amount_mode: "fixed",
    });
  }

  /**
   * A watch-only person's subscription never belonged in the owner's balance or
   * forecast, so its still-mutable obligations are cleaned up.
   */
  it("removes a pending obligation derived from a watched person's subscription", async () => {
    seedWatchedSubscription();
    insert("expected_payments", {
      ...stamps, id: "exp-pending", direction: "outflow", kind: "subscription", ref_id: "sub-watched",
      due_date: "2026-09-15", amount_minor: 10_000, currency: "TRY", status: "pending",
      auto_confirmed: 0, amount_is_estimated: 0,
    });

    await runMaintenance(USER);

    expect(live("expected_payments", "exp-pending")).toBe(false);
  });

  /**
   * History is not a forecast. A payment already recorded as made is a fact
   * about the past, and the cleanup is scoped to `pending`/`late` precisely so
   * it cannot rewrite one.
   */
  it("keeps what that person's obligations already recorded as settled", async () => {
    seedWatchedSubscription();
    for (const [id, status] of [["exp-paid", "paid"], ["exp-skipped", "skipped"]] as const) {
      insert("expected_payments", {
        ...stamps, id, direction: "outflow", kind: "subscription", ref_id: "sub-watched",
        due_date: "2026-08-15", amount_minor: 10_000, currency: "TRY", status,
        auto_confirmed: 0, amount_is_estimated: 0,
      });
    }

    await runMaintenance(USER);

    expect(live("expected_payments", "exp-paid")).toBe(true);
    expect(live("expected_payments", "exp-skipped")).toBe(true);
  });

  /** The owner's own pending obligations are the whole point of the forecast. */
  it("keeps a pending obligation that belongs to the account holder", async () => {
    insert("subscriptions", {
      ...stamps, id: "sub-self", name: "Netflix", amount_minor: 20_000, currency: "TRY",
      cycle: "monthly", interval_months: 1, billing_day: 20, next_due_date: "2026-09-20",
      person_id: "self", is_active: 1, auto_pay: 0, logo_source: "none", amount_mode: "fixed",
    });
    insert("expected_payments", {
      ...stamps, id: "exp-self", direction: "outflow", kind: "subscription", ref_id: "sub-self",
      due_date: "2026-09-20", amount_minor: 20_000, currency: "TRY", status: "pending",
      auto_confirmed: 0, amount_is_estimated: 0,
    });

    await runMaintenance(USER);

    expect(live("expected_payments", "exp-self")).toBe(true);
  });
});
