import { describe, expect, it } from "vitest";
import {
  deriveStartMonth,
  generateSchedule,
  installmentDisplayTitle,
  isValidInstallmentCount,
  MAX_INSTALLMENT_COUNT,
  planAmounts,
  planDraft,
  planForSighting,
  planProgress,
  type PlanSighting,
} from "../src/domain/installments";
import { installmentShareRange, splitIntoInstallments } from "../src/domain/money";
import type { InstallmentPlanLike } from "../src/domain/types";

function plan(overrides: Partial<InstallmentPlanLike>): InstallmentPlanLike {
  return {
    id: "plan-1",
    kind: "card_installment",
    startMonth: "2026-07",
    installmentCount: 6,
    totalAmountMinor: 600_00,
    monthlyAmountMinor: null,
    currency: "TRY",
    dueDay: null,
    personIsSelf: true,
    ...overrides,
  };
}

describe("splitIntoInstallments", () => {
  it("splits evenly when divisible", () => {
    expect(splitIntoInstallments(600_00, 6)).toEqual([100_00, 100_00, 100_00, 100_00, 100_00, 100_00]);
  });

  it("rounds every instalment to the nearest kuruş and lets the FIRST absorb the rest", () => {
    // 1000,00 / 3 = 333,33 → 333,34 + 333,33 + 333,33
    expect(splitIntoInstallments(1000_00, 3)).toEqual([33334, 33333, 33333]);
    // Shapes read off real statements: the regular share rounds UP here, so
    // the first instalment is the smaller one.
    expect(splitIntoInstallments(1154_98, 6)).toEqual([19248, 19250, 19250, 19250, 19250, 19250]);
    expect(splitIntoInstallments(875_75, 6)).toEqual([14595, 14596, 14596, 14596, 14596, 14596]);
  });

  it("falls back to truncation when rounding would leave the first instalment nothing", () => {
    expect(splitIntoInstallments(5, 6)).toEqual([5, 0, 0, 0, 0, 0]);
    expect(splitIntoInstallments(1, 3)).toEqual([1, 0, 0]);
  });

  it("preserves the exact total", () => {
    for (const [total, count] of [[999_99, 7], [123_45, 12], [1, 3], [5, 6], [1154_98, 6], [-875_75, 6]] as const) {
      const shares = splitIntoInstallments(total, count);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("rejects non-integer amounts and invalid counts", () => {
    expect(() => splitIntoInstallments(100.5, 3)).toThrow();
    expect(() => splitIntoInstallments(100_00, 0)).toThrow();
  });
});

/**
 * What the two plan screens show BEFORE the schedule exists.
 *
 * Both used to divide the total themselves with `Math.trunc`, so a preview
 * and the schedule it previewed were different numbers: "3 taksit x ₺333,33"
 * for a ₺1.000,00 purchase adds up to ₺999,99, and the row the app then wrote
 * for the last month was ₺333,34. One split now answers both.
 */
describe("installmentShareRange", () => {
  it("reports the same two figures the schedule will use", () => {
    for (const [total, count] of [[1000_00, 3], [999_99, 7], [123_45, 12], [1, 3], [600_00, 6]] as const) {
      const shares = splitIntoInstallments(total, count);
      expect(installmentShareRange(total, count), `${total}/${count}`).toEqual({
        first: shares[0],
        rest: shares[shares.length - 1],
      });
    }
  });

  it("names a different first instalment exactly when the total does not divide evenly", () => {
    expect(installmentShareRange(1000_00, 3)).toEqual({ first: 33334, rest: 33333 });
    // Divisible: both agree, and the screen says one figure rather than two.
    expect(installmentShareRange(600_00, 6)).toEqual({ first: 100_00, rest: 100_00 });
  });

  it("never rounds the purchase away", () => {
    // The whole point: first + rest x (count - 1) must be the amount typed.
    for (const [total, count] of [[1000_00, 3], [999_99, 7], [55_55, 4]] as const) {
      const { first, rest } = installmentShareRange(total, count)!;
      expect(first + rest * (count - 1), `${total}/${count}`).toBe(total);
    }
  });

  /** A half-typed count must not throw inside a render. */
  it("answers null for a plan that could not exist", () => {
    for (const count of [0, -1, 1.5, Number.NaN]) {
      expect(installmentShareRange(1000_00, count), String(count)).toBeNull();
    }
    expect(installmentShareRange(100.5, 3)).toBeNull();
    // One instalment is a real plan, not an invalid one.
    expect(installmentShareRange(1000_00, 1)).toEqual({ first: 1000_00, rest: 1000_00 });
  });
});

describe("installmentDisplayTitle", () => {
  it("prefers the plan title, then the first meaningful note part", () => {
    expect(installmentDisplayTitle("Telefon", "Eski not", "Taksitli Harcama")).toBe("Telefon");
    expect(installmentDisplayTitle("  ", "  Laptop taksiti  \nGaranti bilgisi", "Taksitli Harcama")).toBe("Laptop taksiti");
    expect(installmentDisplayTitle(null, "Koltuk; teslimat notu", "Taksitli Harcama")).toBe("Koltuk");
  });

  it("uses a safe generic title when legacy data has no meaningful text", () => {
    expect(installmentDisplayTitle(null, "  \n  ", "Taksitli Harcama")).toBe("Taksitli Harcama");
  });
});

describe("installment count bounds (DoS guard)", () => {
  it("accepts sane counts and rejects out-of-range ones", () => {
    expect(isValidInstallmentCount(1)).toBe(true);
    expect(isValidInstallmentCount(360)).toBe(true);
    expect(isValidInstallmentCount(MAX_INSTALLMENT_COUNT)).toBe(true);
    expect(isValidInstallmentCount(0)).toBe(false);
    expect(isValidInstallmentCount(MAX_INSTALLMENT_COUNT + 1)).toBe(false);
    expect(isValidInstallmentCount(9999)).toBe(false);
    expect(isValidInstallmentCount(2.5)).toBe(false);
  });

  // Regression: an unbounded count (e.g. 9999) would materialize thousands of
  // rows in one transaction and freeze the UI. The engine now refuses it.
  it("planAmounts throws on an absurd count instead of allocating it", () => {
    expect(() => planAmounts({ totalAmountMinor: 600_00, monthlyAmountMinor: null, installmentCount: 9999 })).toThrow();
    expect(() => generateSchedule(plan({ installmentCount: 100_000 }), "2026-07-05")).toThrow();
  });
});

describe("generateSchedule", () => {
  it("places installments in consecutive calendar months", () => {
    const items = generateSchedule(plan({}), "2026-07-05");
    expect(items.map((i) => i.month)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
    expect(items.map((i) => i.installmentNo)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("crosses year boundaries", () => {
    const items = generateSchedule(plan({ startMonth: "2026-11", installmentCount: 4, totalAmountMinor: 400_00 }), "2026-07-05");
    expect(items.map((i) => i.month)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("realizes exactly the paid count for a mid-progress plan (4/6 paid)", () => {
    // Due day (1st) has already passed this month, so the next unpaid
    // installment belongs to next month — keeping the realized count at 4.
    const startMonth = deriveStartMonth(4, "2026-07", 1, "2026-07-05");
    expect(startMonth).toBe("2026-04");
    const items = generateSchedule(plan({ startMonth }), "2026-07-05");
    expect(items.map((i) => i.status)).toEqual([
      "realized", "realized", "realized", "realized", // Apr–Jul (4 paid)
      "pending", "pending", // Aug, Sep
    ]);
  });

  it("keeps this month's installment pending when its due day is still ahead", () => {
    // Due day (20th) is later this month, so the 4th (current-month) installment
    // is the next unpaid one and stays pending — still exactly 4 realized.
    const startMonth = deriveStartMonth(4, "2026-07", 20, "2026-07-05");
    expect(startMonth).toBe("2026-03");
    const items = generateSchedule(plan({ startMonth, dueDay: 20 }), "2026-07-05");
    expect(items.map((i) => i.status)).toEqual([
      "realized", "realized", "realized", "realized", // Mar–Jun
      "pending", "pending", // Jul (20th > 5th), Aug
    ]);
  });

  it("respects dueDay and clamps it into short months", () => {
    const items = generateSchedule(
      plan({ startMonth: "2026-01", installmentCount: 3, totalAmountMinor: 300_00, dueDay: 31 }),
      "2025-12-01",
    );
    expect(items.map((i) => i.effectiveDate)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(items.every((i) => i.status === "pending")).toBe(true);
  });

  it("uses fixed monthly amounts for loans", () => {
    const items = generateSchedule(
      plan({ kind: "loan", totalAmountMinor: null, monthlyAmountMinor: 2367213, installmentCount: 3 }),
      "2026-07-05",
    );
    expect(items.map((i) => i.amountMinor)).toEqual([2367213, 2367213, 2367213]);
  });
});

describe("planProgress", () => {
  it("reports paid/total, remaining amount and end month", () => {
    const items = generateSchedule(plan({ startMonth: deriveStartMonth(4, "2026-07") }), "2026-07-05");
    const progress = planProgress(items);
    expect(progress).toMatchObject({ paid: 5, total: 6, remaining: 1, endMonth: "2026-08" });
    expect(progress.remainingMinor).toBe(100_00);
    expect(progress.monthlyMinor).toBe(100_00);
  });
});

/**
 * One purchase reaches the ledger from a form, a workbook and a statement, and
 * each names it differently. What they agree on is the schedule.
 */
describe("planForSighting", () => {
  // 1.000,00 over 3 bills 333,34 first and 333,33 after.
  const whole = { ...plan({ startMonth: "2026-06", installmentCount: 3, totalAmountMinor: 1_000_00 }), paymentSourceId: "card" };
  const sighting = (over: Partial<PlanSighting> = {}): PlanSighting => ({
    month: "2026-07",
    amountMinor: 333_33,
    endMonth: "2026-08",
    startMonth: "2026-06",
    paymentSourceId: "card",
    ...over,
  });

  it("finds a plan by its schedule and says what it bills that month", () => {
    expect(planForSighting(sighting(), [whole])).toEqual({ plan: whole, shareMinor: 333_33 });
    expect(planForSighting(sighting({ month: "2026-06", amountMinor: 333_34 }), [whole])?.shareMinor).toBe(333_34);
  });

  it("finds it from the end month alone when the source prints only what remains", () => {
    expect(planForSighting(sighting({ startMonth: null }), [whole])?.plan).toBe(whole);
    expect(planForSighting(sighting({ startMonth: "2026-05" }), [whole])).toBeNull();
    expect(planForSighting(sighting({ startMonth: null, endMonth: "2026-09" }), [whole])).toBeNull();
  });

  it("is not a month the plan does not bill", () => {
    expect(planForSighting(sighting({ startMonth: null, month: "2026-05" }), [whole])).toBeNull();
    expect(planForSighting(sighting({ startMonth: null, month: "2026-09", endMonth: "2026-08" }), [whole])).toBeNull();
  });

  it("allows fewer kuruş than the count, the most a split moves one instalment", () => {
    expect(planForSighting(sighting({ amountMinor: 333_33 + 2 }), [whole])?.plan).toBe(whole);
    expect(planForSighting(sighting({ amountMinor: 333_33 - 2 }), [whole])?.plan).toBe(whole);
    expect(planForSighting(sighting({ amountMinor: 333_33 + 3 }), [whole])).toBeNull();
    expect(planForSighting(sighting({ amountMinor: 333_33 - 3 }), [whole])).toBeNull();
  });

  it("reads a monthly plan's own figure", () => {
    const loan = { ...whole, totalAmountMinor: null, monthlyAmountMinor: 500_00 };
    expect(planForSighting(sighting({ amountMinor: 500_00 }), [loan])).toEqual({ plan: loan, shareMinor: 500_00 });
  });

  it("keeps plans on two different cards apart, and matches either side left without one", () => {
    expect(planForSighting(sighting({ paymentSourceId: "other" }), [whole])).toBeNull();
    expect(planForSighting(sighting({ paymentSourceId: null }), [whole])?.plan).toBe(whole);
    expect(planForSighting(sighting(), [{ ...whole, paymentSourceId: null }])).not.toBeNull();
  });

  /**
   * A bank fixes a foreign purchase's lira at posting; a plan restates it with
   * the rate. So a foreign plan is met by its card and schedule, and by what
   * its instalment for the month bills in lira within a quarter.
   */
  it("meets a foreign-currency plan on its own card by the lira its instalment bills", () => {
    const dollars = { ...whole, currency: "USD", totalAmountMinor: 300_00, billedTryMinor: 300_00 };
    expect(planForSighting(sighting({ amountMinor: 375_00 }), [dollars])).toEqual({ plan: dollars, shareMinor: 300_00 });
    expect(planForSighting(sighting({ amountMinor: 375_01 }), [dollars])).toBeNull();
    expect(planForSighting(sighting({ amountMinor: 225_00 }), [dollars])?.plan).toBe(dollars);
    expect(planForSighting(sighting({ amountMinor: 224_99 }), [dollars])).toBeNull();
    expect(planForSighting(sighting({ paymentSourceId: null }), [dollars])).toBeNull();
    expect(planForSighting(sighting(), [{ ...dollars, paymentSourceId: null }])).toBeNull();
    expect(planForSighting(sighting(), [{ ...dollars, billedTryMinor: null }])).toBeNull();
    expect(planForSighting(sighting({ paymentSourceId: null }), [{ ...dollars, paymentSourceId: null }]), "neither side names a card").toBeNull();
    // Only the months the plan bills: a source that prints what remains says nothing of where it began.
    expect(planForSighting(sighting({ startMonth: null, month: "2026-05", amountMinor: 300_00 }), [dollars])).toBeNull();
    expect(planForSighting(sighting({ startMonth: null, month: "2026-09", amountMinor: 300_00 }), [dollars])).toBeNull();
    expect(planForSighting(sighting({ startMonth: null, month: "2026-06", amountMinor: 300_00 }), [dollars])?.plan).toBe(dollars);
    expect(planForSighting(sighting({ startMonth: null, month: "2026-08", amountMinor: 300_00 }), [dollars])?.plan).toBe(dollars);
  });

  it("leaves a plan an earlier line already took, so two identical purchases stay two", () => {
    const twin = { ...whole, id: "plan-2" };
    expect(planForSighting(sighting(), [whole, twin], new Set(["plan-1"]))?.plan).toBe(twin);
    expect(planForSighting(sighting(), [whole], new Set(["plan-1"]))).toBeNull();
  });

  it("passes over a stored plan it could not expand instead of throwing", () => {
    const corrupt = [
      { ...whole, id: "no-amount", totalAmountMinor: null, monthlyAmountMinor: null },
      // Ends in the sighted month, so only the count check stands between it and a throw.
      { ...whole, id: "too-long", startMonth: "1976-08", installmentCount: MAX_INSTALLMENT_COUNT + 1 },
    ];
    expect(planForSighting(sighting({ startMonth: null }), [...corrupt, whole])?.plan).toBe(whole);
  });
});

/** What the plan form can save, and where the plan it saves starts. */
describe("planDraft", () => {
  const TODAY = "2026-08-13";
  const card = { type: "credit_card", statementDay: 25, dueDay: 5 };
  const draft = (over: Partial<Parameters<typeof planDraft>[0]> = {}) => planDraft({
    kind: "card_installment", title: "Telefon", amountMinor: 600_00, countText: "6", paidText: null, storedPaid: 0,
    startChoice: null, existingStartMonth: null, card, dueDayText: "", today: TODAY, ...over,
  });

  it("starts a new card plan on the statement a purchase made today joins", () => {
    expect(draft()).toMatchObject({ valid: true, count: 6, paid: 0, startMonth: "2026-09", resolvedStart: "2026-09", paidChanged: false, reschedule: false, dueDay: 5 });
    expect(draft({ card: { ...card, statementDay: null } })).toMatchObject({ valid: false, cardSourceValid: false, startMonth: "2026-08" });
    expect(draft({ kind: "loan", card: null })).toMatchObject({ valid: true, startMonth: "2026-08", dueDay: null });
  });

  it("follows the month the owner picked", () => {
    expect(draft({ startChoice: "2026-05" })).toMatchObject({ startMonth: "2026-05", resolvedStart: "2026-05" });
    expect(draft({ startChoice: "2026-05", paidText: "0" }), "nothing paid moves nothing").toMatchObject({ paidChanged: false, resolvedStart: "2026-05" });
  });

  /** "Already paid N" places the start; on an edit only once it is corrected. */
  it("moves the start by what was already paid", () => {
    expect(draft({ paidText: "2" })).toMatchObject({ paidChanged: true, resolvedStart: "2026-07" });
    const edit = { existingStartMonth: "2026-03" as const, startChoice: "2026-03" as const, storedPaid: 5 };
    expect(draft({ ...edit })).toMatchObject({ paid: 5, paidChanged: false, resolvedStart: "2026-03", reschedule: false });
    expect(draft({ ...edit, paidText: "5" })).toMatchObject({ paidChanged: false, reschedule: false });
    expect(draft({ ...edit, paidText: "2" })).toMatchObject({ paidChanged: true, resolvedStart: "2026-07", reschedule: true });
  });

  it("takes a loan's own day, else its account's", () => {
    expect(draft({ kind: "loan", dueDayText: " 17 " })).toMatchObject({ dueDay: 17, dueDayValid: true, valid: true });
    expect(draft({ kind: "loan", dueDayText: "" })).toMatchObject({ dueDay: 5 });
    expect(draft({ kind: "loan", dueDayText: "   " }), "spaces are no day").toMatchObject({ dueDay: 5, dueDayValid: true, valid: true });
    for (const text of ["0", "32", "7.5", "x"]) expect(draft({ kind: "loan", dueDayText: text }), text).toMatchObject({ dueDayValid: false, valid: false });
    expect(draft({ dueDayText: "40" })).toMatchObject({ dueDayValid: true, dueDay: 5 });
  });

  it("refuses what cannot be saved", () => {
    for (const over of [
      { title: "  " },
      { amountMinor: null },
      { amountMinor: 0 },
      { countText: "0" },
      { countText: "601" },
      { paidText: "-1" },
      { paidText: "7" },
      { paidText: "1.5" },
      { card: { ...card, type: "bank" } },
      { card: { ...card, dueDay: 32 } },
      { card: null },
    ]) expect(draft(over), JSON.stringify(over)).toMatchObject({ valid: false });
    expect(draft({ paidText: "6" })).toMatchObject({ valid: true });
  });
});
