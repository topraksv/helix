import { describe, expect, it, vi } from "vitest";
import { createOperationGuard } from "../src/ui/operation-guard";
import { tr } from "../src/i18n/tr";

describe("operation guard", () => {
  it("starts only one operation in the same tick and releases after success", async () => {
    const guard = createOperationGuard();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const operation = vi.fn(async () => hold);

    const first = guard.run(operation);
    const second = await guard.run(operation);

    expect(second).toEqual({ started: false });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(guard.active).toBe(true);

    release();
    await first;
    expect(guard.active).toBe(false);

    const third = await guard.run(async () => "ok");
    expect(third).toEqual({ started: true, value: "ok" });
  });

  it("releases after failure", async () => {
    const guard = createOperationGuard();
    await expect(guard.run(async () => Promise.reject(new Error("failed")))).rejects.toThrow("failed");
    expect(guard.active).toBe(false);
  });
});

describe("operation progress language", () => {
  it("gives every account operation its own meaningful status", () => {
    const labels = [
      tr.operation.signingIn,
      tr.operation.creatingAccount,
      tr.operation.requestingReset,
      tr.auth.restoringData,
      tr.operation.signingOut,
      tr.auth.signOutLocalTitle,
      tr.operation.deletingAccount,
      tr.account.reactivatingBody,
    ];
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((label) => label.trim().length > 0)).toBe(true);
  });
});
