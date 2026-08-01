import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null }));

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("../src/db/ids", () => ({
  deterministicId: vi.fn(),
  naturalKeys: {},
}));
vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => ({
    getAllAsync: async (sql: string, args: unknown[]) => harness.db!.prepare(sql).all(...args as never[]),
  }),
}));
vi.mock("../src/db/mutations", () => ({ writeRows: vi.fn() }));
vi.mock("../src/sync/engine", () => ({ runSyncSessionTask: vi.fn() }));

import { clearRateCache, loadRateCache, lookupRate } from "../src/services/fx-fetch";

function createSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE fx_rates (
      currency TEXT NOT NULL,
      rate_date TEXT NOT NULL,
      rate_try TEXT NOT NULL,
      user_id TEXT NOT NULL,
      deleted_at TEXT
    );
  `);
}

describe("FX cache history", () => {
  beforeEach(() => {
    harness.db = new DatabaseSync(":memory:");
    createSchema(harness.db);
    clearRateCache();
  });

  it("keeps a historical rate when newer rows exceed the cache window", async () => {
    const insert = harness.db!.prepare(
      "INSERT INTO fx_rates (currency, rate_date, rate_try, user_id, deleted_at) VALUES (?, ?, ?, ?, NULL)",
    );
    for (let day = 0; day < 200; day += 1) {
      const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
      insert.run("USD", date, "40", "user-1");
    }
    insert.run("USD", "2025-01-01", "39", "user-1");

    await loadRateCache("user-1");

    expect(lookupRate("user-1", "USD", "2025-01-02")).toEqual({
      rate: { currency: "USD", rateDate: "2025-01-01", rateTry: 39 },
      isStale: true,
    });
  });
});
