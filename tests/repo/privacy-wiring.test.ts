/**
 * Wiring assertions: that a call really is where the privacy rules need it.
 *
 * Behaviour lives in tests/domain/privacy.test.ts; this file pins wiring.
 * These read SOURCE TEXT, which no behavioural test can do and which no mutant
 * can survive. Under Stryker they read an INSTRUMENTED copy, so the snippets
 * never match and the dry run dies, which is why `vitest.mutation.config.mts`
 * excludes this file. They stay mandatory in the normal gate.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sourceFiles } from "../source-corpus";

const read = (path: string): string => readFileSync(join(process.cwd(), path), "utf8");
const session = read("src/auth/session.ts");

describe("account-scoped state and redaction wiring", () => {
  // On web the device-local store is `localStorage`, readable by any script on
  // the origin. Nothing secret may reach it. Static analysis flags the writer
  // because a value derived from `signInWithPassword` lands there — that value
  // is the user's id and e-mail, never session material — so the boundary is
  // asserted here instead of being re-argued by hand each time.
  it("keeps only non-secret device-local values in the key-value store", () => {
    const writes: string[] = [];
    for (const file of sourceFiles("src", { atLeast: 150 })) {
      const text = read(file);
      for (const match of text.matchAll(/kv\.set\(\s*([^,]+),/g)) writes.push(match[1]!.trim());
    }
    // Guards the sweep itself: an empty result would pass every assertion below.
    expect(writes.length).toBeGreaterThanOrEqual(10);

    for (const key of writes) {
      expect(key, `kv.set key expression: ${key}`).not.toMatch(/token|password|secret|credential|jwt/i);
    }
    // Every write is either a `helix.`-namespaced literal or one of the named
    // constants declared beside it; nothing dynamic and unreviewed gets in.
    const allowed = /^("helix\.[\w.-]+"|`helix\.[\w.${}]+`|[A-Z][A-Z0-9_]*_KEY)$/;
    for (const key of writes) {
      expect(key, `kv.set key expression: ${key}`).toMatch(allowed);
    }
  });

  /**
   * The same rule, for the key family that survived the entry-default fix.
   *
   * The cash-flow matrix remembers which column is pinned. That reads as a
   * layout preference and is not one: `src/domain/cash-flow-matrix.ts` builds
   * every non-system column key from `category.id` or `column.id`, so the
   * stored value is a row id out of one account's workspace. Asserted against
   * the WRITER's own constants so a renamed key breaks here rather than
   * quietly stopping being cleared.
   */
  it("clears the matrix pin's account-scoped ids with the account", () => {
    const matrix = read("src/app/(tabs)/cash-flow/index.tsx");
    const declared = session.match(/const MATRIX_PIN_KEYS = \[([^\]]+)\]/)?.[1] ?? "";
    // Every pin key the screen writes, taken from the screen, not retyped here.
    const written = [...matrix.matchAll(/const (?:LEGACY_PIN_KEY|ROW_PIN_KEY|COLUMN_PIN_KEY) = "([^"]+)"/g)]
      .map((match) => match[1]!);
    expect(written).toHaveLength(3);
    for (const key of written) {
      expect(declared, `${key} must be cleared on sign-out`).toContain(`"${key}"`);
    }
    // The pin is only account-scoped because the key IS a row id; if that ever
    // stops being true this test is measuring nothing.
    const domain = read("src/domain/cash-flow-matrix.ts");
    expect(domain).toContain("key: category.id");
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
    const form = read("src/app/transaction.tsx");
    // The writer's key shape, resolved for every financial type the form emits.
    expect(form).toContain("kv.set(`helix.last.${entry.entryType}`");
    const declared = session.match(/const ENTRY_DEFAULT_KEYS = \[([^\]]+)\]/)?.[1] ?? "";
    for (const type of ["income", "expense", "transfer"]) {
      expect(declared, `helix.last.${type} must be cleared on sign-out`).toContain(`"helix.last.${type}"`);
    }
    // Sign-out, account deletion, remote invalidation and account switch all
    // reach the same reset; a fifth teardown path added without it would show up
    // here as a count mismatch rather than as a silent leak.
    // Every call, awaited alone or inside a `Promise.all`; not the declaration.
    expect(session.match(/clearAccountScopedDeviceState\(\)(?!:)/g)).toHaveLength(4);
    // Assert the rule, not the literal: EVERY field the sync status store holds
    // has to be named in the reset. Pinning the exact string made this break on
    // an unrelated but correct change, and — worse — it would have stayed green
    // if a new account-scoped field had been added and left behind.
    const status = read("src/sync/status.ts");
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
    const layout = read("src/app/_layout.tsx");
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
    const importer = read("src/services/export-import.ts");
    expect(importer).toContain("...fromDbShape(table, raw as Record<string, unknown>), userId");
    // Export is scoped the same way, by the authenticated owner and nothing else.
    expect(importer).toContain("`SELECT * FROM ${table} WHERE user_id = ?`");
  });

  it("keeps account cleanup and notification redaction wired to real boundaries", () => {
    const notifications = read("src/services/notifications.ts");
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
    const notifications = read("src/services/notifications.ts");
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
 * Source text, not behaviour: this file is excluded from the mutation run,
 * where instrumented session.ts never matches.
 *
 * Every authenticated background task must be session-scoped so
 * `stopSyncSession` can await it. The sign-out FAILURE path restarted the
 * session's background work with a bare `void Promise.allSettled([...])` — no
 * owner, invisible to `stopSyncSession`, so a retried sign-out followed by a
 * sign-in as another account could still let the old account's `rescheduleAll`
 * land and schedule its notifications under the new one.
 */
describe("session background work ownership", () => {
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

/**
 * The route guard reads the session's user id and the local `onboarded`
 * setting. Wiping the workspace while a user id is still set looks like an
 * unfinished setup, so a user who just signed out would land on the welcome
 * screen instead of sign-in. Every cleanup path therefore ends the session in
 * the same turn as the wipe, before any further await.
 */
describe("session cleanup order", () => {
  /** Body of a top-level cleanup path, from its name to the start of the next one. */
  function body(start: string, end: string): string {
    const from = session.indexOf(start);
    const to = session.indexOf(end, from);
    expect(from, `${start} not found — rename the anchor, do not delete the check`).toBeGreaterThan(-1);
    expect(to, `${end} not found after ${start}`).toBeGreaterThan(from);
    return session.slice(from, to);
  }

  const paths = [
    { name: "signOut", source: body("signOut: async (options) => {", "deleteAccount: async (options) => {") },
    { name: "deleteAccount", source: body("deleteAccount: async (options) => {", "verifyPassword: async (password)") },
    { name: "clearInvalidatedSession", source: body("async function clearInvalidatedSession", "function ensureAuthLifecycleSubscription") },
  ];

  it("endLocalSession clears the user id before it awaits anything", () => {
    const helper = body("async function endLocalSession", "\n}\n");
    expect(helper.indexOf("userId: null")).toBeGreaterThan(-1);
    expect(helper.indexOf("userId: null")).toBeLessThan(helper.indexOf("await "));
  });

  for (const path of paths) {
    it(`${path.name} ends the session before it awaits anything else`, () => {
      const wipe = path.source.indexOf("resetLocalWorkspace()");
      const clear = path.source.indexOf("endLocalSession()");
      expect(wipe, "path no longer wipes the workspace").toBeGreaterThan(-1);
      expect(clear, "path no longer ends the session").toBeGreaterThan(-1);
      expect(clear, "the session must be ended after the wipe succeeds").toBeGreaterThan(wipe);

      // Nothing may await between the wipe and the end of the session: each of
      // these was a frame in which the guard could route to Quick Start.
      const between = path.source.slice(wipe, clear);
      for (const call of ["kv.remove(", "signOutWithLocalFallback(", "supabase.auth.signOut("]) {
        expect(between, `${call} must run after the session ends, not before`).not.toContain(call);
      }
    });
  }
});
