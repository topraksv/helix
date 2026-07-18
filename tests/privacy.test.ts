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

  it("blocks framed web UI without hiding a direct page", () => {
    expect(shouldCoverSensitiveUi("web", "active", true)).toBe(true);
    expect(shouldCoverSensitiveUi("web", "active", false)).toBe(false);
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
