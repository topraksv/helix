/**
 * A subscription rule is a schedule, not a payment.
 *
 * Creating one must never move the current balance: only a confirmed
 * occurrence does that (spec §2.6, §2.7). The regression this file exists for
 * is an auto-pay rule saved on its own billing day — `subscription-form.tsx`
 * defaults `nextDueDate` to today whenever the billing day is today, and the
 * first maintenance pass then confirmed that occurrence as a REALIZED expense,
 * so the balance dropped the moment the rule was saved.
 */
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null, nextId: 0 }));

vi.mock("../src/db/client", async () => {
  const { sqliteClientMock } = await import("./helpers");
  return sqliteClientMock(() => harness.db!);
});

vi.mock("../src/db/ids", () => ({
  newId: () => `id-${String(++harness.nextId).padStart(3, "0")}`,
  deterministicId: async (key: string) => `det:${key}`,
  naturalKeys: new Proxy({}, {
    get: (_target, property) => (...parts: unknown[]) => `${String(property)}|${parts.join("|")}`,
  }),
}));

vi.mock("../src/services/fx-fetch", () => ({ lookupRate: vi.fn(() => null) }));
import { lookupRate } from "../src/services/fx-fetch";
vi.mock("../src/services/markets", () => ({ marketSellRateTry: vi.fn(() => null) }));
vi.mock("../src/sync/engine", () => ({ scheduleSync: vi.fn() }));

import { upsertSubscription } from "../src/data/repo/rules";
import { runMaintenance } from "../src/data/repo/maintenance";
import { confirmExpected, revertExpected, setExpectedAmount } from "../src/data/repo/expected";
import { currentBalance } from "../src/domain/balance";
import { todayISO } from "../src/domain/dates";
import type { TxLike } from "../src/domain/types";
import { migrationStatements } from "./helpers";

const USER = "subscription-balance-user";
const SEEDED_AT = "2020-01-01T09:00:00.000Z";
const OPENING_MINOR = 500_00;


function seedWorkspace(): void {
  harness.db!.prepare(
    `INSERT INTO persons (id, user_id, created_at, updated_at, deleted_at, tombstone_version, name, is_self)
     VALUES ('person-self', ?, ?, ?, NULL, 0, 'Ben', 1)`,
  ).run(USER, SEEDED_AT, SEEDED_AT);
  harness.db!.prepare(
    `INSERT INTO categories (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       name, kind, sort_order, is_column, is_transfer)
     VALUES ('category-subs', ?, ?, ?, NULL, 0, 'Abonelikler', 'expense', 0, 1, 0)`,
  ).run(USER, SEEDED_AT, SEEDED_AT);
}

interface TransactionRow {
  id: string;
  status: string;
  effective_date: string;
  amount_try_minor: number;
  type: string;
  person_id: string;
  category_id: string | null;
  purchase_date: string | null;
  installment_plan_id: string | null;
  card_statement_id: string | null;
  subscription_id: string | null;
  is_aggregate: number;
}

function liveTransactions(): TransactionRow[] {
  return harness.db!
    .prepare(`SELECT * FROM transactions WHERE user_id = ? AND deleted_at IS NULL`)
    .all(USER) as unknown as TransactionRow[];
}

function expectedRows(): { id: string; status: string; due_date: string }[] {
  return harness.db!
    .prepare(`SELECT id, status, due_date FROM expected_payments WHERE user_id = ? AND deleted_at IS NULL ORDER BY due_date`)
    .all(USER) as unknown as { id: string; status: string; due_date: string }[];
}

