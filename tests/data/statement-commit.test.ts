/**
 * Committing accepted statement rows.
 *
 * Runs against a real SQLite database with the real migrations, because the
 * two properties that matter — deterministic identity and all-or-nothing —
 * are properties of the write, not of a mock.
 */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null, failWrites: false }));

vi.mock("../../src/db/client", () => ({
  getSqliteAsync: async () => ({
    getFirstAsync: async (sql: string, args: unknown[] = []) =>
      harness.db!.prepare(sql).get(...(args as never[])) ?? null,
    getAllAsync: async (sql: string, args: unknown[] = []) => harness.db!.prepare(sql).all(...(args as never[])),
    runAsync: async (sql: string, args: unknown[] = []) => {
      // Injected failure: the statement must roll back as one unit.
      if (harness.failWrites && sql.trim().toUpperCase().startsWith("INSERT INTO TRANSACTIONS")) {
        throw new Error("injected write failure");
      }
      return { changes: Number(harness.db!.prepare(sql).run(...(args as never[])).changes) };
    },
  }),
  withTransaction: async (task: () => Promise<void>) => {
    harness.db!.exec("BEGIN");
    try {
      await task();
      harness.db!.exec("COMMIT");
    } catch (error) {
      harness.db!.exec("ROLLBACK");
      throw error;
    }
  },
}));

vi.mock("../../src/db/ids", () => ({
  newId: () => "unused",
  // A real digest, not a truncation: a slicing mock made two different
  // statement lines share an id and hid the very collision this file checks.
  deterministicId: async (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 32),
  naturalKeys: new Proxy({}, {
    get: (_target, property) => (...parts: unknown[]) => `${String(property)}|${parts.join("|")}`,
  }),
}));
vi.mock("../../src/sync/engine", () => ({ scheduleSync: vi.fn() }));
vi.mock("../../src/services/fx-fetch", () => ({ lookupRate: vi.fn(() => null) }));
vi.mock("../../src/services/markets", () => ({ marketSellRateTry: vi.fn(() => null) }));

import { commitStatementRows, type AcceptedStatementRow } from "../../src/data/repo/statement-import";
import { createInstallmentPlan } from "../../src/data/repo/installments";
import { revertExpected } from "../../src/data/repo/expected";
import type { MonthKey } from "../../src/domain/dates";
import { statementPlanSpec } from "../../src/domain/statement-import";
import { migrationStatements } from "../helpers";

const USER = "statement-user";
const NOW = "2026-08-18T09:00:00.000Z";
/** The period the statement bills. Every accepted line lands inside it. */
const PERIOD = "2026-08";
/** With no card cycle to read a due date from, the period's last day is it. */
const CHARGE_DATE = "2026-08-31";

function seed(): void {
  harness.db!.prepare(
    `INSERT INTO persons (id, user_id, created_at, updated_at, deleted_at, tombstone_version, name, is_self)
     VALUES ('person-self', ?, ?, ?, NULL, 0, 'Ben', 1)`,
  ).run(USER, NOW, NOW);
  harness.db!.prepare(
    `INSERT INTO categories (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       name, kind, sort_order, is_column, is_transfer)
     VALUES ('cat-1', ?, ?, ?, NULL, 0, 'Market', 'expense', 0, 1, 0)`,
  ).run(USER, NOW, NOW);
}

function seedCard(): void {
  harness.db!.prepare(
    `INSERT INTO payment_sources (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       name, type, person_id, due_day, statement_day, color, logo_source, logo_ref, is_active)
     VALUES ('card', ?, ?, ?, NULL, 0, 'Kart', 'credit_card', 'person-self', 10, 25, NULL, 'initials', NULL, 1)`,
  ).run(USER, NOW, NOW);
}

const livePlans = () =>
  harness.db!.prepare(`SELECT * FROM installment_plans WHERE user_id = ? AND deleted_at IS NULL`).all(USER) as
    Record<string, unknown>[];

const liveRows = () =>
  harness.db!.prepare(`SELECT * FROM transactions WHERE user_id = ? AND deleted_at IS NULL`).all(USER) as
    Record<string, unknown>[];

