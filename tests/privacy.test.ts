import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { shouldCoverSensitiveUi } from "../src/domain/privacy";

describe("sensitive UI cover policy", () => {
  it("covers native inactive and background snapshots", () => {
    expect(shouldCoverSensitiveUi("ios", "inactive", false)).toBe(true);
    expect(shouldCoverSensitiveUi("android", "background", false)).toBe(true);
    expect(shouldCoverSensitiveUi("ios", "active", false)).toBe(false);
  });

  it("does not interrupt native password-manager biometrics before sign-in", () => {
    expect(shouldCoverSensitiveUi("ios", "inactive", false, false)).toBe(false);
    expect(shouldCoverSensitiveUi("ios", "inactive", false, true)).toBe(true);
  });

  it("blocks framed web UI without hiding a direct page", () => {
    expect(shouldCoverSensitiveUi("web", "active", true)).toBe(true);
    expect(shouldCoverSensitiveUi("web", "active", false)).toBe(false);
  });

  // On web the device-local store is `localStorage`, readable by any script on
  // the origin. Nothing secret may reach it. Static analysis flags the writer
  // because a value derived from `signInWithPassword` lands there — that value
  // is the user's id and e-mail, never session material — so the boundary is
  // asserted here instead of being re-argued by hand each time.
  it("keeps only non-secret device-local values in the key-value store", () => {
    const discover = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) return discover(path);
      return /\.tsx?$/.test(path) ? [path] : [];
    });
    const sources = discover(join(process.cwd(), "src"));
    const writes: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/kv\.set\(\s*([^,]+),/g)) writes.push(match[1]!.trim());
    }
    // Guards the sweep itself: an empty result would pass every assertion below.
    expect(writes.length).toBeGreaterThanOrEqual(10);

    for (const key of writes) {
      expect(key, `kv.set key expression: ${key}`).not.toMatch(/token|password|secret|credential|jwt/i);
    }
    // Every write is either a `helix.`-namespaced literal or one of the named
    // constants declared beside it; nothing dynamic and unreviewed gets in.
    const allowed = /^("helix\.[\w.-]+"|`helix\.[\w.${}]+`|[A-Z][A-Z0-9_]*_KEY|SNAPSHOT_KEY|EVENTS_KEY|TOUR_KEY)$/;
    for (const key of writes) {
      expect(key, `kv.set key expression: ${key}`).toMatch(allowed);
    }
  });

  /**
   * Not every `helix.` key is a device preference.
   *
   * The entry form remembers the last used category and payment source so the
   * next transaction starts where the last one ended. Those are ROW IDS from one
   * account's workspace, kept in `localStorage` on web, and nothing used to
   * remove them — so a shared browser carried the previous account's ids past
   * sign-out. The reader validates them against the live categories, so they
   * were never displayed to the next account; they were still that account's
   * data sitting in a store the session no longer owned.
   */
  it("clears the entry form's account-scoped defaults with the account", () => {
    const session = readFileSync(join(process.cwd(), "src/auth/session.ts"), "utf8");
    const form = readFileSync(join(process.cwd(), "src/app/transaction.tsx"), "utf8");
    // The writer's key shape, resolved for every financial type the form emits.
    expect(form).toContain("kv.set(`helix.last.${entryType}`");
    const declared = session.match(/const ENTRY_DEFAULT_KEYS = \[([^\]]+)\]/)?.[1] ?? "";
    for (const type of ["income", "expense", "transfer"]) {
      expect(declared, `helix.last.${type} must be cleared on sign-out`).toContain(`"helix.last.${type}"`);
    }
    // Sign-out, account deletion, remote invalidation and account switch all
    // reach the same reset; a fifth teardown path added without it would show up
    // here as a count mismatch rather than as a silent leak.
    expect(session.match(/await clearAccountScopedDeviceState\(\)/g)).toHaveLength(4);
    // Assert the rule, not the literal: EVERY field the sync status store holds
    // has to be named in the reset. Pinning the exact string made this break on
    // an unrelated but correct change, and — worse — it would have stayed green
    // if a new account-scoped field had been added and left behind.
    const status = readFileSync(join(process.cwd(), "src/sync/status.ts"), "utf8");
    const storeFields = [
      ...(status.match(/create<SyncStatusStore>\(\(set\) => \(\{([\s\S]*?)\}\)\)/)?.[1] ?? "")
        .matchAll(/^\s{2}(\w+):/gm),
    ].map((match) => match[1]!).filter((field) => field !== "set");
    const reset = session.match(/useSyncStatus\.getState\(\)\.set\(\{([^}]*)\}\)/)?.[1] ?? "";
    expect(storeFields.length).toBeGreaterThanOrEqual(3);
    for (const field of storeFields) {
      expect(reset, `${field} must be reset when the account changes`).toContain(`${field}:`);
    }
  });

  /**
   * The undo bar quotes a real row ("Netflix · Silindi") and its action closes
   * over the account's user id plus a row snapshot, in a module-level store that
   * outlives the screen. Signing out inside its six-second life carried both
   * across the account boundary — and the restore would have written that row
   * into the next account's freshly wiped workspace.
   */
  it("drops the undo bar when the session it belongs to ends", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/_layout.tsx"), "utf8");
    expect(layout).toContain("useUndo");
    expect(layout).toMatch(/useEffect\(\(\) => \{\s*useUndo\.getState\(\)\.clear\(\);\s*\}, \[userId\]\)/);
  });

  /**
   * A backup is a file: its `user_id` columns are input, not authority. Import
   * stamps the importing account onto every row, so a bundle exported by another
   * account restores as the importer's own data and can never create a row the
   * server would accept as someone else's.
   */
  it("re-owns imported rows instead of trusting the file's user ids", () => {
    const importer = readFileSync(join(process.cwd(), "src/services/export-import.ts"), "utf8");
    expect(importer).toContain("...fromDbShape(table, raw as Record<string, unknown>), userId");
    // Export is scoped the same way, by the authenticated owner and nothing else.
    expect(importer).toContain("`SELECT * FROM ${table} WHERE user_id = ?`");
  });

  it("keeps account cleanup and notification redaction wired to real boundaries", () => {
    const session = readFileSync(join(process.cwd(), "src/auth/session.ts"), "utf8");
    const notifications = readFileSync(join(process.cwd(), "src/services/notifications.ts"), "utf8");
    // Account switch, explicit sign-out, account deletion and remote session
    // invalidation must each clear stale scheduled previews.
    expect(session.match(/clearAccountNotifications\(true\)/g)).toHaveLength(4);
    expect(notifications).toContain("privateNotificationContent(detailsEnabled");
    expect(notifications).toContain("tr.notif.privateBody");
    expect(notifications).toContain("else {\n    await clearAccountNotifications();\n    await setNotificationDetailsEnabled(false);");
    expect(notifications).toContain("await clearAccountNotifications(true)");
  });

  /**
   * The tap payload is stored by the OS beside the notification, so it is
   * subject to the same redaction rule as the visible copy. It may carry an
   * identity and nothing else: the amount, the rule name and the date all stay
   * in the body, which `privateNotificationContent` already neutralizes.
   */
  it("keeps the notification tap payload to identity, never financial detail", () => {
    const notifications = readFileSync(join(process.cwd(), "src/services/notifications.ts"), "utf8");
    expect(notifications).toContain("data: notificationTargetPayload(n.target)");
    expect(notifications).toContain("privateNotificationTarget(detailsEnabled, notification.target)");
    // No planned target may be built from a name or an amount.
    for (const match of notifications.matchAll(/target: \{[^}]*\}/g)) {
      // `<row>.id` is the only legitimate identity expression: `t.name`,
      // `f.title` or an amount would otherwise pass as "an id".
      expect(match[0], "notification target payload").toMatch(
        /^target: \{ kind: "(expected|subscription|installmentPlan)"(, id: \w+\.id)? \}$/,
      );
    }
  });
});

