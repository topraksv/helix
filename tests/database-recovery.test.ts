import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  open: vi.fn(),
  deleteDatabase: vi.fn(),
  platform: { OS: "ios" },
  moves: [] as [string, string][],
  deletes: [] as string[],
  files: new Set<string>(),
  contents: new Map<string, string>(),
  failMove: false,
  failFiles: false,
}));

vi.mock("react-native", () => ({ Platform: harness.platform }));
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: harness.open,
  deleteDatabaseAsync: harness.deleteDatabase,
}));
vi.mock("expo-file-system", () => {
  class Directory {
    readonly path: string;
    constructor(...parts: unknown[]) {
      this.path = parts.map((part) => part instanceof Directory ? part.path : String(part)).join("/");
    }
  }
  class File {
    readonly path: string;
    constructor(...parts: unknown[]) {
      this.path = parts.map((part) => part instanceof Directory ? part.path : String(part)).join("/");
    }
    get exists() {
      if (harness.failFiles) throw new Error("file system unavailable");
      return harness.files.has(this.path);
    }
    async move(destination: File) {
      if (harness.failMove) throw new Error("rename refused");
      harness.moves.push([this.path, destination.path]);
      harness.files.delete(this.path);
      harness.files.add(destination.path);
    }
    delete() {
      harness.deletes.push(this.path);
      harness.files.delete(this.path);
      harness.contents.delete(this.path);
    }
    write(content: string) {
      if (harness.failFiles) throw new Error("file system unavailable");
      harness.files.add(this.path);
      harness.contents.set(this.path, content);
    }
    async text() { return harness.contents.get(this.path) ?? ""; }
  }
  return { Directory, File, Paths: { document: "documents" } };
});

const MARKER = "documents/helix.database-recovery.json";
const corrupt = () => Object.assign(new Error("database disk image is malformed"), { code: "SQLITE_CORRUPT" });

function fakeDatabase() {
  return {
    execAsync: vi.fn(async (_sql: string) => undefined),
    closeAsync: vi.fn(async () => undefined),
    withTransactionAsync: vi.fn(async (task: () => Promise<void>) => task()),
    runAsync: vi.fn(async (_sql: string, _params: unknown[]) => undefined),
    prepareAsync: vi.fn(),
  };
}

/** A fresh copy of the module: its handle, notice and transaction queue start empty. */
async function load() {
  vi.resetModules();
  return import("../src/db/client");
}

