import { describe, expect, it } from "vitest";

import { isUsageDelta, localDay, screenKey } from "../../src/domain/usage";

/**
 * The database refuses a screen key that does not match its CHECK, so every
 * case below is really a question about what reaches the network: if an
 * identifier can survive normalisation, a month, a row id or a person id
 * becomes telemetry.
 */
describe("screenKey", () => {
  it("names the screen and drops the route group's parentheses", () => {
    expect(screenKey("/(tabs)/settings/persons")).toBe("tabs.settings.persons");
    expect(screenKey("/(tabs)")).toBe("tabs");
  });

  it("returns a countable name for the root", () => {
    expect(screenKey("/")).toBe("root");
    expect(screenKey("")).toBe("root");
  });

  it("drops every segment that identifies a row, a month or a person", () => {
    expect(screenKey("/(tabs)/cash-flow/2026-09")).toBe("tabs.cash-flow");
    expect(screenKey("/transaction/42")).toBe("transaction");
    expect(screenKey("/(tabs)/investments/9f8d7e6c-1234-4abc-8def-0123456789ab")).toBe("tabs.investments");
    expect(screenKey("/person/[id]")).toBe("person");
  });

  it("drops the query string, which is where parameters hide", () => {
    expect(screenKey("/transaction?id=42&amount=1999")).toBe("transaction");
    expect(screenKey("/(tabs)/cash-flow/item?month=2026-09")).toBe("tabs.cash-flow.item");
  });

  it("reduces anything else to the accepted shape or to nothing", () => {
    expect(screenKey("/___")).toBe("root");
    // Routes in this app are ASCII, but a key must be valid whatever arrives:
    // the letters outside [a-z0-9-] are separators, not transliterated.
    expect(screenKey("/ÇOK-UZUN-BİR-ŞEY")).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("never returns a key the database would reject", () => {
    const shape = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/;
    for (const path of [
      "/",
      "/(tabs)/cash-flow/2026-09-15",
      "/(onboarding)/setup",
      "/import-wizard?step=3",
      "/a".repeat(80),
      "/%20%20",
    ]) {
      const key = screenKey(path);
      if (key !== null) {
        expect(key, path).toMatch(shape);
        expect(key.length, path).toBeLessThanOrEqual(60);
      }
    }
  });
});

describe("localDay", () => {
  it("uses the device's own day rather than UTC", () => {
    // 23:30 on the 15th in a zone ahead of UTC is still the 15th to the person
    // who opened the screen, whatever the server would have called it.
    const late = new Date(2026, 8, 15, 23, 30);
    expect(localDay(late)).toBe("2026-09-15");
  });
});

describe("isUsageDelta", () => {
  it("accepts what the server takes", () => {
    expect(isUsageDelta({ day: "2026-09-20", screen: "tabs.settings", count: 3 })).toBe(true);
  });

  it("refuses a shape that an upgrade could have left in storage", () => {
    expect(isUsageDelta({ day: "20-09-2026", screen: "tabs", count: 1 })).toBe(false);
    expect(isUsageDelta({ day: "2026-09-20", screen: "Tabs.Settings", count: 1 })).toBe(false);
    expect(isUsageDelta({ day: "2026-09-20", screen: "tabs", count: 0 })).toBe(false);
    expect(isUsageDelta({ day: "2026-09-20", screen: "tabs", count: 1.5 })).toBe(false);
    expect(isUsageDelta(null)).toBe(false);
  });
});
