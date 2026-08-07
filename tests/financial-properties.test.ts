/**
 * The rules that must hold for EVERY input, not for the ones someone thought of.
 *
 * `.ai/ROUTING.md` has routed serialization, ordering and normalization work to
 * property-based testing for a long time, and no test in this suite ever
 * generated an input. The example-based tests around these functions are good —
 * they pin real defects with real numbers — but they can only assert what their
 * author already suspected. These assert the shape of the answer over the whole
 * input space, which is where a financial engine hides its edge cases: the
 * amount that rounds differently, the two rows that sort equal, the month
 * boundary that lands on the 31st.
 *
 * Each property below is a sentence about the domain, not about the code. If
 * one fails, fast-check shrinks the counterexample to the smallest input that
 * still breaks it, and that input is the bug report.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildLedger, currentBalance, resolveLedgerAnchor } from "../src/domain/balance";
import { MAX_ABS_AMOUNT_MINOR, formatMinorInput, parseAmountExpression } from "../src/domain/money";
import { sortTransactions, type TransactionSortMode } from "../src/domain/transaction-search";
import { addMonthsToKey, monthKeyOf, monthRange, type ISODate, type MonthKey } from "../src/domain/dates";
import { resolveTombstoneVersion } from "../src/sync/tombstone-policy";
import type { TxLike } from "../src/domain/types";

/** Amounts the app accepts: whole minor units inside the entry ceiling. */
const minorAmount = fc.integer({ min: 1, max: 1_000_000_00 });

const isoDate = fc
  .date({ min: new Date("2020-01-01T00:00:00Z"), max: new Date("2035-12-31T00:00:00Z"), noInvalidDate: true })
  .map((date) => date.toISOString().slice(0, 10) as ISODate);

const transaction = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom("income" as const, "expense" as const, "transfer" as const),
  amountTryMinor: minorAmount,
  effectiveDate: isoDate,
  status: fc.constantFrom("realized" as const, "pending" as const),
  personIsSelf: fc.boolean(),
  categoryId: fc.option(fc.constantFrom("c1", "c2", "c3"), { nil: null }),
}).map((row): TxLike => ({
  ...row,
  purchaseDate: null,
  categoryKind: row.type === "income" ? "income" : "expense",
  paymentSourceId: null,
  installmentPlanId: null,
  cardStatementId: null,
  subscriptionId: null,
  isAggregate: false,
}));

describe("money input round-trip", () => {
  it("survives being written into a field and read back", () => {
    // Loading a saved amount into an editable field and saving it again must
    // not move it. The formatter groups thousands and the parser evaluates a
    // sum expression, so this crosses two independent pieces of Turkish
    // number handling.
    fc.assert(
      fc.property(fc.integer({ min: -MAX_ABS_AMOUNT_MINOR, max: MAX_ABS_AMOUNT_MINOR }), (amountMinor) => {
        expect(parseAmountExpression(formatMinorInput(amountMinor))).toBe(amountMinor);
      }),
      { numRuns: 500 },
    );
  });

  it("never invents a figure from an amount it cannot read", () => {
    // Anything that is not a number or a sum must be refused outright. A
    // partial parse is how a typo becomes a transaction.
    fc.assert(
      fc.property(fc.string(), (text) => {
        const parsed = parseAmountExpression(text);
        if (parsed === null) return;
        // Whatever it accepted, it must round-trip — no silent truncation.
        expect(parseAmountExpression(formatMinorInput(parsed))).toBe(parsed);
      }),
      { numRuns: 1_000 },
    );
  });
});

