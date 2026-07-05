import { describe, expect, it } from "vitest";
import { deriveStartMonth, generateSchedule, planProgress } from "../src/domain/installments";
import { splitIntoInstallments } from "../src/domain/money";
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

  it("sends the kuruş remainder to the LAST installment", () => {
    // 1000,00 / 3 = 333,33 + 333,33 + 333,34
    expect(splitIntoInstallments(1000_00, 3)).toEqual([33333, 33333, 33334]);
  });

  it("preserves the exact total", () => {
    for (const [total, count] of [[999_99, 7], [123_45, 12], [1, 3]] as const) {
      const shares = splitIntoInstallments(total, count);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("rejects non-integer amounts and invalid counts", () => {
    expect(() => splitIntoInstallments(100.5, 3)).toThrow();
    expect(() => splitIntoInstallments(100_00, 0)).toThrow();
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

  it("auto-realizes past installments for a mid-progress plan (4/6 paid)", () => {
    const startMonth = deriveStartMonth(4, "2026-07");
    expect(startMonth).toBe("2026-03");
    const items = generateSchedule(plan({ startMonth }), "2026-07-05");
    expect(items.map((i) => i.status)).toEqual([
      "realized", "realized", "realized", "realized", // Mar–Jun
      "realized", // Jul 1 <= Jul 5 → this month's already effective
      "pending", // Aug
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
