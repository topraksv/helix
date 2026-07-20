/**
 * Maintenance concurrency contract.
 *
 * A module-level boolean used to guard this: `if (running) return;`. That made a
 * SKIPPED pass look exactly like a completed one, because the early return
 * resolved `Promise<void>` just like success. `reassignAndDeletePerson` awaits a
 * pass specifically to reconcile derived expected rows under the replacement
 * person's classification, so whenever the throttled lifecycle kick was
 * in flight that reconciliation silently never happened. The flag was also not
 * user-scoped, so one account's pass could swallow another account's request.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { createSerialQueue } from "../src/domain/serial-queue";

let runMaintenanceQueued: ReturnType<typeof createSerialQueue<void>>;

/** Let every queued microtask settle. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A controllable pass: resolves only when its deferred is released. */
function deferredPass() {
  const starts: string[] = [];
  const releases: (() => void)[] = [];
  const pass = (userId: string) =>
    new Promise<void>((resolve) => {
      starts.push(userId);
      releases.push(resolve);
    });
  return { pass, starts, releases };
}

describe("runMaintenanceQueued", () => {
  beforeEach(() => {
    runMaintenanceQueued = createSerialQueue<void>();
  });

  it("runs a single request immediately", async () => {
    const { pass, starts, releases } = deferredPass();
    const run = runMaintenanceQueued("u1", pass);
    await tick();
    expect(starts).toEqual(["u1"]);
    releases[0]?.();
    await expect(run).resolves.toBeUndefined();
  });

  it("never overlaps two passes for the same user", async () => {
    const { pass, starts, releases } = deferredPass();
    const first = runMaintenanceQueued("u1", pass);
    const second = runMaintenanceQueued("u1", pass);
    await tick();
    // The second must NOT have started while the first is unresolved.
    expect(starts).toEqual(["u1"]);
    releases[0]?.();
    await first;
    await tick();
    expect(starts).toEqual(["u1", "u1"]);
    releases[1]?.();
    await expect(second).resolves.toBeUndefined();
  });

  it("QUEUES a concurrent request instead of dropping it", async () => {
    // The regression: the boolean guard resolved the second call instantly
    // without ever running a pass, so an awaiting caller observed nothing.
    const { pass, starts, releases } = deferredPass();
    const first = runMaintenanceQueued("u1", pass);
    let secondSettled = false;
    const second = runMaintenanceQueued("u1", pass).then(() => {
      secondSettled = true;
    });
    await tick();
    expect(secondSettled).toBe(false);
    releases[0]?.();
    await first;
    await tick();
    // A real second pass exists and the caller is still waiting for it.
    expect(starts).toHaveLength(2);
    expect(secondSettled).toBe(false);
    releases[1]?.();
    await second;
    expect(secondSettled).toBe(true);
  });

  it("does not let one account block another", async () => {
    const { pass, starts, releases } = deferredPass();
    const a = runMaintenanceQueued("user-a", pass);
    const b = runMaintenanceQueued("user-b", pass);
    await tick();
    // Both start: the chain is per user, not global.
    expect(starts).toEqual(["user-a", "user-b"]);
    releases[0]?.();
    releases[1]?.();
    await Promise.all([a, b]);
  });

  it("propagates a rejection to its own caller", async () => {
    const boom = new Error("pass failed");
    await expect(runMaintenanceQueued("u1", async () => { throw boom; })).rejects.toBe(boom);
  });

  it("a failed pass does not wedge the chain or fail the next caller", async () => {
    await expect(runMaintenanceQueued("u1", async () => { throw new Error("boom"); })).rejects.toThrow();
    const ran: string[] = [];
    await runMaintenanceQueued("u1", async (userId: string) => { ran.push(userId); });
    expect(ran).toEqual(["u1"]);
  });

  it("a rejection while a successor is queued still runs the successor", async () => {
    let releaseFirst: (() => void) | undefined;
    let rejectFirst: ((error: Error) => void) | undefined;
    const ran: string[] = [];
    const first = runMaintenanceQueued("u1", () =>
      new Promise<void>((resolve, reject) => {
        releaseFirst = resolve;
        rejectFirst = reject;
      }));
    const second = runMaintenanceQueued("u1", async (userId: string) => { ran.push(userId); });
    await tick();
    expect(ran).toEqual([]);
    rejectFirst?.(new Error("boom"));
    await expect(first).rejects.toThrow();
    await second;
    expect(ran).toEqual(["u1"]);
    expect(releaseFirst).toBeDefined();
  });

  it("clears its tail so a later request starts a fresh chain", async () => {
    await runMaintenanceQueued("u1", async () => {});
    const { pass, starts, releases } = deferredPass();
    const later = runMaintenanceQueued("u1", pass);
    await tick();
    // Nothing pending from before, so this starts on the next microtask.
    expect(starts).toEqual(["u1"]);
    releases[0]?.();
    await later;
  });
});