const row = (over: Partial<AcceptedStatementRow> = {}): AcceptedStatementRow => ({
  importKey: "stmt|2026-08|2026-08-12|migros market|123456|",
  date: "2026-08-12",
  description: "MIGROS MARKET",
  amountMinor: 123_456,
  isRefund: false,
  categoryId: "cat-1",
  plan: null,
  expectedId: null,
  ...over,
});

describe("committing accepted statement rows", () => {
  beforeEach(() => {
    harness.db = new DatabaseSync(":memory:");
    for (const statement of migrationStatements) harness.db.exec(statement);
    harness.failWrites = false;
    seed();
  });

  it("writes an accepted row with its origin and source identity", async () => {
    const result = await commitStatementRows(USER, { personId: "person-self", period: PERIOD, paymentSourceId: null, rows: [row()] });
    expect(result.writtenIds).toHaveLength(1);
    expect(result.skipped).toBe(0);
    const [written] = liveRows();
    expect(written).toMatchObject({
      origin: "statement",
      import_key: row().importKey,
      amount_try_minor: 123_456,
      purchase_date: "2026-08-12",
      effective_date: CHARGE_DATE,
      status: "realized",
      note: "MIGROS MARKET",
    });
  });

  /** The whole point of a deterministic id: the second import adds nothing. */
  it("is idempotent when the same statement is imported again", async () => {
    await commitStatementRows(USER, { personId: "person-self", period: PERIOD, paymentSourceId: null, rows: [row()] });
    const second = await commitStatementRows(USER, { personId: "person-self", period: PERIOD, paymentSourceId: null, rows: [row()] });
    expect(second.writtenIds).toEqual([]);
    expect(second.skipped).toBe(1);
    expect(liveRows()).toHaveLength(1);
  });

  /**
   * A repeat is skipped rather than overwritten: overwriting would discard an
   * edit the owner made to that transaction after the first import.
   */
  it("does not overwrite an edit made after the first import", async () => {
    await commitStatementRows(USER, { personId: "person-self", period: PERIOD, paymentSourceId: null, rows: [row()] });
    harness.db!.prepare(`UPDATE transactions SET note = 'benim notum' WHERE user_id = ?`).run(USER);
    await commitStatementRows(USER, { personId: "person-self", period: PERIOD, paymentSourceId: null, rows: [row({ description: "MIGROS MARKET" })] });
    expect(liveRows()[0]?.note).toBe("benim notum");
  });

  it("keeps two genuinely different lines apart", async () => {
    const result = await commitStatementRows(USER, { personId: "person-self", period: PERIOD, paymentSourceId: null, rows: [
      row(),
      row({ importKey: "stmt|2026-08|2026-08-12|kahve|8990|", description: "KAHVE", amountMinor: 8_990 }),
    ] });
    expect(result.writtenIds).toHaveLength(2);
    expect(liveRows()).toHaveLength(2);
  });

  it("records a refund as a negative expense in its own category", async () => {
    await commitStatementRows(USER, { personId: "person-self", period: PERIOD, paymentSourceId: null, rows: [row({ isRefund: true })] });
    expect(liveRows()[0]).toMatchObject({ type: "expense", amount_try_minor: -123_456, category_id: "cat-1" });
  });

  /**
   * A half-imported statement is indistinguishable from a complete one, so a
   * failure anywhere has to leave the ledger exactly as it was.
   */
  it("writes nothing at all when any row fails", async () => {
    harness.failWrites = true;
    await expect(commitStatementRows(USER, { personId: "person-self", period: PERIOD, paymentSourceId: null, rows: [
      row(),
      row({ importKey: "stmt|other", description: "KAHVE", amountMinor: 8_990 }),
    ] })).rejects.toThrow(/injected write failure/u);
    expect(liveRows()).toEqual([]);
  });

  it("refuses a row whose category is not a live category of this account", async () => {
    await expect(commitStatementRows(USER, { personId: "person-self", period: PERIOD, paymentSourceId: null, rows: [row({ categoryId: "missing" })] })).rejects.toThrow();
    expect(liveRows()).toEqual([]);
  });

  it("refuses a person who is not a live person of this account", async () => {
    await expect(commitStatementRows(USER, { personId: "ghost", period: PERIOD, paymentSourceId: null, rows: [row()] })).rejects.toThrow();
    expect(liveRows()).toEqual([]);
  });

  it("refuses a non-positive amount rather than storing a zero charge", async () => {
    await expect(commitStatementRows(USER, { personId: "person-self", period: PERIOD, paymentSourceId: null, rows: [row({ amountMinor: 0 })] })).rejects.toThrow();
    expect(liveRows()).toEqual([]);
  });

  it("leaves a statement whose period has not been paid yet pending", async () => {
    // A statement can be imported before it is due. Writing it as realized
    // would move money in the ledger on a day it has not moved, which is the
    // same defect an early-dated transaction would cause. The date that
    // decides this is the PERIOD's, not the day printed beside the line.
    const nextYear = String(Number(PERIOD.slice(0, 4)) + 1);
    const result = await commitStatementRows(USER, {
      personId: "person-self",
      period: `${nextYear}-08`,
      paymentSourceId: null,
      rows: [row({ importKey: "future-key" })],
    });

    expect(result.writtenIds).toHaveLength(1);
    const written = liveRows().find((live) => live.import_key === "future-key");
    expect(written).toMatchObject({ status: "pending", effective_date: `${nextYear}-08-31` });
  });

  it("refuses a negative amount, not only a zero one", async () => {
    // Zero is caught by the amount guard above it; a negative has to be caught
    // here or a refund typed as a charge would credit the ledger.
    await expect(commitStatementRows(USER, { personId: "person-self", period: PERIOD, paymentSourceId: null, rows: [row({ amountMinor: -1 })] })).rejects.toThrow();
    expect(liveRows()).toEqual([]);
  });

  it("does nothing, successfully, when nothing was accepted", async () => {
    await expect(commitStatementRows(USER, { personId: "person-self", period: PERIOD, paymentSourceId: null, rows: [] }))
      .resolves.toEqual({ writtenIds: [], skipped: 0, plansWritten: 0 });
  });
});

