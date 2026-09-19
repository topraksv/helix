import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  db: null as DatabaseSync | null,
  platform: { OS: "web" },
  writes: [] as unknown[][],
  /** Rate-table reads, and a hook that runs inside each read or write. */
  reads: 0,
  duringRead: null as (() => void) | null,
  duringWrite: null as (() => void) | null,
  task: vi.fn(async (_userId: string, _task: (signal: AbortSignal) => Promise<boolean>) => undefined),
}));

vi.mock("react-native", () => ({ Platform: harness.platform }));
vi.mock("../src/db/ids", () => ({
  deterministicId: async (key: string) => `id:${key}`,
  naturalKeys: { fxRate: (userId: string, currency: string, date: string) => `fx:${userId}:${currency}:${date}` },
}));
vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => ({
    getAllAsync: async (sql: string, args: unknown[]) => {
      harness.reads += 1;
      harness.duringRead?.();
      return harness.db!.prepare(sql).all(...args as never[]);
    },
  }),
}));
vi.mock("../src/db/mutations", () => ({
  writeRows: vi.fn(async (userId: string, writes: { table: string; row: Record<string, unknown> }[], isUserEntry: boolean) => {
    if (isUserEntry || writes.some((write) => write.table !== "fx_rates")) throw new Error("not a background rate write");
    harness.duringWrite?.();
    harness.writes.push(writes.map((write) => write.row));
    const insert = harness.db!.prepare(
      "INSERT INTO fx_rates (currency, rate_date, rate_try, user_id, deleted_at) VALUES (?, ?, ?, ?, NULL)",
    );
    for (const { row } of writes) insert.run(row.currency as string, row.rateDate as string, row.rateTry as string, userId);
  }),
}));
vi.mock("../src/sync/engine", () => ({ runSyncSessionTask: harness.task }));

import { clearRateCache, ensureFreshRates, loadRateCache, lookupRate, refreshRates } from "../src/services/fx-fetch";

const TCMB = "https://www.tcmb.gov.tr/kurlar/today.xml";
const OPEN = "https://open.er-api.com/v6/latest/TRY";
// 2026-07-17T00:00:00Z, the open feed's own publication moment.
const OPEN_BODY = JSON.stringify({ result: "success", time_last_update_unix: 1_784_246_400, rates: { USD: 0.025 } });
const TCMB_BODY = `<Tarih_Date Tarih="18.07.2026" Date="07/18/2026">
  <Currency CurrencyCode="USD"><Unit>1</Unit><ForexSelling>41</ForexSelling></Currency>
</Tarih_Date>`;

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

function insertRate(currency: string, date: string, rate: string, userId = "user-1", deletedAt: string | null = null): void {
  harness.db!.prepare(
    "INSERT INTO fx_rates (currency, rate_date, rate_try, user_id, deleted_at) VALUES (?, ?, ?, ?, ?)",
  ).run(currency, date, rate, userId, deletedAt);
}

