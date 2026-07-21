/**
 * An undo that fails must not look like one that worked.
 *
 * Every undo callback was `() => void restoreRow(...)`. The snackbar dismissed
 * on tap regardless, so a rejected restore left the row deleted with no
 * message at all — the "misleading success" class. `void` silences the lint,
 * it does not own the rejection.
 */

import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { runUndo } from "../src/domain/undo-outcome";

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

/**
 * Structural guard: every undo callback must be owned. These screens import
 * react-native and cannot be loaded by vitest, so the wiring is asserted from
 * source — the same approach `tests/privacy.test.ts` uses for `session.ts`.
 */
describe("undo callbacks are owned everywhere", () => {
  const files = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
  });

  it("makes the shared snackbar await and report every discovered undo", () => {
    const callers = files(join(process.cwd(), "src"))
      .filter((file) => readFileSync(file, "utf8").includes("undo.show("));
    expect(callers.length).toBeGreaterThanOrEqual(10);
    const primitive = readFileSync(join(process.cwd(), "src/ui/undo.tsx"), "utf8");
    expect(primitive).toContain("await runUndo");
    expect(primitive).toContain("tr.errors.undoFailed");
    for (const caller of callers) {
      expect(readFileSync(caller, "utf8"), caller).not.toMatch(/undo\.show\([^;]+\(\) => void /s);
    }
  });

  it("keeps the skip flow owned as well", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const text = readFileSync(join(process.cwd(), "src/app/reconciliation.tsx"), "utf8");
    // Was: onPress={() => { void skipExpected(...); scheduleSync(...); }}
    expect(text).not.toMatch(/void skipExpected\(/);
    expect(text).toMatch(/const skip = async/);
    expect(text).toContain("operationGuard.run");
    expect(text).toContain("unskipExpected");
  });
});
