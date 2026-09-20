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