/**
 * Structural guard, not a behaviour test: `session.ts` imports react-native and
 * cannot be loaded by vitest, which is why this file inspects it as text.
 *
 * Every authenticated background task must be session-scoped so
 * `stopSyncSession` can await it. The sign-out FAILURE path restarted the
 * session's background work with a bare `void Promise.allSettled([...])` — no
 * owner, invisible to `stopSyncSession`, so a retried sign-out followed by a
 * sign-in as another account could still let the old account's `rescheduleAll`
 * land and schedule its notifications under the new one.
 */
describe("session background work ownership", () => {
  const session = readFileSync(join(process.cwd(), "src/auth/session.ts"), "utf8");

  it("restarts background work through runSyncSessionTask", () => {
    expect(session).toContain("runSyncSessionTask");
    expect(session).toMatch(/void runSyncSessionTask\(userId, async \(\) => \{/);
  });

  it("leaves no unowned floating promise on that path", () => {
    // A bare `void Promise.` is exactly the shape stopSyncSession cannot await.
    expect(session).not.toMatch(/void Promise\./);
  });

  it("turns a remote SIGNED_OUT event into owner-checked local cleanup", () => {
    expect(session).toContain('event !== "SIGNED_OUT"');
    expect(session).toContain("useSession.getState().userId !== userId");
    expect(session).toContain("await stopSyncSession(userId)");
    expect(session).toContain("await resetLocalWorkspace()");
    expect(session).toContain("LOCAL_WIPE_PENDING_OWNER");
    expect(session).toMatch(/catch \{[\s\S]*LOCAL_WIPE_PENDING_OWNER/);
    expect(session).toContain("await kv.remove(LAST_USER_KEY)");
  });
});
