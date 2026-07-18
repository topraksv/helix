import { describe, expect, it } from "vitest";
import { shellSyncHealth } from "../src/domain/sync-health";

const now = Date.parse("2026-07-18T12:00:00.000Z");

describe("shell sync health", () => {
  it("stays quiet for healthy, active, and local-only states", () => {
    expect(shellSyncHealth("idle", 0, null, now)).toBe("quiet");
    expect(shellSyncHealth("syncing", 2, "2026-07-18T11:59:00.000Z", now)).toBe("quiet");
    expect(shellSyncHealth("unconfigured", 20, "2026-07-17T00:00:00.000Z", now)).toBe("quiet");
  });

  it("asks for attention only after pending work ages past five minutes", () => {
    expect(shellSyncHealth("idle", 1, "2026-07-18T11:55:01.000Z", now)).toBe("quiet");
    expect(shellSyncHealth("idle", 1, "2026-07-18T11:55:00.000Z", now)).toBe("attention");
    expect(shellSyncHealth("idle", 1, "invalid", now)).toBe("attention");
  });

  it("surfaces an engine error immediately", () => {
    expect(shellSyncHealth("error", 0, null, now)).toBe("error");
  });
});
