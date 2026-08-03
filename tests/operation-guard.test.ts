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

  it("keeps first-pull copy separate from account lifecycle actions", () => {
    expect(tr.auth.restoringData).toContain("Hesabındaki veriler");
    expect(tr.auth.restoringData).not.toContain("Çalışma alanın");
    expect(tr.auth.restoringData).not.toContain("Mali tablon");
  });

  it("gives each operation a distinct static visual signature", () => {
    const source = readFileSync(join(process.cwd(), "src/ui/operation-flow.tsx"), "utf8");
    expect(source).toContain('"sign-in": [KeyRound, "primary"]');
    expect(source).toContain('"sign-out": [LogOut, "secondary"]');
    expect(source).toContain('freeze: [Snowflake, "warning"]');
    expect(source).toContain('delete: [Trash2, "destructive"]');
    expect(source).not.toContain("useWaitingPulse");
    expect(source).not.toContain("<Animated.View");
  });

  it("keeps lifecycle entry points quiet and routes cloud sign-out through confirmation", () => {
    const settings = readFileSync(join(process.cwd(), "src/app/(tabs)/settings/index.tsx"), "utf8");
    expect(settings).not.toContain("<OperationSignature");
    expect(settings).toContain('testID="account-sign-out-action"');
    expect(settings).toContain('operation: "sign-out"');
    expect(settings).toContain('testID="account-delete-action"');
  });
});