/**
 * A statement bills one period, and every line on it is settled on one day.
 *
 * Dating each line by the day printed beside it was how one July statement
 * wrote charges into every month its purchases had been made in — months the
 * owner had already reconciled.
 */
describe("a statement reaches exactly one month", () => {
  beforeEach(() => {
    harness.db = new DatabaseSync(":memory:");
    for (const statement of migrationStatements) harness.db.exec(statement);
    harness.failWrites = false;
    seed();
    seedCard();
  });

  it("settles every line on the card's own due date for the period", async () => {
    await commitStatementRows(USER, {
      personId: "person-self",
      period: "2026-07",
      paymentSourceId: "card",
      rows: [
        row({ importKey: "a", date: "2026-06-28" }),
        row({ importKey: "b", date: "2026-07-19", description: "KAHVE", amountMinor: 8_990 }),
      ],
    });

    // Closing on the 25th, due on the 10th: the 10th of the NEXT month.
    expect(liveRows().map((live) => live.effective_date)).toEqual(["2026-08-10", "2026-08-10"]);
    // The printed day survives as provenance and decides nothing.
    expect(liveRows().map((live) => live.purchase_date).sort()).toEqual(["2026-06-28", "2026-07-19"]);
  });

  it("attaches the lines to the period's statement so nothing moves them later", async () => {
    await commitStatementRows(USER, {
      personId: "person-self",
      period: "2026-07",
      paymentSourceId: "card",
      rows: [row()],
    });
    const statements = harness.db!
      .prepare(`SELECT * FROM credit_card_statements WHERE user_id = ? AND deleted_at IS NULL`)
      .all(USER) as Record<string, unknown>[];
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({ period_month: "2026-07", payment_source_id: "card" });
    expect(liveRows()[0]?.card_statement_id).toBe(statements[0]?.id);
  });

  it("refuses a card that is not a live card of this account", async () => {
    await expect(commitStatementRows(USER, {
      personId: "person-self",
      period: "2026-07",
      paymentSourceId: "ghost",
      rows: [row()],
    })).rejects.toThrow();
    expect(liveRows()).toEqual([]);
  });
});

/**
 * An instalment line is not a charge. It is one payment of a plan, and the
 * Taksitler screen is built on the plan — so a line reading `3/9` used to
 * arrive as a loose expense and the plan behind it never existed.
 */
