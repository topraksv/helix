import { describe, expect, it } from "vitest";
import { parseBalanceDeclaration, balanceDeclarationDrift, driftCandidates } from "../src/domain/balance-declaration";
import { tx } from "./helpers";
import { classifyRootRoute, resolveRootGuard } from "../src/domain/app-guard";
import { normalizeReminderDays, uniqueNotifications } from "../src/domain/notifications";
import { remapDraftOwnerIndex } from "../src/domain/onboarding";
import { categoryTableEntryType } from "../src/domain/transactions";
import { createSerialQueue } from "../src/domain/serial-queue";

describe("mutation-sensitive small domain contracts", () => {
  it("validates declarations by exact value type and computes only real drift", () => {
    expect(parseBalanceDeclaration(null)).toBeNull();
    expect(parseBalanceDeclaration([])).toBeNull();
    expect(parseBalanceDeclaration({ minor: Number.NaN, at: "2026-07-18" })).toBeNull();
    expect(parseBalanceDeclaration({ minor: 100, at: "" })).toBeNull();
    expect(parseBalanceDeclaration({ minor: 100, at: "2026-07-18" })).toEqual({ minor: 100, at: "2026-07-18" });
    expect(balanceDeclarationDrift(null, 100)).toBeNull();
    expect(balanceDeclarationDrift({ minor: 100, at: "2026-07-18" }, null)).toBeNull();
    expect(balanceDeclarationDrift({ minor: 100, at: "2026-07-18" }, 100)).toBeNull();
    expect(balanceDeclarationDrift({ minor: 100, at: "2026-07-18" }, 80)).toBe(-20);
  });

  /**
   * Drift said how far off the ledger was and nothing about why.
   *
   * The one thing the app knows that a person cannot hold in their head is
   * which rows are still unconfirmed. A row dated in the past and left pending
   * does not reach the balance — `countsTowardBalance` requires `realized` —
   * so if that money really moved, the table is wrong by exactly its amount.
   * These are offered as candidates, never as a finding: only the owner knows
   * whether a row happened.
   */
  it("offers the unconfirmed rows that would move the ledger toward the declaration", () => {
    const today = "2026-07-18" as const;
    const rows = [
      tx({ id: "big-expense", type: "expense", amountTryMinor: 900_00, effectiveDate: "2026-07-10", status: "pending" }),
      tx({ id: "small-expense", type: "expense", amountTryMinor: 100_00, effectiveDate: "2026-07-12", status: "pending" }),
      tx({ id: "income", type: "income", amountTryMinor: 500_00, effectiveDate: "2026-07-11", status: "pending" }),
      tx({ id: "future", type: "expense", amountTryMinor: 700_00, effectiveDate: "2026-07-25", status: "pending" }),
      tx({ id: "already-realized", type: "expense", amountTryMinor: 800_00, effectiveDate: "2026-07-09" }),
    ];

    // The table reads HIGHER than the owner said, so only money leaving can
    // explain it: the two pending expenses, largest first.
    expect(driftCandidates(1_000_00, rows, today).map((c) => c.id)).toEqual(["big-expense", "small-expense"]);
    expect(driftCandidates(1_000_00, rows, today)[0]).toEqual({
      id: "big-expense", effectMinor: -900_00, date: "2026-07-10",
    });

    // The other direction asks the opposite question and gets the other row.
    expect(driftCandidates(-1_000_00, rows, today).map((c) => c.id)).toEqual(["income"]);

    // Nothing to explain, nothing offered.
    expect(driftCandidates(0, rows, today)).toEqual([]);
  });

  /**
   * Today's own row is a candidate; tomorrow's is not.
   *
   * The boundary is the whole rule: a row dated today is money that may
   * already have moved and has not been confirmed, which is exactly what the
   * list is for. One dated tomorrow cannot have moved yet, so offering it
   * would send the owner to check something that is not late.
   */
  it("includes a row dated today and stops at tomorrow", () => {
    const today = "2026-07-18" as const;
    const rows = [
      tx({ id: "due-today", type: "expense", amountTryMinor: 700_00, effectiveDate: today, status: "pending" }),
      tx({ id: "due-tomorrow", type: "expense", amountTryMinor: 800_00, effectiveDate: "2026-07-19", status: "pending" }),
    ];
    expect(driftCandidates(1_000_00, rows, today).map((c) => c.id)).toEqual(["due-today"]);
  });

  it("caps how many candidates it offers", () => {
    const rows = Array.from({ length: 9 }, (_, index) =>
      tx({ id: `p${index}`, type: "expense", amountTryMinor: (index + 1) * 100, effectiveDate: "2026-07-10", status: "pending" }));
    expect(driftCandidates(10_000_00, rows, "2026-07-18")).toHaveLength(5);
    expect(driftCandidates(10_000_00, rows, "2026-07-18", 2).map((c) => c.id)).toEqual(["p8", "p7"]);
  });

  it("pins the route guard's protected/setup-helper distinction and redirects", () => {
    expect(classifyRootRoute(["(auth)", "reset-password"])).toBe("recovery");
    expect(classifyRootRoute(["(auth)", "other"])).toBe("auth");
    expect(classifyRootRoute(["other", "reset-password"])).toBe("protected");
    const base = { ready: true, locked: false, userId: "u", onboarded: true, frozen: false, awaitingFirstPull: false } as const;
    expect(resolveRootGuard({ ...base, route: "protected" })).toEqual({ view: "stack", redirect: null });
    expect(resolveRootGuard({ ...base, route: "setup-helper" })).toEqual({ view: "stack", redirect: null });
    expect(resolveRootGuard({ ...base, route: "root" })).toEqual({ view: "wait", redirect: "/(tabs)" });
  });

  it("normalizes reminders only for finite integers and de-duplicates by every content field", () => {
    expect(normalizeReminderDays(0, 30)).toBe(0);
    expect(normalizeReminderDays(30, 30)).toBe(30);
    expect(normalizeReminderDays(Number.NaN, 30)).toBe(3);
    expect(normalizeReminderDays(1.5, 30)).toBe(3);
    expect(normalizeReminderDays("1", 30)).toBe(3);
    expect(uniqueNotifications([
      { date: "d", title: "t", body: "b" },
      { date: "d", title: "t", body: "b" },
      { date: "d2", title: "t", body: "b" },
      { date: "d", title: "t2", body: "b" },
      { date: "d", title: "t", body: "b2" },
    ])).toEqual([
      { date: "d", title: "t", body: "b" },
      { date: "d2", title: "t", body: "b" },
      { date: "d", title: "t2", body: "b" },
      { date: "d", title: "t", body: "b2" },
    ]);
  });

  it("remaps owner indices only at and after the removed person", () => {
    expect(remapDraftOwnerIndex(2, 2)).toBe(0);
    expect(remapDraftOwnerIndex(3, 2)).toBe(2);
    expect(remapDraftOwnerIndex(1, 2)).toBe(1);
  });

  it("classifies transfer columns only for expense categories", () => {
    expect(categoryTableEntryType({ kind: "expense", isTransfer: true })).toBe("transfer");
    expect(categoryTableEntryType({ kind: "income", isTransfer: true })).toBe("income");
  });

  it("keeps a third same-key request behind the still-running second request", async () => {
    const queue = createSerialQueue<void>();
    const starts: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    const first = queue("user", async () => {
      starts.push("first");
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
    });
    const second = queue("user", async () => {
      starts.push("second");
      await new Promise<void>((resolve) => { releaseSecond = resolve; });
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(starts).toEqual(["first"]);
    releaseFirst?.();
    await first;
    await Promise.resolve();
    const third = queue("user", async () => { starts.push("third"); });
    await Promise.resolve();
    expect(starts).toEqual(["first", "second"]);
    releaseSecond?.();
    await Promise.all([second, third]);
    expect(starts).toEqual(["first", "second", "third"]);
  });
});
