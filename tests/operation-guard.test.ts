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
    expect(rootLayout).toContain("<WaitingNotice kind={wait.kind} title={wait.title} message={wait.message} />");
    // Signing out, freezing and deleting all end the session and land on this
    // same view, so each one has to say what it is rather than borrowing the
    // first-pull sentence — and each one names itself in a heading, because a
    // sentence alone left three very different operations looking identical.
    for (const intent of ["sign-out", "local-sign-out", "delete", "freeze"]) {
      expect(rootLayout).toContain(`case "${intent}":`);
    }
    const titles = new Set(
      [...rootLayout.matchAll(/title: (tr\.[A-Za-z.]+)/g)].map((match) => match[1]),
    );
    expect(titles.size).toBeGreaterThanOrEqual(7);
    expect(settings).toContain("tr.operation.localSigningOut");
  });

  it("keeps first-pull copy separate from account lifecycle actions", () => {
    expect(tr.auth.restoringData).toBe("Hesabın eşitleniyor");
    expect(tr.auth.restoringData).not.toContain("Çalışma alanın");
    expect(tr.auth.restoringData).not.toContain("Mali tablon");
  });

  it("keeps the first-pull wait in the active theme and uses a compact presentation", () => {
    const components = readFileSync(join(process.cwd(), "src/ui/components.tsx"), "utf8");
    const rootLayout = readFileSync(join(process.cwd(), "src/app/_layout.tsx"), "utf8");
    const waitStart = rootLayout.indexOf("if (guard.view === \"wait\" || guardQueryFailed)");
    const waitEnd = rootLayout.indexOf("\n\n  return (\n    <ThemeContext.Provider", waitStart);
    const waitBranch = rootLayout.slice(waitStart, waitEnd);

    expect(waitBranch).toContain("<ThemeContext.Provider value={theme}>");
    expect(components).toContain('presentation="waiting"');
    expect(tr.auth.restoringData).toBe("Hesabın eşitleniyor");
    expect(tr.auth.restoringDataFresh).toBe("Hesabın hazırlanıyor");
  });

  it("gives each operation a distinct static visual signature", () => {
    const source = readFileSync(join(process.cwd(), "src/ui/operation-flow.tsx"), "utf8");
    expect(source).toContain('"sign-in": [KeyRound, "primary"]');
    expect(source).toContain('"sign-out": [LogOut, "secondary"]');
    expect(source).toContain('freeze: [Snowflake, "warning"]');
    expect(source).toContain('delete: [Trash2, "destructive"]');
    // The signature explains an action BEFORE it starts and stays still; a
    // pre-action surface that pulses reads as work already happening. Motion
    // belongs to the waiting view, which is the one moment something really is
    // running — and it honours Reduce Motion.
    // Anchored on the dialog header because it is now the pre-action surface:
    // `OperationSignature` was removed unrendered, and slicing on a marker the
    // file no longer contains made every assertion below it vacuous — the
    // slice ran to the end of the string and still passed.
    const header = source.indexOf("export function OperationDialogHeader(");
    expect(header, "the pre-action surface must still exist to be checked").toBeGreaterThan(0);
    expect(source.slice(header)).not.toContain("Animated");
    const waiting = source.slice(source.indexOf("if (waiting) {"), header);
    expect(waiting).toContain("<Animated.View");
    expect(source).toContain("if (reducedMotion) {");
    // The component this rule used to name is gone; nothing may quietly bring
    // back an unrendered second signature surface.
    expect(source).not.toContain("OperationSignature");
  });

  it("keeps lifecycle entry points quiet and routes cloud sign-out through confirmation", () => {
    const settings = readFileSync(join(process.cwd(), "src/app/(tabs)/settings/index.tsx"), "utf8");
    const accountSecurity = readFileSync(join(process.cwd(), "src/app/account-security.tsx"), "utf8");
    expect(settings).not.toContain("ActionBadge");
    expect(settings).toContain('testID="account-sign-out-action"');
    expect(settings).toContain('operation: "sign-out"');
    // Deleting a CLOUD account lives beside freezing it — the two ways an
    // account ends belong together rather than a screen apart. A local-only
    // workspace has no Account Security screen at all (no password, no e-mail,
    // nothing to freeze), so its one ending stays in Settings and is gated on
    // exactly that.
    expect(accountSecurity).toContain('testID="account-delete-action"');
    expect(accountSecurity).toContain('testID="account-freeze-action"');
    expect(settings).toContain("{!isSupabaseConfigured ? (");
    const localOnlyDelete = settings.slice(settings.indexOf("{!isSupabaseConfigured ? ("));
    expect(localOnlyDelete).toContain('testID="account-delete-action"');
    expect(accountSecurity).not.toContain("ActionBadge");
    expect(accountSecurity).toContain("chevron={!freezing}");
    expect(accountSecurity).toContain("onPress={freezing ? undefined :");
  });
});