describe("balance chain", () => {
  it("carries every month's closing into the next month's opening", () => {
    // THE invariant of the whole product. If it can be broken by any set of
    // rows, the ledger is lying somewhere.
    fc.assert(
      fc.property(fc.array(transaction, { maxLength: 40 }), fc.integer({ min: -500_00, max: 500_00 }), (transactions, opening) => {
        const ledger = buildLedger({
          openingBalanceMinor: opening,
          startMonth: "2026-01",
          endMonth: "2026-12",
          transactions,
          adjustments: [],
          today: "2026-12-31" as ISODate,
        });
        expect(ledger[0]?.openingMinor).toBe(opening);
        for (let index = 1; index < ledger.length; index += 1) {
          expect(ledger[index]?.openingMinor).toBe(ledger[index - 1]?.closingMinor);
          // The projected chain, which also carries planned rows, links the
          // same way — the two chains are parallel, never interleaved.
          expect(ledger[index]?.projectedOpeningMinor).toBe(ledger[index - 1]?.projectedClosingMinor);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("closes each month at opening plus its own flows", () => {
    fc.assert(
      fc.property(fc.array(transaction, { maxLength: 40 }), (transactions) => {
        const ledger = buildLedger({
          openingBalanceMinor: 0,
          startMonth: "2026-01",
          endMonth: "2026-12",
          transactions,
          adjustments: [],
          today: "2026-12-31" as ISODate,
        });
        for (const month of ledger) {
          expect(month.closingMinor).toBe(
            month.openingMinor + month.incomeMinor - month.expenseMinor - month.transferMinor + month.adjustmentMinor,
          );
        }
      }),
      { numRuns: 200 },
    );
  });

  it("keeps the balance at the configured start whatever history precedes it", () => {
    // This is the entire point of back-anchoring: a 2025 row appearing makes
    // the ledger start earlier, and must NOT move the balance the user
    // configured for their opening month.
    fc.assert(
      fc.property(fc.array(transaction, { maxLength: 30 }), fc.integer({ min: -100_00, max: 100_00 }), (transactions, configuredOpening) => {
        const configuredStart: MonthKey = "2026-01";
        const today = "2026-12-31" as ISODate;
        const anchor = resolveLedgerAnchor(configuredStart, configuredOpening, transactions, [], today);
        const chain = buildLedger({
          openingBalanceMinor: anchor.openingBalanceMinor,
          startMonth: anchor.startMonth,
          endMonth: "2026-12",
          transactions,
          adjustments: [],
          today,
        });
        const january = chain.find((month) => month.month === configuredStart);
        // Either the anchor moved back and January still opens where the user
        // said it does, or there was no earlier data and nothing moved.
        expect(january?.openingMinor ?? configuredOpening).toBe(configuredOpening);
      }),
      { numRuns: 200 },
    );
  });

  it("agrees with the direct balance calculation over the anchored inputs", () => {
    // Two independent paths to today's balance: the chained ledger and a
    // single pass. `buildLedgerBundle` serves the first and falls back to the
    // second, so they must never disagree.
    //
    // The anchor is not optional here. `currentBalance` has no month window at
    // all — it sums every counting row — so the two agree only once
    // `resolveLedgerAnchor` has moved the start back to cover the earliest
    // data. Written without it, this property fails on a single row dated
    // before the configured start, which is how the ignored `startMonth`
    // argument on `currentBalance` was found and removed.
    fc.assert(
      fc.property(fc.array(transaction, { maxLength: 40 }), (transactions) => {
        const today = "2026-07-15" as ISODate;
        const anchor = resolveLedgerAnchor("2026-01", 1_000_00, transactions, [], today);
        const ledger = buildLedger({
          openingBalanceMinor: anchor.openingBalanceMinor,
          startMonth: anchor.startMonth,
          endMonth: "2026-12",
          transactions,
          adjustments: [],
          today,
        });
        const july = ledger.find((month) => month.month === monthKeyOf(today));
        expect(july?.closingMinor).toBe(currentBalance({
          openingBalanceMinor: anchor.openingBalanceMinor,
          transactions,
          adjustments: [],
          today,
        }));
      }),
      { numRuns: 200 },
    );
  });
});

describe("search result ordering", () => {
  const modes: TransactionSortMode[] = ["recent", "oldest", "highest", "lowest"];

  it("reorders the rows without losing or inventing one", () => {
    // A sort that drops a row hides money. Assert it is a permutation, in
    // every mode, for every input.
    fc.assert(
      fc.property(fc.array(transaction, { maxLength: 30 }), fc.constantFrom(...modes), (rows, mode) => {
        const sorted = sortTransactions(rows, mode);
        expect(sorted).toHaveLength(rows.length);
        expect([...sorted].map((row) => row.id).sort()).toEqual([...rows].map((row) => row.id).sort());
      }),
      { numRuns: 300 },
    );
  });

  it("is total and stable — equal rows never swap between runs", () => {
    // The comparator falls back to the id, so the order is fully determined.
    // Without that, two rows on the same date would shuffle on every render.
    fc.assert(
      fc.property(fc.array(transaction, { maxLength: 30 }), fc.constantFrom(...modes), (rows, mode) => {
        expect(sortTransactions(rows, mode).map((row) => row.id))
          .toEqual(sortTransactions([...rows].reverse(), mode).map((row) => row.id));
      }),
      { numRuns: 300 },
    );
  });
});

describe("month arithmetic", () => {
  it("moves back and forth to the same month", () => {
    fc.assert(
      fc.property(isoDate, fc.integer({ min: -60, max: 60 }), (date, offset) => {
        const month = monthKeyOf(date);
        expect(addMonthsToKey(addMonthsToKey(month, offset), -offset)).toBe(month);
      }),
      { numRuns: 500 },
    );
  });

  it("produces a contiguous, ordered, inclusive range", () => {
    fc.assert(
      fc.property(isoDate, fc.integer({ min: 0, max: 36 }), (date, span) => {
        const start = monthKeyOf(date);
        const end = addMonthsToKey(start, span);
        const range = monthRange(start, end);
        expect(range).toHaveLength(span + 1);
        expect(range[0]).toBe(start);
        expect(range.at(-1)).toBe(end);
        expect([...range]).toEqual([...range].sort());
        for (let index = 1; index < range.length; index += 1) {
          expect(range[index]).toBe(addMonthsToKey(range[index - 1] as MonthKey, 1));
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("tombstone generation", () => {
  it("never moves backwards", () => {
    // Sync merges compare generations. A version that can decrease lets a
    // resurrected row win against its own delete.
    fc.assert(
      fc.property(
        fc.record({ deletedAt: fc.option(fc.constant("2026-01-01T00:00:00.000Z"), { nil: null }), tombstoneVersion: fc.nat({ max: 50 }) }),
        fc.option(fc.constant("2026-02-01T00:00:00.000Z"), { nil: null }),
        fc.nat({ max: 50 }),
        (existing, requestedDeletedAt, requestedVersion) => {
          const next = resolveTombstoneVersion(existing, requestedDeletedAt, requestedVersion);
          expect(next).toBeGreaterThanOrEqual(existing.tombstoneVersion);
          expect(next).toBeGreaterThanOrEqual(requestedVersion);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("advances exactly one generation when a live row is deleted", () => {
    fc.assert(
      fc.property(fc.nat({ max: 50 }), fc.nat({ max: 50 }), (existingVersion, requestedVersion) => {
        const next = resolveTombstoneVersion(
          { deletedAt: null, tombstoneVersion: existingVersion },
          "2026-02-01T00:00:00.000Z",
          requestedVersion,
        );
        expect(next).toBe(Math.max(existingVersion, requestedVersion) + 1);
      }),
      { numRuns: 300 },
    );
  });
});