/**
 * A subscription paid on the card reaches the statement as an ordinary line.
 * Imported while its expected payment is still open, the line IS that payment;
 * leaving the expectation open meant confirming it later wrote the charge twice.
 */
describe("a line that settles an expected subscription payment", () => {
  const seedExpectation = (status: "pending" | "paid") => {
    harness.db!.prepare(
      `INSERT INTO subscriptions (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
         name, amount_minor, amount_mode, currency, cycle, interval_months, billing_day, next_due_date,
         payment_source_id, category_id, person_id, is_active, canceled_at, trial_end_date, auto_pay,
         website_domain, logo_source, logo_ref, note)
       VALUES ('sub-1', ?, ?, ?, NULL, 0, 'Netflix', 22999, 'fixed', 'TRY', 'monthly', 1, 12, '2026-08-12',
         'card', 'cat-1', 'person-self', 1, NULL, NULL, 1, NULL, 'initials', NULL, NULL)`,
    ).run(USER, NOW, NOW);
    harness.db!.prepare(
      `INSERT INTO expected_payments (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
         direction, kind, ref_id, due_date, amount_minor, amount_is_estimated, currency, status, paid_at,
         auto_confirmed, transaction_id)
       VALUES ('exp-1', ?, ?, ?, NULL, 0, 'out', 'subscription', 'sub-1', '2026-08-12', 22999, 0, 'TRY', ?, NULL, 0, NULL)`,
    ).run(USER, NOW, NOW, status);
  };
  const expectation = () =>
    harness.db!.prepare(`SELECT status, transaction_id FROM expected_payments WHERE id = 'exp-1'`).get() as Record<string, unknown>;
  const netflix = row({ importKey: "stmt|netflix", description: "NETFLIX.COM", amountMinor: 22_999, expectedId: "exp-1" });

  beforeEach(() => {
    harness.db = new DatabaseSync(":memory:");
    for (const statement of migrationStatements) harness.db.exec(statement);
    seed();
    seedCard();
  });

  it("writes the charge as that subscription's payment and closes the expectation", async () => {
    seedExpectation("pending");
    const result = await commitStatementRows(USER, { personId: "person-self", period: PERIOD, paymentSourceId: "card", rows: [netflix] });

    expect(liveRows()).toEqual([expect.objectContaining({ id: result.writtenIds[0], subscription_id: "sub-1", origin: "statement" })]);
    expect(expectation()).toEqual({ status: "paid", transaction_id: result.writtenIds[0] });
    expect(harness.db!.prepare(`SELECT next_due_date FROM subscriptions WHERE id = 'sub-1'`).get()).toEqual({ next_due_date: "2026-09-12" });
  });

  /** Undoing the payment is the expectation's business; the charge is the bank's record and stays. */
  it("keeps the statement's charge when that payment is reverted", async () => {
    seedExpectation("pending");
    await commitStatementRows(USER, { personId: "person-self", period: PERIOD, paymentSourceId: "card", rows: [netflix] });
    await revertExpected(USER, "exp-1");

    expect(expectation()).toEqual({ status: "pending", transaction_id: null });
    expect(liveRows()).toHaveLength(1);
  });

  it("skips the line when the payment was confirmed in the meantime", async () => {
    seedExpectation("paid");
    const result = await commitStatementRows(USER, { personId: "person-self", period: PERIOD, paymentSourceId: "card", rows: [netflix] });

    expect(result).toMatchObject({ writtenIds: [], skipped: 1 });
    expect(liveRows()).toEqual([]);
  });
});