/** The balance the dashboard hero shows, over the same realized-only rule. */
function balanceNow(): number {
  const transactions: TxLike[] = liveTransactions().map((row) => ({
    id: row.id,
    type: row.type as TxLike["type"],
    amountTryMinor: row.amount_try_minor,
    purchaseDate: row.purchase_date,
    effectiveDate: row.effective_date,
    status: row.status as TxLike["status"],
    categoryId: row.category_id,
    categoryKind: "expense",
    paymentSourceId: null,
    personIsSelf: row.person_id === "person-self",
    installmentPlanId: row.installment_plan_id,
    cardStatementId: row.card_statement_id,
    subscriptionId: row.subscription_id,
    isAggregate: Boolean(row.is_aggregate),
  }));
  return currentBalance({
    openingBalanceMinor: OPENING_MINOR,
    transactions,
    adjustments: [],
    today: todayISO(),
  });
}

/** Backdate a rule so the "the rule already existed" branch can be exercised. */
function backdateSubscription(id: string, createdAt: string): void {
  harness.db!.prepare(`UPDATE subscriptions SET created_at = ? WHERE id = ? AND user_id = ?`).run(createdAt, id, USER);
}

const baseInput = {
  name: "Netflix",
  amountMinor: 229_99,
  currency: "TRY",
  cycle: "monthly" as const,
  intervalMonths: 1,
  paymentSourceId: null,
  categoryId: "category-subs",
  personId: "person-self",
  isActive: true,
  trialEndDate: null,
  websiteDomain: null,
  note: null,
};

