import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("../../src/services/kv", () => ({
  kv: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => void store.set(key, value)),
    remove: vi.fn(async (key: string) => void store.delete(key)),
  },
}));

const { pendingUsage, recordScreenView, reportUsage } = await import("../../src/services/usage");

/** `recordScreenView` never awaits its caller, so a test has to. */
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => store.clear());

describe("counting", () => {
  it("accumulates visits per screen and day", async () => {
    const at = new Date(2026, 8, 20, 10, 0);
    recordScreenView("tabs.settings", at);
    recordScreenView("tabs.settings", at);
    recordScreenView("tabs.cash-flow", at);
    await settle();
    expect(await pendingUsage()).toEqual([
      { day: "2026-09-20", screen: "tabs.settings", count: 2 },
      { day: "2026-09-20", screen: "tabs.cash-flow", count: 1 },
    ]);
  });

  it("keeps days apart, because the report is per day", async () => {
    recordScreenView("tabs", new Date(2026, 8, 20, 22, 0));
    recordScreenView("tabs", new Date(2026, 8, 21, 1, 0));
    await settle();
    expect((await pendingUsage()).map((delta) => delta.day)).toEqual(["2026-09-20", "2026-09-21"]);
  });

  it("survives a corrupt store rather than losing the app", async () => {
    store.set("helix.usage_counters.v1", "{not json");
    recordScreenView("tabs", new Date(2026, 8, 20));
    await settle();
    expect(await pendingUsage()).toEqual([{ day: "2026-09-20", screen: "tabs", count: 1 }]);
  });
});

describe("what storage may hand back", () => {
  it("ignores an entry whose count is not a positive whole number", async () => {
    store.set(
      "helix.usage_counters.v1",
      JSON.stringify({ "2026-09-20|a": 2, "2026-09-20|b": "3", "2026-09-20|c": 0, "2026-09-20|d": -1, "2026-09-20|e": 1.5 }),
    );
    expect(await pendingUsage()).toEqual([{ day: "2026-09-20", screen: "a", count: 2 }]);
  });

  it("ignores a store that is not an object at all", async () => {
    store.set("helix.usage_counters.v1", JSON.stringify([1, 2, 3]));
    expect(await pendingUsage()).toEqual([]);
  });

  it("stops accepting new screens once the store is full, and keeps counting the ones it has", async () => {
    const at = new Date(2026, 8, 20);
    const full = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`2026-09-20|s${i}`, 1]));
    store.set("helix.usage_counters.v1", JSON.stringify(full));
    recordScreenView("s0", at);
    recordScreenView("brand-new", at);
    await settle();
    const pending = await pendingUsage();
    expect(pending.find((delta) => delta.screen === "s0")?.count).toBe(2);
    expect(pending.some((delta) => delta.screen === "brand-new")).toBe(false);
  });
});

describe("reporting", () => {
  it("subtracts what it sent rather than clearing, so a visit mid-flight is kept", async () => {
    const at = new Date(2026, 8, 20, 9, 0);
    recordScreenView("tabs", at);
    await settle();
    const port = {
      record: vi.fn(async () => {
        // A visit that lands while the upload is in flight.
        recordScreenView("tabs", at);
        await settle();
      }),
    };
    await reportUsage(port);
    expect(port.record).toHaveBeenCalledWith([{ day: "2026-09-20", screen: "tabs", count: 1 }]);
    expect(await pendingUsage()).toEqual([{ day: "2026-09-20", screen: "tabs", count: 1 }]);
  });

  it("keeps everything when the upload fails, and sends it again next time", async () => {
    recordScreenView("tabs", new Date(2026, 8, 20));
    await settle();
    const failing = { record: vi.fn(async () => void (() => { throw new Error("offline"); })()) };
    await reportUsage({
      record: async () => {
        throw new Error("offline");
      },
    });
    expect(await pendingUsage()).toEqual([{ day: "2026-09-20", screen: "tabs", count: 1 }]);
    expect(failing.record).not.toHaveBeenCalled();
  });

  it("says nothing when there is nothing to say", async () => {
    const port = { record: vi.fn(async () => {}) };
    await reportUsage(port);
    expect(port.record).not.toHaveBeenCalled();
  });
});
