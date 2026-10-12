/** An undo that fails must not look like one that worked: `void` silences the lint, it does not own the rejection. */

import { describe, expect, it, vi } from "vitest";

import { runUndo } from "../../src/domain/undo-outcome";

describe("runUndo", () => {
  it("reports success when the restore resolves", async () => {
    const action = vi.fn(async () => "restored");
    await expect(runUndo(action)).resolves.toEqual({ ok: true });
    expect(action).toHaveBeenCalledOnce();
  });

  it("CAPTURES a rejection instead of letting it float away", async () => {
    const boom = new Error("write failed");
    const outcome = await runUndo(async () => {
      throw boom;
    });
    expect(outcome).toEqual({ ok: false, error: boom });
  });

  it("never throws, so a snackbar callback cannot produce an unhandled rejection", async () => {
    await expect(runUndo(async () => {
      throw new Error("boom");
    })).resolves.toBeDefined();
    await expect(runUndo(() => Promise.reject(new Error("boom")))).resolves.toMatchObject({ ok: false });
  });

  it("preserves a non-Error rejection value for the caller to classify", async () => {
    expect(await runUndo(async () => {
      throw "string failure";
    })).toEqual({ ok: false, error: "string failure" });
  });

  it("awaits a chained restore, so a late failure is still reported", async () => {
    const outcome = await runUndo(() =>
      Promise.resolve().then(() => {
        throw new Error("late");
      }));
    expect(outcome.ok).toBe(false);
  });
});