/** A fetch answering each URL with a fresh response, or failing with an Error. */
function serve(routes: Record<string, { body: string; init?: ResponseInit } | Error>) {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    const answer = routes[url];
    if (answer === undefined) throw new Error(`unexpected ${url}`);
    if (answer instanceof Error) throw answer;
    return new Response(answer.body, answer.init);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("FX cache history", () => {
  beforeEach(() => {
    harness.db = new DatabaseSync(":memory:");
    harness.platform.OS = "web";
    harness.writes.length = 0;
    harness.reads = 0;
    harness.duringRead = null;
    harness.duringWrite = null;
    createSchema(harness.db);
    clearRateCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
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
    expect(lookupRate("user-1", "USD", "2026-01-01")).toEqual({
      rate: { currency: "USD", rateDate: "2026-01-01", rateTry: 40 },
      isStale: false,
    });
    expect(lookupRate("user-1", "USD", "2024-12-31")).toBeNull();
  });

  it("caches only this owner's live, dated and plausible rates", async () => {
    insertRate("USD", "2026-07-01", "40");
    insertRate("EUR", "2026-07-01", "1000000");
    insertRate("GBP", "2026-07-01", "1000001");
    insertRate("JPY", "2026-07-01", "0");
    insertRate("CHF", "2026-07-01", "abc");
    insertRate("CAD", "2026-02-30", "30");
    insertRate("AUD", "2026-07-01", "25", "user-1", "2026-07-02T00:00:00.000Z");
    insertRate("SEK", "2026-07-01", "4", "user-2");

    expect(lookupRate("user-1", "USD", "2026-07-01")).toBeNull();
    await loadRateCache("user-1");

    expect(lookupRate("user-1", "USD", "2026-07-01")?.rate.rateTry).toBe(40);
    expect(lookupRate("user-1", "EUR", "2026-07-01")?.rate.rateTry).toBe(1_000_000);
    for (const refused of ["GBP", "JPY", "CHF", "CAD", "AUD", "SEK"]) {
      expect(lookupRate("user-1", refused, "2026-07-01"), refused).toBeNull();
    }
    expect(lookupRate("user-2", "USD", "2026-07-01")).toBeNull();
  });

  it("answers TRY at par on the asked date without a cache", () => {
    expect(lookupRate("nobody", "TRY", "2026-03-04")).toEqual({
      rate: { currency: "TRY", rateDate: "2026-03-04", rateTry: 1 },
      isStale: false,
    });
  });

  it("drops a load that an account boundary overtook", async () => {
    insertRate("USD", "2026-07-01", "40");
    const load = loadRateCache("user-1");
    clearRateCache();
    await load;
    expect(lookupRate("user-1", "USD", "2026-07-01")).toBeNull();
  });

  it("asks only the CORS-enabled feed on web and caches what it stated", async () => {
    const fetch = serve({ [OPEN]: { body: OPEN_BODY } });

    await expect(refreshRates("user-1")).resolves.toBe(true);

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([OPEN]);
    expect(harness.writes).toEqual([[{
      id: "id:fx:user-1:USD:2026-07-17",
      currency: "USD",
      rateDate: "2026-07-17",
      rateTry: "40",
      deletedAt: null,
    }]]);
    expect(lookupRate("user-1", "USD", "2026-07-17")?.rate.rateTry).toBe(40);
  });

  it("reports a failed feed on web without writing", async () => {
    serve({ [OPEN]: { body: OPEN_BODY, init: { status: 503 } } });
    await expect(refreshRates("user-1")).resolves.toBe(false);
    expect(harness.writes).toEqual([]);
  });

  it("prefers TCMB on native and falls back to the open feed", async () => {
    harness.platform.OS = "ios";
    const tcmbOnly = serve({ [TCMB]: { body: TCMB_BODY } });
    await expect(refreshRates("user-1")).resolves.toBe(true);
    expect(tcmbOnly.mock.calls.map(([url]) => url)).toEqual([TCMB]);
    expect(harness.writes.at(-1)).toEqual([expect.objectContaining({ rateDate: "2026-07-18", rateTry: "41" })]);

    const fallback = serve({ [TCMB]: { body: "", init: { status: 500 } }, [OPEN]: { body: OPEN_BODY } });
    await expect(refreshRates("user-1")).resolves.toBe(true);
    expect(fallback.mock.calls.map(([url]) => url)).toEqual([TCMB, OPEN]);
    expect(harness.writes.at(-1)).toEqual([expect.objectContaining({ rateDate: "2026-07-17" })]);

    serve({ [TCMB]: new Error("offline"), [OPEN]: new Error("offline") });
    await expect(refreshRates("user-1")).resolves.toBe(false);
  });

  it("rewrites only a rate that changed or was deleted", async () => {
    serve({ [OPEN]: { body: OPEN_BODY } });
    insertRate("USD", "2026-07-17", "40");
    await expect(refreshRates("user-1")).resolves.toBe(true);
    expect(harness.writes).toEqual([]);
    expect(lookupRate("user-1", "USD", "2026-07-17")?.rate.rateTry).toBe(40);

    harness.db!.exec("UPDATE fx_rates SET rate_try = '39'");
    await refreshRates("user-1");
    harness.db!.exec("UPDATE fx_rates SET rate_try = '40', deleted_at = '2026-07-18T00:00:00.000Z'");
    await refreshRates("user-1");
    expect(harness.writes).toHaveLength(2);
  });

  it("refuses a response larger than it will read", async () => {
    serve({ [OPEN]: { body: OPEN_BODY, init: { headers: { "content-length": "1000001" } } } });
    await expect(refreshRates("user-1")).resolves.toBe(false);

    serve({ [OPEN]: { body: OPEN_BODY.padEnd(1_000_001, " ") } });
    await expect(refreshRates("user-1")).resolves.toBe(false);

    serve({
      [OPEN]: { body: OPEN_BODY.padEnd(1_000_000, " "), init: { headers: { "content-length": "1000000" } } },
    });
    await expect(refreshRates("user-1")).resolves.toBe(true);
  });

  it("stops at every point a cancelled session can reach", async () => {
    const aborted = new AbortController();
    aborted.abort();
    const fetch = serve({ [OPEN]: { body: OPEN_BODY } });
    await expect(refreshRates("user-1", aborted.signal)).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();

    const midFlight = new AbortController();
    let forwarded: boolean | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      midFlight.abort();
      forwarded = init.signal?.aborted;
      return new Response(OPEN_BODY);
    }));
    await expect(refreshRates("user-1", midFlight.signal)).resolves.toBe(false);
    expect(forwarded).toBe(true);
    expect(harness.reads, "a cancelled fetch never reaches the database").toBe(0);

    serve({ [OPEN]: { body: OPEN_BODY } });
    const duringRead = new AbortController();
    harness.duringRead = () => duringRead.abort();
    await expect(refreshRates("user-1", duringRead.signal)).resolves.toBe(false);
    expect(harness.writes).toEqual([]);

    harness.duringRead = null;
    const duringWrite = new AbortController();
    harness.duringWrite = () => duringWrite.abort();
    await expect(refreshRates("user-1", duringWrite.signal)).resolves.toBe(false);
    expect(harness.writes).toHaveLength(1);
    expect(lookupRate("user-1", "USD", "2026-07-17"), "a cancelled refresh does not reload the cache").toBeNull();
  });

  it("leaves no timer behind once a feed has answered", async () => {
    vi.useFakeTimers();
    serve({ [OPEN]: { body: OPEN_BODY } });
    await expect(refreshRates("user-1")).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives a silent feed ten seconds", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("timed out")));
      });
    }));
    const pending = refreshRates("user-1");
    await vi.advanceTimersByTimeAsync(9_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(false);
  });

  it("throttles screen refreshes to one a minute, shared with the boot fetch", async () => {
    serve({ [OPEN]: { body: OPEN_BODY } });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const task = harness.task;
    task.mockClear();

    await refreshRates("user-1");
    ensureFreshRates("user-1");
    now.mockReturnValue(1_059_999);
    ensureFreshRates("user-1");
    expect(task).not.toHaveBeenCalled();

    now.mockReturnValue(1_060_000);
    ensureFreshRates("user-1");
    ensureFreshRates("user-1");
    expect(task).toHaveBeenCalledTimes(1);
    const [owner, run] = task.mock.calls[0]!;
    expect(owner).toBe("user-1");
    await expect(run(new AbortController().signal)).resolves.toBe(true);

    clearRateCache();
    ensureFreshRates("user-1");
    expect(task).toHaveBeenCalledTimes(2);
  });
});
