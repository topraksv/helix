import { describe, expect, it } from "vitest";
import {
  deriveStartMonth,
  generateSchedule,
  installmentDisplayTitle,
  isValidInstallmentCount,
  MAX_INSTALLMENT_COUNT,
  planAmounts,
  planProgress,
} from "../src/domain/installments";
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
