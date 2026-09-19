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

  /**
   * The same rule, for the other kind of rule. Incomes were the untested half:
   * a watch-only person's SALARY raised a pending inflow that entered the
   * owner's forecast, and every assertion above was about subscriptions.
   */
  it("removes a pending inflow derived from a watched person's income", async () => {
    insert("persons", { ...stamps, id: "watched", name: "Kardeşim", is_self: 0 });
    insert("recurring_incomes", {
      ...stamps, id: "inc-watched", name: "Maaş", kind: "salary", default_amount_minor: 50_000,
      currency: "TRY", pay_day: 1, recurrence: "monthly", person_id: "watched", is_active: 1,
    });
    insert("recurring_incomes", {
      ...stamps, id: "inc-self", name: "Maaşım", kind: "salary", default_amount_minor: 60_000,
      currency: "TRY", pay_day: 1, recurrence: "monthly", person_id: "self", is_active: 1,
    });
    for (const [id, ref] of [["exp-watched-income", "inc-watched"], ["exp-self-income", "inc-self"]] as const) {
      insert("expected_payments", {
        ...stamps, id, direction: "inflow", kind: "recurring_income", ref_id: ref,
        due_date: "2026-09-01", amount_minor: 50_000, currency: "TRY", status: "pending",
        auto_confirmed: 0, amount_is_estimated: 0,
      });
    }

    await runMaintenance(USER);

    expect(live("expected_payments", "exp-watched-income")).toBe(false);
    expect(live("expected_payments", "exp-self-income")).toBe(true);
  });

  /**
   * `late` is as mutable as `pending` and is swept with it. An obligation that
   * has merely gone past its date is still a forecast about money that was
   * never the owner's, so leaving it would keep the row the sweep exists for.
   */
  it("removes a watched obligation that has already gone late", async () => {
    seedWatchedSubscription();
    insert("expected_payments", {
      ...stamps, id: "exp-late", direction: "outflow", kind: "subscription", ref_id: "sub-watched",
      due_date: "2026-07-15", amount_minor: 10_000, currency: "TRY", status: "late",
      auto_confirmed: 0, amount_is_estimated: 0,
    });

    await runMaintenance(USER);

    expect(live("expected_payments", "exp-late")).toBe(false);
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

/**
 * A foreign-currency plan's instalments follow the currency (owner decision,
 * 2026-09-13): a coming one is restated at the last known rate on every pass,
 * and one whose day arrives is fixed at the rate stored for that day.
 */
describe("foreign-currency instalments", () => {
  function instalmentRow(id: string, currency: string, effectiveDate: string, amountTryMinor: number, status = "pending"): Record<string, unknown> {
    return {
      ...stamps, id, type: "expense", amount_minor: 10_00, currency, fx_rate: currency === "TRY" ? null : "20",
      amount_try_minor: amountTryMinor, entry_date: "2019-12-01", effective_date: effectiveDate, status,
      person_id: "self", installment_plan_id: "plan-usd", installment_no: 1, is_aggregate: 0,
    };
  }
  function transaction(id: string): Record<string, unknown> {
    return harness.db!.prepare(`SELECT status, amount_try_minor, fx_rate FROM transactions WHERE id = ?`).get(id) as Record<string, unknown>;
  }

  beforeEach(() => {
    insert("installment_plans", {
      ...stamps, id: "plan-usd", title: "Kamera", kind: "loan", total_amount_minor: 30_00, installment_count: 3,
      currency: "USD", start_month: "2020-01", person_id: "self",
    });
    for (const [date, rate] of [["2019-12-31", "30"], ["2020-01-05", "31"], ["2020-02-01", "35"]] as const) {
      insert("fx_rates", { ...stamps, id: `usd-${date}`, currency: "USD", rate_date: date, rate_try: rate });
    }
  });

  it("fixes an instalment whose day has come at the rate stored for that day", async () => {
    insert("transactions", instalmentRow("due", "USD", "2020-01-05", 200_00));
    insert("transactions", instalmentRow("due-lira", "TRY", "2020-01-05", 10_00));

    await runMaintenance(USER);

    expect(transaction("due")).toEqual({ status: "realized", amount_try_minor: 310_00, fx_rate: "31" });
    expect(transaction("due-lira")).toEqual({ status: "realized", amount_try_minor: 10_00, fx_rate: null });
  });

  it("leaves a coming instalment already at the last rate, and one too small to survive conversion", async () => {
    insert("fx_rates", { ...stamps, id: "jpy", currency: "JPY", rate_date: "2019-12-31", rate_try: "0.2" });
    insert("transactions", { ...instalmentRow("current", "USD", "2099-01-05", 350_00), fx_rate: "35" });
    insert("transactions", { ...instalmentRow("tiny", "JPY", "2099-01-05", 1), amount_minor: 1 });

    await runMaintenance(USER);

    expect(transaction("current")).toEqual({ status: "pending", amount_try_minor: 350_00, fx_rate: "35" });
    expect(transaction("tiny")).toEqual({ status: "pending", amount_try_minor: 1, fx_rate: "20" });
  });

  it("restates a coming instalment at the last known rate, and leaves lira and rateless ones alone", async () => {
    insert("transactions", instalmentRow("coming", "USD", "2099-01-05", 200_00));
    insert("transactions", instalmentRow("lira", "TRY", "2099-01-05", 10_00));
    insert("transactions", instalmentRow("no-rate", "GBP", "2099-01-05", 200_00));

    await runMaintenance(USER);

    expect(transaction("coming")).toEqual({ status: "pending", amount_try_minor: 350_00, fx_rate: "35" });
    expect(transaction("lira")).toEqual({ status: "pending", amount_try_minor: 10_00, fx_rate: null });
    expect(transaction("no-rate")).toEqual({ status: "pending", amount_try_minor: 200_00, fx_rate: "20" });
  });
});

describe("card charges without a statement", () => {
  /**
   * A card's charge is placed on the statement its day joins. One with only a
   * due date keeps it when it is already paid there, and a card with no cycle
   * has no statement to place anything on.
   */
  it("places each charge on its statement, and leaves a card with no cycle alone", async () => {
    insert("payment_sources", { ...stamps, id: "card", name: "Kart", type: "credit_card", person_id: "self", statement_day: 25, due_day: 5, logo_source: "initials", is_active: 1 });
    insert("payment_sources", { ...stamps, id: "bare", name: "Eski", type: "credit_card", person_id: "self", logo_source: "initials", is_active: 1 });
    insert("installment_plans", { ...stamps, id: "plan", title: "Telefon", kind: "card_installment", monthly_amount_minor: 100_00, installment_count: 2, currency: "TRY", start_month: "2026-08", person_id: "self", payment_source_id: "card" });
    const charge = (id: string, source: string, row: Record<string, unknown>) => insert("transactions", {
      ...stamps, id, type: "expense", amount_minor: 100_00, currency: "TRY", amount_try_minor: 100_00, entry_date: "2026-07-01",
      person_id: "self", is_aggregate: 0, payment_source_id: source, ...row,
    });
    charge("paid", "card", { installment_plan_id: "plan", installment_no: 1, effective_date: "2026-08-05", status: "realized" });
    charge("coming", "card", { purchase_date: "2099-01-10", effective_date: "2099-01-10", status: "pending" });
    charge("uncycled", "bare", { purchase_date: "2026-07-10", effective_date: "2026-07-10", status: "realized" });

    await runMaintenance(USER);

    const rows = harness.db!.prepare(`SELECT id, effective_date, status, card_statement_id IS NOT NULL AS linked FROM transactions ORDER BY id`).all();
    expect(rows).toEqual([
      { id: "coming", effective_date: "2099-02-05", status: "pending", linked: 1 },
      { id: "paid", effective_date: "2026-08-05", status: "realized", linked: 1 },
      { id: "uncycled", effective_date: "2026-07-10", status: "realized", linked: 0 },
    ]);
  });
});

describe("an automatic payment the pass cannot make", () => {
  /** Only a missing rate is waited out; anything else stops the pass where it can be seen (see the note in maintenance.ts). */
  it("stops on a rule that no longer fits its payment", async () => {
    insert("categories", { ...stamps, id: "salary", name: "Maaş", kind: "income", sort_order: 0, is_column: 1, is_transfer: 0 });
    insert("subscriptions", {
      ...stamps, id: "sub", name: "Netflix", amount_minor: 20_000, currency: "TRY", cycle: "monthly", interval_months: 1, billing_day: 1,
      next_due_date: "2026-09-01", person_id: "self", category_id: "salary", is_active: 1, auto_pay: 1, logo_source: "none", amount_mode: "fixed",
    });
    insert("expected_payments", {
      ...stamps, id: "due", direction: "outflow", kind: "subscription", ref_id: "sub", due_date: "2026-09-10",
      amount_minor: 20_000, currency: "TRY", status: "pending", auto_confirmed: 0, amount_is_estimated: 0,
    });

    await expect(runMaintenance(USER)).rejects.toThrow("Transaction type and category do not match");
  });
});

describe("statements the owner paid against", () => {
  /**
   * A statement with no live charge is an orphan and is swept. One the owner
   * recorded a payment against is not: the money left the account whatever
   * became of its charges, and sweeping it would take the payment with it.
   */
  it("keeps a chargeless statement that carries a payment, and sweeps one that does not", async () => {
    insert("payment_sources", { ...stamps, id: "card", name: "Kart", type: "credit_card", person_id: "self", statement_day: 25, due_day: 5, logo_source: "initials", is_active: 1 });
    for (const id of ["paid", "empty"]) {
      insert("credit_card_statements", { ...stamps, id, payment_source_id: "card", period_month: id === "paid" ? "2026-07" : "2026-06", statement_date: "2026-07-25", due_date: "2026-08-05" });
    }
    insert("card_statement_payments", { ...stamps, id: "payment", statement_id: "paid", paid_on: "2026-08-01", amount_minor: 100_00, kind: "partial" });

    await runMaintenance(USER);

    expect(live("credit_card_statements", "paid")).toBe(true);
    expect(live("credit_card_statements", "empty")).toBe(false);
  });
});
