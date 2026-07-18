import { describe, expect, it } from "vitest";
import { generateExpected } from "../src/domain/expected";
import { dayIntervalDatesInRange } from "../src/domain/recurrence";

describe("weekly recurring income", () => {
  it("walks calendar dates by 7/14 days across month boundaries", () => {
    expect(dayIntervalDatesInRange("2026-01-28", 7, "2026-02-01", "2026-02-28")).toEqual([
      "2026-02-04", "2026-02-11", "2026-02-18", "2026-02-25",
    ]);
    expect(dayIntervalDatesInRange("2026-02-20", 14, "2026-02-20", "2026-03-31")).toEqual([
      "2026-02-20", "2026-03-06", "2026-03-20",
    ]);
  });

  it("generates weekly expecteds idempotently and requires an anchor", () => {
    const income = {
      id: "weekly", name: "Vardiya", defaultAmountMinor: 100_00, currency: "TRY", payDay: 18,
      recurrence: "weekly" as const, anchorDate: "2026-07-18", isActive: true, personIsSelf: true,
    };
    const first = generateExpected([], [income], [], "2026-07-18", 1);
    expect(first.map((draft) => draft.dueDate)).toEqual([
      "2026-07-18", "2026-07-25", "2026-08-01", "2026-08-08", "2026-08-15", "2026-08-22", "2026-08-29",
    ]);
    expect(generateExpected([], [income], first.map((draft) => ({ ...draft, id: draft.dueDate, status: "pending" as const })), "2026-07-18", 1)).toEqual([]);
    expect(generateExpected([], [{ ...income, anchorDate: null }], [], "2026-07-18", 1)).toEqual([]);
  });
});