describe("database corruption recovery", () => {
  beforeEach(() => {
    harness.open.mockReset();
    harness.deleteDatabase.mockReset();
    harness.platform.OS = "ios";
    harness.failMove = false;
    harness.failFiles = false;
    harness.moves.length = 0;
    harness.deletes.length = 0;
    harness.files.clear();
    harness.contents.clear();
    harness.files.add("documents/SQLite/helix.db");
    harness.files.add("documents/SQLite/helix.db-wal");
    harness.files.add("documents/SQLite/helix.db-shm");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("moves a corrupt native database aside and opens a clean handle", async () => {
    const { acknowledgeDatabaseRecoveryNotice, getSqliteAsync, readDatabaseRecoveryNotice } = await load();
    const database = fakeDatabase();
    harness.open.mockRejectedValueOnce(corrupt()).mockResolvedValueOnce(database);
    vi.spyOn(Date, "now").mockReturnValue(1_786_262_400_000);

    await expect(getSqliteAsync()).resolves.toBe(database);

    expect(harness.open).toHaveBeenCalledTimes(2);
    expect(harness.moves).toEqual([[
      "documents/SQLite/helix.db",
      "documents/SQLite/helix.corrupt-1786262400000.db",
    ]]);
    expect(harness.deletes).toEqual([
      "documents/SQLite/helix.db-wal",
      "documents/SQLite/helix.db-shm",
    ]);
    expect(harness.deleteDatabase).not.toHaveBeenCalled();

    await expect(readDatabaseRecoveryNotice()).resolves.toEqual({
      recoveredAt: 1_786_262_400_000,
      preservedFileName: "helix.corrupt-1786262400000.db",
      platform: "native",
    });
    expect(harness.files.has(MARKER)).toBe(true);

    acknowledgeDatabaseRecoveryNotice();
    await expect(readDatabaseRecoveryNotice()).resolves.toBeNull();
    expect(harness.files.has(MARKER)).toBe(false);
  });

  it("opens with WAL and foreign keys on native, and foreign keys alone on web", async () => {
    const native = fakeDatabase();
    harness.open.mockResolvedValueOnce(native);
    await (await load()).getSqliteAsync();
    expect(harness.open).toHaveBeenCalledWith("helix.db", { enableChangeListener: true });
    expect(native.execAsync.mock.calls).toEqual([["PRAGMA journal_mode = WAL;"], ["PRAGMA foreign_keys = ON;"]]);

    harness.platform.OS = "web";
    const web = fakeDatabase();
    harness.open.mockResolvedValueOnce(web);
    await (await load()).getSqliteAsync();
    expect(web.execAsync.mock.calls).toEqual([["PRAGMA foreign_keys = ON;"]]);
  });

  it("shares one handle between callers", async () => {
    const { getSqliteAsync } = await load();
    const database = fakeDatabase();
    harness.open.mockResolvedValue(database);
    const first = getSqliteAsync();
    expect(getSqliteAsync()).toBe(first);
    await first;
    await getSqliteAsync();
    expect(harness.open).toHaveBeenCalledTimes(1);
  });

  it("backs off while a previous page still holds the file, then forgets a final failure", async () => {
    vi.useFakeTimers();
    const { getSqliteAsync } = await load();
    const held = new Error("access handle is locked");
    harness.open.mockRejectedValue(held);

    const opening = getSqliteAsync();
    const outcome = opening.then(() => "opened", (error: unknown) => error);
    expect(harness.open).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(149);
    expect(harness.open).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.open).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(299);
    expect(harness.open).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.open).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(150 * (3 + 4 + 5 + 6));
    await expect(outcome).resolves.toBe(held);
    expect(harness.open).toHaveBeenCalledTimes(6);
    expect(harness.moves).toEqual([]);

    const database = fakeDatabase();
    harness.open.mockResolvedValueOnce(database);
    await expect(getSqliteAsync()).resolves.toBe(database);
  });

  it("recognises corruption by code, by either message, or by a thrown string — and sets aside only once", async () => {
    for (const failure of [
      Object.assign(new Error("disk I/O"), { code: "SQLITE_CORRUPT" }),
      new Error("file is not a database"),
      "Database disk image is malformed",
    ]) {
      harness.moves.length = 0;
      harness.files.add("documents/SQLite/helix.db");
      const database = fakeDatabase();
      harness.open.mockReset().mockRejectedValueOnce(failure).mockResolvedValueOnce(database);
      await expect((await load()).getSqliteAsync()).resolves.toBe(database);
      expect(harness.moves, String(failure)).toHaveLength(1);
      expect(harness.open).toHaveBeenCalledTimes(2);
    }

    vi.useFakeTimers();
    harness.moves.length = 0;
    harness.files.add("documents/SQLite/helix.db");
    const database = fakeDatabase();
    harness.open.mockReset()
      .mockRejectedValueOnce(corrupt())
      .mockImplementationOnce(async () => {
        harness.files.add("documents/SQLite/helix.db");
        throw corrupt();
      })
      .mockResolvedValueOnce(database);
    const opening = (await load()).getSqliteAsync();
    await vi.advanceTimersByTimeAsync(300);
    await expect(opening).resolves.toBe(database);
    expect(harness.moves).toHaveLength(1);
  });

  it("backs off after a rejection that carries nothing", async () => {
    vi.useFakeTimers();
    const database = fakeDatabase();
    harness.open.mockRejectedValueOnce(null).mockResolvedValueOnce(database);
    const opening = (await load()).getSqliteAsync();
    await vi.advanceTimersByTimeAsync(150);
    await expect(opening).resolves.toBe(database);
    expect(harness.moves).toEqual([]);
  });

  it("records nothing preserved when there was no file or it could not be moved", async () => {
    harness.files.clear();
    const clean = fakeDatabase();
    harness.open.mockRejectedValueOnce(corrupt()).mockResolvedValueOnce(clean);
    let client = await load();
    await client.getSqliteAsync();
    expect(harness.moves).toEqual([]);
    expect(harness.deletes).toEqual([]);
    expect(harness.deleteDatabase).not.toHaveBeenCalled();
    expect((await client.readDatabaseRecoveryNotice())?.preservedFileName).toBeNull();

    harness.files.add("documents/SQLite/helix.db");
    harness.failMove = true;
    harness.open.mockRejectedValueOnce(corrupt()).mockResolvedValueOnce(fakeDatabase());
    client = await load();
    await client.getSqliteAsync();
    expect(harness.deleteDatabase).toHaveBeenCalledWith("helix.db");
    expect(await client.readDatabaseRecoveryNotice()).toEqual(expect.objectContaining({
      preservedFileName: null,
      platform: "native",
    }));
  });

  it("deletes a corrupt web database and keeps the notice in memory only", async () => {
    harness.platform.OS = "web";
    vi.spyOn(Date, "now").mockReturnValue(1_786_262_400_000);
    harness.open.mockRejectedValueOnce(corrupt()).mockResolvedValueOnce(fakeDatabase());
    const { acknowledgeDatabaseRecoveryNotice, getSqliteAsync, readDatabaseRecoveryNotice } = await load();
    await getSqliteAsync();

    expect(harness.deleteDatabase).toHaveBeenCalledWith("helix.db");
    expect(harness.moves).toEqual([]);
    expect(harness.files.has(MARKER)).toBe(false);
    await expect(readDatabaseRecoveryNotice()).resolves.toEqual({
      recoveredAt: 1_786_262_400_000,
      preservedFileName: null,
      platform: "web",
    });
    harness.files.add(MARKER);
    harness.contents.set(MARKER, JSON.stringify({ recoveredAt: 1, preservedFileName: null, platform: "native" }));
    acknowledgeDatabaseRecoveryNotice();
    await expect(readDatabaseRecoveryNotice()).resolves.toBeNull();
    expect(harness.files.has(MARKER)).toBe(true);
  });

  it("reads a notice a previous launch left, and refuses one it cannot trust", async () => {
    const { acknowledgeDatabaseRecoveryNotice, readDatabaseRecoveryNotice } = await load();
    await expect(readDatabaseRecoveryNotice()).resolves.toBeNull();
    acknowledgeDatabaseRecoveryNotice();
    expect(harness.deletes).toEqual([]);

    const valid = { recoveredAt: 1_786_262_400_000, preservedFileName: null, platform: "web" };
    harness.contents.set(MARKER, JSON.stringify(valid));
    harness.files.add(MARKER);
    await expect(readDatabaseRecoveryNotice()).resolves.toEqual(valid);

    for (const refused of [
      "not json",
      "null",
      "7",
      JSON.stringify({ ...valid, recoveredAt: 1.5 }),
      JSON.stringify({ ...valid, recoveredAt: "1786262400000" }),
      JSON.stringify({ ...valid, preservedFileName: 12 }),
      JSON.stringify({ ...valid, platform: "desktop" }),
    ]) {
      harness.contents.set(MARKER, refused);
      await expect(readDatabaseRecoveryNotice(), refused).resolves.toBeNull();
    }
    harness.contents.set(MARKER, JSON.stringify({ ...valid, preservedFileName: "helix.corrupt-1.db", platform: "native" }));
    await expect(readDatabaseRecoveryNotice()).resolves.toEqual(expect.objectContaining({ platform: "native" }));

    harness.failFiles = true;
    await expect(readDatabaseRecoveryNotice()).resolves.toBeNull();
  });

  it("keeps the in-memory notice when the marker cannot be written or removed", async () => {
    harness.failFiles = true;
    harness.open.mockRejectedValueOnce(corrupt()).mockResolvedValueOnce(fakeDatabase());
    const { acknowledgeDatabaseRecoveryNotice, getSqliteAsync, readDatabaseRecoveryNotice } = await load();
    await getSqliteAsync();
    expect(harness.deleteDatabase).toHaveBeenCalledWith("helix.db");
    await expect(readDatabaseRecoveryNotice()).resolves.toEqual(expect.objectContaining({ platform: "native" }));
    expect(() => acknowledgeDatabaseRecoveryNotice()).not.toThrow();
    harness.failFiles = false;
    await expect(readDatabaseRecoveryNotice()).resolves.toBeNull();
  });

  it("runs transactions one after another, and a failed one does not stall the next", async () => {
    const { withTransaction } = await load();
    const database = fakeDatabase();
    harness.open.mockResolvedValue(database);
    const order: string[] = [];
    let finishFirst!: () => void;

    const first = withTransaction(async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => (finishFirst = resolve));
      order.push("first:end");
      throw new Error("first failed");
    });
    const second = withTransaction(async () => {
      order.push("second");
    });
    await vi.waitFor(() => expect(order).toEqual(["first:start"]));
    finishFirst();
    await expect(first).rejects.toThrow("first failed");
    await second;
    expect(order).toEqual(["first:start", "first:end", "second"]);
    expect(database.withTransactionAsync).toHaveBeenCalledTimes(2);
  });

  it("serves drizzle's run, all and get through the async driver", async () => {
    const { getDb } = await load();
    const { sql } = await import("drizzle-orm");
    const database = fakeDatabase();
    const finalize = vi.fn(async () => undefined);
    let rows: unknown[][] = [["a", 1], ["b", 2]];
    database.prepareAsync.mockImplementation(async () => ({
      executeForRawResultAsync: vi.fn(async () => ({ getAllAsync: async () => rows })),
      finalizeAsync: finalize,
    }));
    harness.open.mockResolvedValue(database);

    await expect(getDb().run(sql`DELETE FROM persons WHERE id = ${"p1"}`)).resolves.toEqual({ rows: [] });
    expect(database.runAsync).toHaveBeenCalledWith("DELETE FROM persons WHERE id = ?", ["p1"]);
    expect(database.prepareAsync).not.toHaveBeenCalled();

    await expect(getDb().values(sql`SELECT name, n FROM t`)).resolves.toEqual([["a", 1], ["b", 2]]);
    await expect(getDb().get(sql`SELECT name, n FROM t`)).resolves.toEqual(["a", 1]);
    rows = [];
    await expect(getDb().get(sql`SELECT name, n FROM t`)).resolves.toEqual([]);
    expect(finalize).toHaveBeenCalledTimes(3);
  });

  it("releases the web handle when the page goes away", async () => {
    harness.platform.OS = "web";
    const page = new EventTarget();
    vi.stubGlobal("window", page);
    const { getSqliteAsync } = await load();
    page.dispatchEvent(new Event("pagehide"));
    for (const event of ["pagehide", "beforeunload"]) {
      const database = fakeDatabase();
      harness.open.mockResolvedValueOnce(database);
      await getSqliteAsync();
      page.dispatchEvent(new Event(event));
      await vi.waitFor(() => expect(database.closeAsync).toHaveBeenCalledTimes(1));
    }
    const reopened = fakeDatabase();
    harness.open.mockResolvedValueOnce(reopened);
    await expect(getSqliteAsync()).resolves.toBe(reopened);
  });

  it("leaves a native handle open whatever the page does", async () => {
    const page = new EventTarget();
    vi.stubGlobal("window", page);
    const database = fakeDatabase();
    harness.open.mockResolvedValueOnce(database);
    const { getSqliteAsync } = await load();
    await getSqliteAsync();
    page.dispatchEvent(new Event("pagehide"));
    await expect(getSqliteAsync()).resolves.toBe(database);
    expect(database.closeAsync).not.toHaveBeenCalled();
  });
});
