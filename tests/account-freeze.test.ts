import { describe, expect, it, vi } from "vitest";
import { performAccountFreeze, type AccountFreezeEffects } from "../src/auth/freeze";

function effects(overrides: Partial<AccountFreezeEffects> = {}) {
  const frozenWrites: boolean[] = [];
  const base: AccountFreezeEffects = {
    setFrozen: vi.fn(async (frozen: boolean) => void frozenWrites.push(frozen)),
    syncNow: vi.fn(async () => true),
    pendingOutboxCount: vi.fn(async () => 0),
    signOut: vi.fn(async () => null),
    scheduleSync: vi.fn(),
    requiresCloud: true,
    ...overrides,
  };
  return { deps: base, frozenWrites };
}

describe("account freeze lifecycle", () => {
  it("freezes and ends the session once the flag is confirmed on the server", async () => {
    const { deps, frozenWrites } = effects();
    await expect(performAccountFreeze(deps)).resolves.toEqual({ status: "frozen" });
    expect(frozenWrites).toEqual([true]);
    expect(deps.signOut).toHaveBeenCalledTimes(1);
  });

  it("flags a local-only workspace without demanding a cloud confirmation", async () => {
    const { deps, frozenWrites } = effects({ requiresCloud: false });
    await expect(performAccountFreeze(deps)).resolves.toEqual({ status: "local" });
    expect(frozenWrites).toEqual([true]);
    expect(deps.syncNow).not.toHaveBeenCalled();
    expect(deps.signOut).not.toHaveBeenCalled();
  });

  it("rolls the flag back when the push fails", async () => {
    const { deps, frozenWrites } = effects({ syncNow: vi.fn(async () => false) });
    await expect(performAccountFreeze(deps)).resolves.toEqual({
      status: "failed",
      reason: "sync",
      message: null,
      rolledBack: true,
    });
    expect(frozenWrites).toEqual([true, false]);
    expect(deps.signOut).not.toHaveBeenCalled();
  });

  it("refuses to freeze while rows are still queued locally", async () => {
    const { deps, frozenWrites } = effects({ pendingOutboxCount: vi.fn(async () => 3) });
    const outcome = await performAccountFreeze(deps);
    expect(outcome).toMatchObject({ status: "failed", reason: "sync", rolledBack: true });
    expect(frozenWrites).toEqual([true, false]);
    expect(deps.signOut).not.toHaveBeenCalled();
  });

  it("restores the account when the sign-out itself reports an error", async () => {
    const { deps, frozenWrites } = effects({ signOut: vi.fn(async () => "oturum süresi doldu") });
    await expect(performAccountFreeze(deps)).resolves.toEqual({
      status: "failed",
      reason: "sign-out",
      message: "oturum süresi doldu",
      rolledBack: true,
    });
    expect(frozenWrites).toEqual([true, false]);
  });

  // The defect that made the button look broken: a REJECTION rather than a
  // returned error escaped the screen entirely, so the account stayed frozen
  // with no message and the app opened locked on the next launch.
  it.each([
    ["network interruption during the push", { syncNow: vi.fn(async () => Promise.reject(new Error("network down"))) }],
    ["an unreadable outbox", { pendingOutboxCount: vi.fn(async () => Promise.reject(new Error("db gone"))) }],
    ["a thrown sign-out", { signOut: vi.fn(async () => Promise.reject(new Error("timeout"))) }],
  ])("never leaves the account frozen after %s", async (_label, override) => {
    const { deps, frozenWrites } = effects(override as Partial<AccountFreezeEffects>);
    const outcome = await performAccountFreeze(deps);
    expect(outcome).toMatchObject({ status: "failed", reason: "unexpected", rolledBack: true });
    expect(frozenWrites).toEqual([true, false]);
  });

  it("reports honestly when even the rollback cannot be written", async () => {
    const setFrozen = vi.fn(async (frozen: boolean) => {
      if (!frozen) throw new Error("storage unavailable");
    });
    const { deps } = effects({ setFrozen, syncNow: vi.fn(async () => false) });
    await expect(performAccountFreeze(deps)).resolves.toEqual({
      status: "failed",
      reason: "sync",
      message: null,
      rolledBack: false,
    });
  });

  it("fails closed when the very first write is refused", async () => {
    const setFrozen = vi.fn(async () => Promise.reject(new Error("rls denied")));
    const { deps } = effects({ setFrozen });
    const outcome = await performAccountFreeze(deps);
    expect(outcome).toMatchObject({ status: "failed", reason: "unexpected", rolledBack: false });
    expect(deps.syncNow).not.toHaveBeenCalled();
    expect(deps.signOut).not.toHaveBeenCalled();
  });
});
