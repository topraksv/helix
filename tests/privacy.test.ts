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
    expect(session).toContain("await kv.remove(LAST_USER_KEY)");
  });
});