describe("adding a subscription never moves the current balance", () => {
  beforeEach(() => {
    harness.db = new DatabaseSync(":memory:");
    for (const statement of migrationStatements) harness.db.exec(statement);
    harness.nextId = 0;
    seedWorkspace();
  });

  /** Today's own day-of-month, so the form's "due today" default is reproduced. */
  const dueTodayInput = () => {
    const today = todayISO();
    return { ...baseInput, billingDay: Number(today.slice(8, 10)), nextDueDate: today };
  };

  it("leaves the balance untouched for an unpaid manual subscription due today", async () => {
    await upsertSubscription(USER, { ...dueTodayInput(), autoPay: false });
    await runMaintenance(USER);

    expect(liveTransactions()).toEqual([]);
    expect(balanceNow()).toBe(OPENING_MINOR);
    expect(expectedRows()[0]?.status).toBe("pending");
  });

  it("leaves the balance untouched for an auto-pay subscription saved on its own billing day", async () => {
    await upsertSubscription(USER, { ...dueTodayInput(), autoPay: true });
    await runMaintenance(USER);

    // The occurrence is real and visible — it is simply not confirmed money.
    expect(expectedRows()[0]).toMatchObject({ due_date: todayISO(), status: "pending" });
    expect(liveTransactions()).toEqual([]);
    expect(balanceNow()).toBe(OPENING_MINOR);
  });

  it("keeps the balance stable across repeated maintenance passes", async () => {
    await upsertSubscription(USER, { ...dueTodayInput(), autoPay: true });
    await runMaintenance(USER);
    await runMaintenance(USER);
    await runMaintenance(USER);

    expect(liveTransactions()).toEqual([]);
    expect(balanceNow()).toBe(OPENING_MINOR);
  });

  it("still auto-confirms a rule that already existed when the due date arrived", async () => {
    const id = await upsertSubscription(USER, { ...dueTodayInput(), autoPay: true });
    backdateSubscription(id, "2026-01-05T09:00:00.000Z");
    await runMaintenance(USER);

    const transactions = liveTransactions();
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ status: "realized", effective_date: todayISO() });
    expect(balanceNow()).toBe(OPENING_MINOR - baseInput.amountMinor);
  });

  it("records exactly one realized expense when the user confirms the occurrence", async () => {
    await upsertSubscription(USER, { ...dueTodayInput(), autoPay: true });
    await runMaintenance(USER);
    const pending = expectedRows()[0];
    expect(pending).toBeDefined();

    await confirmExpected(USER, pending!.id, { personId: "person-self", categoryId: "category-subs" });
    await runMaintenance(USER);

    expect(liveTransactions()).toHaveLength(1);
    expect(balanceNow()).toBe(OPENING_MINOR - baseInput.amountMinor);
  });

  it("does not touch the balance for a recurring rule whose next charge is in the future", async () => {
    await upsertSubscription(USER, { ...baseInput, billingDay: 28, nextDueDate: "2099-01-28", autoPay: true });
    await runMaintenance(USER);

    expect(liveTransactions()).toEqual([]);
    expect(balanceNow()).toBe(OPENING_MINOR);
  });

  /**
   * One auto-payment that cannot be priced must not stop the others.
   *
   * `runMaintenance` confirms every due auto-pay rule in one pass. A foreign
   * currency with no cached rate for the day makes `confirmExpected` refuse —
   * correctly, because the alternative is inventing a lira figure — and the
   * pass catches that and moves on. Nothing exercised the catch, so a rule
   * whose rate had not arrived could have taken every other rule's payment
   * with it and the suite would have stayed green.
   */
  it("leaves an unpriceable auto-payment pending and still takes the others", async () => {
    // Backdated, because auto-pay only fires for a rule that already existed
    // when its due date arrived — the same guard the test above covers.
    backdateSubscription(
      await upsertSubscription(USER, { ...dueTodayInput(), autoPay: true, currency: "USD" }),
      "2026-01-05T09:00:00.000Z",
    );
    backdateSubscription(
      await upsertSubscription(USER, { ...dueTodayInput(), name: "Spotify", autoPay: true }),
      "2026-01-05T09:00:00.000Z",
    );

    await runMaintenance(USER);

    const rows = liveTransactions();
    expect(rows, "the lira rule must still have been paid").toHaveLength(1);
    expect(expectedRows().some((row) => row.status === "pending" || row.status === "late")).toBe(true);
    expect(balanceNow()).toBe(OPENING_MINOR - baseInput.amountMinor);
  });

  /**
   * Confirming an occurrence is where an expectation becomes money, and the
   * shape of that money depends on four things the rule carries: the card it is
   * paid with, the currency it is priced in, the person it belongs to, and
   * whether its amount is fixed. Each of those was a branch nothing walked.
   */
  describe("what a confirmation turns an expectation into", () => {
    function seedCard(): void {
      harness.db!.prepare(
        `INSERT INTO payment_sources (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
           name, type, person_id, due_day, statement_day, color, logo_source, logo_ref, is_active)
         VALUES ('card-1', ?, ?, ?, NULL, 0, 'Kart', 'credit_card', 'person-self', 10, 25, NULL, 'initials', NULL, 1)`,
      ).run(USER, SEEDED_AT, SEEDED_AT);
    }

    async function firstPending(): Promise<{ id: string; due_date: string }> {
      await runMaintenance(USER);
      const row = expectedRows()[0];
      expect(row, "the rule should have raised an occurrence").toBeDefined();
      return row!;
    }

    /**
     * A card expense does not leave the account on the day it is spent, it
     * leaves on the statement's due date — so confirming one has to move the
     * ledger date and file the row under a statement, or the month it lands in
     * is wrong.
     */
    it("files a card payment under its statement and dates it to the due day", async () => {
      seedCard();
      await upsertSubscription(USER, { ...dueTodayInput(), autoPay: false, paymentSourceId: "card-1" });
      const pending = await firstPending();

      await confirmExpected(USER, pending.id, { personId: "person-self", categoryId: "category-subs" });

      const [row] = liveTransactions();
      expect(row!.card_statement_id).not.toBeNull();
      expect(row!.purchase_date).toBe(pending.due_date);
      // The statement's own due day, not the purchase day.
      expect(row!.effective_date.slice(8)).toBe("10");
      const statements = harness.db!
        .prepare(`SELECT COUNT(*) AS n FROM credit_card_statements WHERE user_id = ? AND deleted_at IS NULL`)
        .get(USER) as { n: number };
      expect(statements.n).toBe(1);
    });

    /**
     * A price in a foreign currency needs a rate for the DAY, and there is no
     * safe guess: confirming without one would write a Turkish-lira figure the
     * app invented. It refuses instead.
     */
    it("refuses a foreign-currency occurrence with no rate for that day", async () => {
      await upsertSubscription(USER, { ...dueTodayInput(), autoPay: false, currency: "USD" });
      const pending = await firstPending();

      await expect(
        confirmExpected(USER, pending.id, { personId: "person-self", categoryId: "category-subs" }),
      ).rejects.toThrow();
      expect(liveTransactions()).toEqual([]);
    });

    it("converts a foreign-currency occurrence once a rate for that day is cached", async () => {
      vi.mocked(lookupRate).mockReturnValue({ rate: { rateTry: 40 } } as never);
      try {
        await upsertSubscription(USER, { ...dueTodayInput(), autoPay: false, currency: "USD" });
        const pending = await firstPending();

        await confirmExpected(USER, pending.id, { personId: "person-self", categoryId: "category-subs" });

        const [row] = liveTransactions();
        expect(row!.amount_try_minor).toBe(baseInput.amountMinor * 40);
      } finally {
        vi.mocked(lookupRate).mockReturnValue(null as never);
      }
    });

    /** The rule owns the person; confirming as somebody else is a data error. */
    it("refuses a confirmation attributed to the wrong person", async () => {
      await upsertSubscription(USER, { ...dueTodayInput(), autoPay: false });
      const pending = await firstPending();

      await expect(
        confirmExpected(USER, pending.id, { personId: "person-nobody", categoryId: "category-subs" }),
      ).rejects.toThrow();
      expect(liveTransactions()).toEqual([]);
    });

    /**
     * A variable subscription — a utility bill — has no amount until the
     * invoice arrives. Entering it is a separate step from confirming it, and
     * the whole of that step was untested.
     */
    describe("entering the invoice amount for a variable subscription", () => {
      it("refuses a confirmation while the estimate has not been replaced", async () => {
        await upsertSubscription(USER, { ...dueTodayInput(), autoPay: false, amountMode: "variable" });
        const pending = await firstPending();

        await expect(
          confirmExpected(USER, pending.id, { personId: "person-self", categoryId: "category-subs" }),
        ).rejects.toThrow();
      });

      it("takes the invoice amount, and then the confirmation uses it", async () => {
        await upsertSubscription(USER, { ...dueTodayInput(), autoPay: false, amountMode: "variable" });
        const pending = await firstPending();

        await setExpectedAmount(USER, pending.id, 512_34);
        await confirmExpected(USER, pending.id, { personId: "person-self", categoryId: "category-subs" });

        const [row] = liveTransactions();
        expect(row!.amount_try_minor).toBe(512_34);
      });

      /** A fixed rule's amount is the rule's, not the occurrence's. */
      it("refuses to edit the amount of a fixed subscription", async () => {
        await upsertSubscription(USER, { ...dueTodayInput(), autoPay: false });
        const pending = await firstPending();

        await expect(setExpectedAmount(USER, pending.id, 100_00)).rejects.toThrow();
      });

      /**
       * Silently, not by throwing: an occurrence that has already been settled
       * has nothing left to price, and two devices editing the same invoice is
       * an ordinary race rather than an error worth showing anyone.
       */
      it("does nothing once the occurrence has been confirmed", async () => {
        await upsertSubscription(USER, { ...dueTodayInput(), autoPay: false, amountMode: "variable" });
        const pending = await firstPending();
        await setExpectedAmount(USER, pending.id, 400_00);
        await confirmExpected(USER, pending.id, { personId: "person-self", categoryId: "category-subs" });

        await setExpectedAmount(USER, pending.id, 999_00);

        expect(liveTransactions()[0]!.amount_try_minor).toBe(400_00);
      });
    });

    /** Already settled: a second confirmation is a no-op, not a second row. */
    it("does nothing when the occurrence is already confirmed", async () => {
      await upsertSubscription(USER, { ...dueTodayInput(), autoPay: false });
      const pending = await firstPending();
      await confirmExpected(USER, pending.id, { personId: "person-self", categoryId: "category-subs" });

      await confirmExpected(USER, pending.id, { personId: "person-self", categoryId: "category-subs" });

      expect(liveTransactions()).toHaveLength(1);
    });
  });

  /**
   * Undoing a confirmation, which is the one place this module DELETES.
   *
   * It has to tell two transactions apart that look identical in the ledger:
   * the row the confirmation created, and a row the owner had already recorded
   * and then matched to the expectation. The first is the confirmation's to
   * remove; the second is the owner's own record of real money, and unlinking
   * it is the whole of the undo. The rule is written into the module and was
   * exercised by nothing.
   */
  describe("undoing a confirmation", () => {
    async function dueAndConfirmed(): Promise<string> {
      await upsertSubscription(USER, { ...dueTodayInput(), autoPay: true });
      await runMaintenance(USER);
      const pending = expectedRows()[0]!;
      await confirmExpected(USER, pending.id, { personId: "person-self", categoryId: "category-subs" });
      return pending.id;
    }

    /**
     * An occurrence that was never confirmed has no transaction to unwind, and
     * the undo still has to put the row back to pending rather than fail on the
     * missing half.
     */
    it("puts an unconfirmed occurrence back without looking for a transaction", async () => {
      await upsertSubscription(USER, { ...dueTodayInput(), autoPay: false });
      await runMaintenance(USER);
      const pending = expectedRows()[0]!;

      await revertExpected(USER, pending.id);

      expect(liveTransactions()).toEqual([]);
      expect(expectedRows()[0]!.status).toBe("pending");
    });

    it("removes the transaction the confirmation itself created", async () => {
      const id = await dueAndConfirmed();
      expect(liveTransactions()).toHaveLength(1);

      await revertExpected(USER, id);

      expect(liveTransactions()).toEqual([]);
      expect(balanceNow()).toBe(OPENING_MINOR);
      expect(expectedRows()[0]!.status).toBe("pending");
    });

    /**
     * The same undo against a MATCHED row. Provenance is the only thing that
     * separates the two cases, so the test changes exactly that and nothing
     * else: the money stays, the link goes.
     */
    it("keeps a transaction the owner recorded and only matched to it", async () => {
      const id = await dueAndConfirmed();
      const created = liveTransactions()[0]!;
      harness.db!.prepare(`UPDATE transactions SET origin = 'manual' WHERE id = ?`).run(created.id);

      await revertExpected(USER, id);

      const remaining = liveTransactions();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.id).toBe(created.id);
      expect(balanceNow()).toBe(OPENING_MINOR - baseInput.amountMinor);
      expect(expectedRows()[0]!.status).toBe("pending");
    });

    /**
     * A rule whose next charge was advanced by the confirmation has to be
     * wound back with it, or the occurrence being undone is skipped for ever.
     */
    it("winds the rule's next charge back to the occurrence it undid", async () => {
      const id = await dueAndConfirmed();
      const before = harness.db!
        .prepare(`SELECT next_due_date FROM subscriptions WHERE user_id = ? AND deleted_at IS NULL`)
        .get(USER) as { next_due_date: string };
      const due = expectedRows()[0]!.due_date;
      expect(before.next_due_date).not.toBe(due);

      await revertExpected(USER, id);

      const after = harness.db!
        .prepare(`SELECT next_due_date FROM subscriptions WHERE user_id = ? AND deleted_at IS NULL`)
        .get(USER) as { next_due_date: string };
      expect(after.next_due_date).toBe(due);
    });
  });
});

/**
 * Matching an expectation to money that is already in the ledger.
 *
 * The failure this prevents is double counting: the owner records a payment,
 * then confirms the expectation, and the same money is in the ledger twice.
 * Matching links the two instead — and undoing that link must give the
 * expectation back WITHOUT destroying the transaction, which the expectation
 * never owned.
 */
