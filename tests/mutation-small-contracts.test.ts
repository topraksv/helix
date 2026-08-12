import { describe, expect, it } from "vitest";
import { parseBalanceDeclaration, balanceDeclarationDrift } from "../src/domain/balance-declaration";
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
