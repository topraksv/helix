import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
    const sources = [
      "src/auth/session.ts",
      "src/services/device-preferences.ts",
      "src/services/diagnostics.ts",
      "src/services/markets.ts",
      "src/ui/root-lifecycle.ts",
      "src/ui/tour.tsx",
      "src/ui/frozen-gate.tsx",
      "src/app/_layout.tsx",
      "src/app/transaction.tsx",
      "src/app/(tabs)/cash-flow/index.tsx",
      "src/app/(tabs)/settings/index.tsx",
    ];
    const writes: string[] = [];
    for (const file of sources) {
      const text = readFileSync(join(process.cwd(), file), "utf8");
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
    expect(session.match(/clearAccountNotifications\(true\)/g)).toHaveLength(3);
    expect(notifications).toContain("privateNotificationContent(detailsEnabled");
    expect(notifications).toContain("tr.notif.privateBody");
    expect(notifications).toContain("else {\n    await clearAccountNotifications();\n    await setNotificationDetailsEnabled(false);");
    expect(notifications).toContain("await clearAccountNotifications(true)");
  });
});
