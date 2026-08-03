import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
      tr.operation.localSigningOut,
      tr.auth.signOutLocalTitle,
      tr.operation.deletingAccount,
      tr.account.reactivatingBody,
    ];
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((label) => label.trim().length > 0)).toBe(true);
  });

  it("uses one shared caption without repeating a second waiting message", () => {
    const components = readFileSync(join(process.cwd(), "src/ui/components.tsx"), "utf8");
    const frozenGate = readFileSync(join(process.cwd(), "src/ui/frozen-gate.tsx"), "utf8");
    const rootLayout = readFileSync(join(process.cwd(), "src/app/_layout.tsx"), "utf8");
    const settings = readFileSync(join(process.cwd(), "src/app/(tabs)/settings/index.tsx"), "utf8");

    expect(tr.auth.restoringData.toLocaleLowerCase("tr-TR")).not.toContain("indir");
    expect(components).not.toContain("WaitingText");
    expect(frozenGate).not.toContain("WaitingText");
    expect(components.match(/<OperationFlow/g)).toHaveLength(1);
    expect(rootLayout).toContain('kind={isNewSignup ? "initialize" : "restore"}');
    expect(settings).toContain("tr.operation.localSigningOut");
  });

  it("gives sign-in, sign-out, freeze and deletion different motion signatures", () => {
    const source = readFileSync(join(process.cwd(), "src/ui/operation-flow.tsx"), "utf8");
    expect(source).toContain('"sign-in": [KeyRound, "focus", "primary"]');
    expect(source).toContain('"sign-out": [LogOut, "leave", "secondary"]');
    expect(source).toContain('freeze: [Snowflake, "turn", "warning"]');
    expect(source).toContain('delete: [Trash2, "drop", "destructive"]');
    expect(source).toMatch(/motion === "leave".*translateX/s);
    expect(source).toMatch(/motion === "turn".*rotate/s);
    expect(source).toMatch(/motion === "drop".*translateY.*scale/s);
  });
});
