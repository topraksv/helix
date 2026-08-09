import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  open: vi.fn(),
  deleteDatabase: vi.fn(),
  moves: [] as Array<[string, string]>,
  deletes: [] as string[],
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
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
    get exists() { return true; }
    move(destination: File) { harness.moves.push([this.path, destination.path]); }
    delete() { harness.deletes.push(this.path); }
  }
  return { Directory, File, Paths: { document: "documents" } };
});

import { getSqliteAsync } from "../src/db/client";

describe("database corruption recovery", () => {
  beforeEach(() => {
    harness.open.mockReset();
    harness.deleteDatabase.mockReset();
    harness.moves.length = 0;
    harness.deletes.length = 0;
  });

  it("moves a corrupt native database aside and opens a clean handle", async () => {
    const database = { execAsync: vi.fn(async () => undefined) };
    harness.open
      .mockRejectedValueOnce(Object.assign(new Error("database disk image is malformed"), { code: "SQLITE_CORRUPT" }))
      .mockResolvedValueOnce(database);
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
  });
});
