/**
 * What a save confirmation is allowed to claim.
 *
 * The figures here are the ones that decide whether the owner goes and checks
 * the ledger, so each is pinned against the same three conditions the balance
 * engine itself applies.
 */
import { describe, expect, it } from "vitest";
import { buildSaveSummary, landsInAnotherMonth, saveEffect, type SavedTransaction } from "../src/domain/save-summary";
import { countsTowardBalance } from "../src/domain/balance";
import type { TxLike } from "../src/domain/types";

const TODAY = "2026-08-18";
const saved = (over: Partial<SavedTransaction> = {}): SavedTransaction => ({
  type: "expense",
  amountTryMinor: 250_00,
  effectiveDate: TODAY,
  status: "realized",
  personIsSelf: true,
  ...over,
});

describe("what a saved row does to the two figures", () => {
  it("moves today's balance for a realized self row", () => {
    expect(saveEffect(saved(), TODAY)).toEqual({ balanceMinor: -250_00, projectedMinor: -250_00, forecastOnly: false });
  });

  it("raises the balance for income", () => {
    expect(saveEffect(saved({ type: "income" }), TODAY).balanceMinor).toBe(250_00);
  });

  /** A transfer is money that has left the spendable balance, like an expense. */
  it("treats a transfer as leaving the balance", () => {
    expect(saveEffect(saved({ type: "transfer" }), TODAY).balanceMinor).toBe(-250_00);
  });

  it("touches only the forecast for a pending row", () => {
    expect(saveEffect(saved({ status: "pending" }), TODAY))
      .toEqual({ balanceMinor: 0, projectedMinor: -250_00, forecastOnly: true });
  });

  it("touches only the forecast for a future row", () => {
    expect(saveEffect(saved({ effectiveDate: "2026-09-01" }), TODAY))
      .toEqual({ balanceMinor: 0, projectedMinor: -250_00, forecastOnly: true });
  });

  /** A watched person's row is somebody else's money and moves neither figure. */
  it("moves nothing for a row that is not the owner's", () => {
    expect(saveEffect(saved({ personIsSelf: false }), TODAY))
      .toEqual({ balanceMinor: 0, projectedMinor: 0, forecastOnly: false });
  });

  /**
   * The confirmation must never claim a balance change the ledger will not
   * make. Both derive from the same three conditions; this pins them together
   * so they cannot drift apart silently.
   */
  it("claims a balance change exactly when the balance engine counts the row", () => {
    const cases: SavedTransaction[] = [
      saved(),
      saved({ status: "pending" }),
      saved({ effectiveDate: "2099-01-01" }),
      saved({ personIsSelf: false }),
      saved({ effectiveDate: "2020-01-01" }),
      saved({ type: "income", status: "pending" }),
    ];
    for (const row of cases) {
      const tx: TxLike = {
        id: "t", type: row.type, amountTryMinor: row.amountTryMinor, effectiveDate: row.effectiveDate,
        status: row.status, categoryId: null, categoryKind: null, paymentSourceId: null,
        personIsSelf: row.personIsSelf, installmentPlanId: null, subscriptionId: null, isAggregate: false,
      };
      expect(saveEffect(row, TODAY).balanceMinor !== 0, JSON.stringify(row))
        .toBe(countsTowardBalance(tx, TODAY));
    }
  });
});

describe("where the row will be found", () => {
  /** A card purchase is filed under its statement month, not the day of sale. */
  it("reports a month the owner was not working in", () => {
    expect(landsInAnotherMonth("2026-09-10", "2026-08-18")).toBe(true);
    expect(landsInAnotherMonth("2026-08-31", "2026-08-01")).toBe(false);
  });

  it("names the other month only when there is one", () => {
    expect(buildSaveSummary({ kind: "created", saved: saved({ effectiveDate: "2026-09-10" }), today: TODAY, enteredFor: TODAY }).otherMonth)
      .toBe("2026-09");
    expect(buildSaveSummary({ kind: "created", saved: saved(), today: TODAY, enteredFor: TODAY }).otherMonth).toBeNull();
    // Nothing to compare against: say nothing rather than guess.
    expect(buildSaveSummary({ kind: "created", saved: saved(), today: TODAY }).otherMonth).toBeNull();
  });

  it("carries the kind and whether the action can be taken back", () => {
    expect(buildSaveSummary({ kind: "updated", saved: saved(), today: TODAY, undoable: false }))
      .toMatchObject({ kind: "updated", undoable: false });
    expect(buildSaveSummary({ kind: "created", saved: saved(), today: TODAY }).undoable).toBe(true);
  });
});