describe("an instalment line becomes the plan behind it", () => {
  const instalment = (over: Partial<AcceptedStatementRow> = {}) => row({
    importKey: "teknosa|3",
    description: "TEKNOSA",
    amountMinor: 199_573,
    plan: { startMonth: "2026-05", installmentCount: 9, installmentNo: 3 },
    ...over,
  });

  beforeEach(() => {
    harness.db = new DatabaseSync(":memory:");
    for (const statement of migrationStatements) harness.db.exec(statement);
    harness.failWrites = false;
    seed();
    seedCard();
  });

  /** A statement reaches one month: the two instalments before this one were billed on statements already past. */
  it("writes the plan behind the line, with its instalments from this one on", async () => {
    const result = await commitStatementRows(USER, {
      personId: "person-self",
      period: "2026-07",
      paymentSourceId: "card",
      rows: [instalment()],
    });

    expect(result.plansWritten).toBe(1);
    expect(result.writtenIds).toEqual([]);
    expect(livePlans()).toHaveLength(1);
    expect(livePlans()[0]).toMatchObject({
      title: "TEKNOSA",
      kind: "card_installment",
      installment_count: 9,
      monthly_amount_minor: 199_573,
      start_month: "2026-05",
      payment_source_id: "card",
    });
    expect(liveRows().map((live) => live.installment_no).sort((a, b) => Number(a) - Number(b))).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(liveRows().every((live) => live.installment_plan_id === livePlans()[0]?.id)).toBe(true);
  });

  /**
   * The identity is derived from what every statement of this plan prints, so
   * next month's statement finds the plan already there rather than opening a
   * rival one beside it.
   */
  it("converges when the next statement of the same plan arrives", async () => {
    await commitStatementRows(USER, {
      personId: "person-self",
      period: "2026-07",
      paymentSourceId: "card",
      rows: [instalment()],
    });
    const second = await commitStatementRows(USER, {
      personId: "person-self",
      period: "2026-08",
      paymentSourceId: "card",
      rows: [instalment({
        importKey: "teknosa|4",
        plan: { startMonth: "2026-05", installmentCount: 9, installmentNo: 4 },
      })],
    });

    expect(second.plansWritten).toBe(0);
    expect(second.skipped).toBe(1);
    expect(livePlans()).toHaveLength(1);
    expect(liveRows()).toHaveLength(7);
  });

  /** Two genuinely identical purchases on one statement: the review offers both, and both are written. */
  it("keeps two identical instalment purchases of one statement as two plans, and converges on both", async () => {
    // Any repeat number, not only a single digit.
    const twice = [instalment(), instalment({ importKey: "teknosa|3#10" })];
    await commitStatementRows(USER, { personId: "person-self", period: "2026-07", paymentSourceId: "card", rows: twice });
    expect(livePlans()).toHaveLength(2);
    expect(liveRows()).toHaveLength(14);

    const again = await commitStatementRows(USER, { personId: "person-self", period: "2026-07", paymentSourceId: "card", rows: twice });
    expect(again).toMatchObject({ plansWritten: 0, skipped: 2 });
    expect(livePlans()).toHaveLength(2);
  });

  /**
   * A plan a statement opened before keeps the identity it was written under,
   * whatever else is in the ledger and whatever the merchant prints — a `#12`
   * inside a shop's name is not a repeat.
   */
  it("keeps the identity plans have always had, beside plans that are not this one", async () => {
    await createInstallmentPlan(USER, {
      title: "Başka", kind: "card_installment", totalAmountMinor: null, monthlyAmountMinor: 10_000, installmentCount: 12,
      currency: "TRY", fxRate: null, startMonth: "2026-01", dueDay: null, paymentSourceId: "card",
      personId: "person-self", personIsSelf: true, categoryId: "cat-1", note: null, tryFactor: 1,
    });
    const result = await commitStatementRows(USER, {
      personId: "person-self",
      period: "2026-07",
      paymentSourceId: "card",
      rows: [instalment({ importKey: "stmt|2026-07|2026-05-03|teknosa #12 avm|199573|3" })],
    });

    expect(result.plansWritten).toBe(1);
    const identity = createHash("sha256").update(`importInstallmentPlan|${USER}|TEKNOSA|199573|9|2026-05`).digest("hex").slice(0, 32);
    expect(livePlans().map((plan) => plan.id)).toContain(identity);
  });

  /**
   * The schedule keeps plans on two cards apart, but the same printed plan
   * derives the same identity whichever card it was filed under, so naming a
   * different card the second time still does not open it twice.
   */
  it("converges on the plan an earlier statement opened even under another card", async () => {
    harness.db!.prepare(
      `INSERT INTO payment_sources (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
         name, type, person_id, due_day, statement_day, color, logo_source, logo_ref, is_active)
       VALUES ('card-2', ?, ?, ?, NULL, 0, 'Diğer Kart', 'credit_card', 'person-self', 10, 25, NULL, 'initials', NULL, 1)`,
    ).run(USER, NOW, NOW);
    await commitStatementRows(USER, { personId: "person-self", period: "2026-07", paymentSourceId: "card", rows: [instalment()] });
    const again = await commitStatementRows(USER, { personId: "person-self", period: "2026-07", paymentSourceId: "card-2", rows: [instalment()] });

    expect(again).toMatchObject({ plansWritten: 0, skipped: 1 });
    expect(livePlans()).toHaveLength(1);
  });

  /**
   * A statement that prints only how many payments are left gives each month
   * a different start and count for the same plan. Keyed on those, every
   * statement opened a plan of its own over the months the last one already
   * charged.
   */
  it("converges when the next statement prints only the same plan's remainder", async () => {
    const remainder = (period: MonthKey, left: number) => instalment({
      importKey: `teknosa|${period}`,
      plan: statementPlanSpec({ kind: "installment", installmentNo: null, installmentCount: null, remainingInstallments: left }, period),
    });
    await commitStatementRows(USER, { personId: "person-self", period: "2026-07", paymentSourceId: "card", rows: [remainder("2026-07", 3)] });
    await commitStatementRows(USER, { personId: "person-self", period: "2026-08", paymentSourceId: "card", rows: [remainder("2026-08", 2)] });

    expect(livePlans()).toHaveLength(1);
    const months = liveRows().map((live) => String(live.effective_date).slice(0, 7));
    expect(new Set(months).size).toBe(months.length);
  });

  /**
   * One purchase entered three ways is one plan. The plan form gives a plan a
   * random id and the owner's own name, so the statement's derived identity
   * never found it and the same instalments were written twice.
   */
  it("meets a plan the owner entered by hand instead of opening a rival one", async () => {
    await createInstallmentPlan(USER, {
      title: "Telefon",
      kind: "card_installment",
      totalAmountMinor: null,
      monthlyAmountMinor: 199_573,
      installmentCount: 9,
      currency: "TRY",
      fxRate: null,
      startMonth: "2026-05",
      dueDay: null,
      paymentSourceId: "card",
      personId: "person-self",
      personIsSelf: true,
      categoryId: "cat-1",
      note: null,
      tryFactor: 1,
    });
    await commitStatementRows(USER, { personId: "person-self", period: "2026-07", paymentSourceId: "card", rows: [instalment()] });

    expect(livePlans()).toHaveLength(1);
    expect(liveRows()).toHaveLength(9);
  });

  /** The bank fixed the lira at purchase; the plan's rows restate it, so the two differ by the rate's drift. */
  it("meets a foreign-currency plan on its card by the lira it bills", async () => {
    await createInstallmentPlan(USER, {
      title: "Kulaklık", kind: "card_installment", totalAmountMinor: null, monthlyAmountMinor: 50_00, installmentCount: 9,
      currency: "USD", fxRate: "40", startMonth: "2026-05", dueDay: null, paymentSourceId: "card",
      personId: "person-self", personIsSelf: true, categoryId: "cat-1", note: null, tryFactor: 40,
    });
    const result = await commitStatementRows(USER, { personId: "person-self", period: "2026-07", paymentSourceId: "card", rows: [instalment({ amountMinor: 2_100_00 })] });

    expect(result).toMatchObject({ plansWritten: 0, skipped: 1 });
    expect(livePlans()).toHaveLength(1);
  });

  it("leaves a refund printed with an instalment marker as a single line", async () => {
    // A return off a plan is money coming back, not a plan being opened. The
    // screen decides this, and the writer must not second-guess a null.
    await commitStatementRows(USER, {
      personId: "person-self",
      period: "2026-07",
      paymentSourceId: "card",
      rows: [instalment({ plan: null, isRefund: true })],
    });
    expect(livePlans()).toEqual([]);
    expect(liveRows()).toHaveLength(1);
    expect(liveRows()[0]).toMatchObject({ amount_try_minor: -199_573 });
  });

  it("still writes the plan when no card was named", async () => {
    const result = await commitStatementRows(USER, {
      personId: "person-self",
      period: "2026-07",
      paymentSourceId: null,
      rows: [instalment()],
    });
    expect(result.plansWritten).toBe(1);
    expect(livePlans()[0]?.payment_source_id).toBeNull();
    expect(liveRows()).toHaveLength(7);
  });
});
