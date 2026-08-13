import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  db: null as DatabaseSync | null,
  dbAcquisitions: 0,
  nextId: 0,
}));

vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => {
    harness.dbAcquisitions += 1;
    return {
      getFirstAsync: async (sql: string, args: unknown[] = []) =>
        harness.db!.prepare(sql).get(...(args as never[])) ?? null,
      getAllAsync: async (sql: string, args: unknown[] = []) =>
        harness.db!.prepare(sql).all(...(args as never[])),
      runAsync: async (sql: string, args: unknown[] = []) => ({
        changes: Number(harness.db!.prepare(sql).run(...(args as never[])).changes),
      }),
    };
  },
  withTransaction: async (task: () => Promise<void>) => {
    harness.db!.exec("BEGIN");
    try {
      await task();
      harness.db!.exec("COMMIT");
    } catch (error) {
      harness.db!.exec("ROLLBACK");
      throw error;
    }
  },
}));

vi.mock("../src/db/ids", () => ({
  newId: () => `computed-${String(++harness.nextId).padStart(2, "0")}`,
  deterministicId: async (key: string) => `det:${key}`,
  naturalKeys: new Proxy(
    {},
    {
      get:
        (_target, property) =>
        (...parts: unknown[]) =>
          `${String(property)}:${parts.join(":")}`,
    },
  ),
}));

import {
  deleteComputedColumn,
  reorderComputedColumns,
  restoreComputedColumn,
  saveComputedColumn,
  setComputedColumnsHidden,
} from "../src/data/repo/computed";
import { fromDbShape } from "../src/db/mutations";

const USER = "computed-user";
const OTHER_USER = "other-user";
const NOW = "2026-08-13T09:00:00.000Z";
const migrationsDir = join(process.cwd(), "src/db/migrations");
const migrationSql = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
  .flatMap((name) =>
    readFileSync(join(migrationsDir, name), "utf8").split(
      "--> statement-breakpoint",
    ),
  )
  .map((statement) => statement.trim())
  .filter(Boolean);

type ComputedColumnRow = Parameters<typeof reorderComputedColumns>[1][number];

function rawColumn(id: string): Record<string, unknown> {
  return harness.db!.prepare("SELECT * FROM computed_columns WHERE id = ?").get(id) as Record<string, unknown>;
}

function columnInputRow(id: string): ComputedColumnRow {
  return fromDbShape("computed_columns", rawColumn(id)) as ComputedColumnRow;
}

function tableOutbox(table: string): Record<string, unknown>[] {
  return harness.db!.prepare(
    "SELECT row_id, payload FROM outbox WHERE table_name = ? ORDER BY id",
  ).all(table) as Record<string, unknown>[];
}

function clearOutbox(): void {
  harness.db!.exec("DELETE FROM outbox");
}

function insertColumn(
  id: string,
  sortOrder: number,
  userId = USER,
  deletedAt: string | null = null,
): void {
  harness.db!.prepare(
    `INSERT INTO computed_columns
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       name, definition, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    NOW,
    NOW,
    deletedAt,
    deletedAt ? 1 : 0,
    `Column ${id}`,
    JSON.stringify({ op: "income_minus_expense" }),
    sortOrder,
  );
}

describe("computed-column repository persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    harness.dbAcquisitions = 0;
    harness.nextId = 0;
    harness.db = new DatabaseSync(":memory:");
    for (const statement of migrationSql) harness.db.exec(statement);
  });

  afterEach(() => {
    harness.db?.close();
    harness.db = null;
    vi.useRealTimers();
  });

  it("rejects blank, over-limit and invalid definitions before acquiring persistence", async () => {
    const invalidInputs = [
      {
        input: { name: "   ", definition: { op: "income_minus_expense" } as const, sortOrder: 0 },
        message: "Computed column name is required",
      },
      {
        input: { name: "x".repeat(121), definition: { op: "income_minus_expense" } as const, sortOrder: 0 },
        message: "text input exceeds its maximum length",
      },
      {
        input: { name: "Unsafe", definition: { op: "eval", code: "1 + 1" } as never, sortOrder: 0 },
        message: "Invalid discriminator value",
      },
    ];

    for (const { input, message } of invalidInputs) {
      await expect(saveComputedColumn(USER, input)).rejects.toThrow(message);
    }

    expect(harness.dbAcquisitions).toBe(0);
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM computed_columns").get()).toEqual({ n: 0 });
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("creates and updates normalized owned rows with parsed definitions and exact outbox payloads", async () => {
    const id = await saveComputedColumn(USER, {
      name: "  Aylık fark  ",
      definition: {
        op: "difference",
        plusCategoryIds: ["income-a", "income-b"],
        minusCategoryIds: ["expense-a"],
      },
      sortOrder: 7,
    });

    expect(id).toBe("computed-01");
    expect(rawColumn(id)).toMatchObject({
      id,
      user_id: USER,
      created_at: NOW,
      updated_at: NOW,
      deleted_at: null,
      tombstone_version: 0,
      name: "Aylık fark",
      definition: JSON.stringify({
        op: "difference",
        plusCategoryIds: ["income-a", "income-b"],
        minusCategoryIds: ["expense-a"],
      }),
      sort_order: 7,
    });
    expect(tableOutbox("computed_columns")).toEqual([{
      row_id: id,
      payload: expect.any(String),
    }]);
    expect(JSON.parse(String(tableOutbox("computed_columns")[0]!.payload))).toMatchObject({
      id,
      user_id: USER,
      name: "Aylık fark",
      definition: JSON.stringify({
        op: "difference",
        plusCategoryIds: ["income-a", "income-b"],
        minusCategoryIds: ["expense-a"],
      }),
      sort_order: 7,
      deleted_at: null,
    });

    clearOutbox();
    vi.setSystemTime(new Date("2026-08-13T09:01:00.000Z"));
    const updatedId = await saveComputedColumn(USER, {
      id,
      name: "  Net nakit  ",
      definition: { op: "cc_split", part: "installment" },
      sortOrder: 3,
    });

    expect(updatedId).toBe(id);
    expect(rawColumn(id)).toMatchObject({
      id,
      user_id: USER,
      created_at: NOW,
      updated_at: "2026-08-13T09:01:00.000Z",
      deleted_at: null,
      tombstone_version: 0,
      name: "Net nakit",
      definition: JSON.stringify({ op: "cc_split", part: "installment" }),
      sort_order: 3,
    });
    expect(tableOutbox("computed_columns")).toHaveLength(1);
    expect(JSON.parse(String(tableOutbox("computed_columns")[0]!.payload))).toMatchObject({
      id,
      name: "Net nakit",
      definition: JSON.stringify({ op: "cc_split", part: "installment" }),
      sort_order: 3,
    });
  });

  it("rejects foreign and tombstoned updates without changing rows or emitting outbox events", async () => {
    insertColumn("foreign-column", 8, OTHER_USER);
    insertColumn("deleted-column", 9, USER, "2026-08-12T09:00:00.000Z");
    const foreignBefore = rawColumn("foreign-column");
    const deletedBefore = rawColumn("deleted-column");

    for (const [userId, id] of [
      [USER, "foreign-column"],
      [USER, "deleted-column"],
    ] as const) {
      await expect(saveComputedColumn(userId, {
        id,
        name: "Changed",
        definition: { op: "income_minus_expense" },
        sortOrder: 0,
      })).rejects.toThrow("Cannot edit missing computed_columns row");
    }

    expect(rawColumn("foreign-column")).toEqual(foreignBefore);
    expect(rawColumn("deleted-column")).toEqual(deletedBefore);
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("tombstones and restores a computed column with generation-safe outbox snapshots", async () => {
    const id = await saveComputedColumn(USER, {
      name: "Toplam",
      definition: { op: "sum", categoryIds: ["food", "rent"] },
      sortOrder: 2,
    });
    clearOutbox();
    vi.setSystemTime(new Date("2026-08-13T09:02:00.000Z"));

    const snapshot = await deleteComputedColumn(USER, id);
    expect(snapshot).toMatchObject({
      id,
      user_id: USER,
      deleted_at: null,
      tombstone_version: 0,
      name: "Toplam",
    });
    expect(rawColumn(id)).toMatchObject({
      deleted_at: "2026-08-13T09:02:00.000Z",
      tombstone_version: 1,
    });
    expect(JSON.parse(String(tableOutbox("computed_columns")[0]!.payload))).toMatchObject({
      id,
      user_id: USER,
      deleted_at: "2026-08-13T09:02:00.000Z",
      tombstone_version: 1,
    });

    clearOutbox();
    vi.setSystemTime(new Date("2026-08-13T09:03:00.000Z"));
    await restoreComputedColumn(USER, snapshot!);
    expect(rawColumn(id)).toMatchObject({
      created_at: NOW,
      updated_at: "2026-08-13T09:03:00.000Z",
      deleted_at: null,
      tombstone_version: 1,
      name: "Toplam",
      definition: JSON.stringify({ op: "sum", categoryIds: ["food", "rent"] }),
      sort_order: 2,
    });
    expect(JSON.parse(String(tableOutbox("computed_columns")[0]!.payload))).toMatchObject({
      id,
      user_id: USER,
      deleted_at: null,
      tombstone_version: 1,
    });
  });

  it("rejects foreign, missing and already-live restore snapshots without writes", async () => {
    insertColumn("foreign-tombstone", 1, OTHER_USER, "2026-08-12T09:00:00.000Z");
    const foreignSnapshot = rawColumn("foreign-tombstone");
    await expect(restoreComputedColumn(USER, foreignSnapshot)).rejects.toThrow(
      "Cannot restore computed_columns row from another account",
    );

    const missingSnapshot = {
      ...foreignSnapshot,
      id: "missing-tombstone",
      user_id: USER,
    };
    await expect(restoreComputedColumn(USER, missingSnapshot)).rejects.toThrow(
      "Cannot restore computed_columns row without its tombstone",
    );

    insertColumn("live-column", 2);
    await expect(restoreComputedColumn(USER, {
      ...rawColumn("live-column"),
      deleted_at: "2026-08-12T09:00:00.000Z",
    })).rejects.toThrow("Cannot restore computed_columns row without its tombstone");

    expect(rawColumn("foreign-tombstone").deleted_at).toBe("2026-08-12T09:00:00.000Z");
    expect(rawColumn("live-column").deleted_at).toBeNull();
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("serializes the ordered unique hidden ids into one deterministic setting write", async () => {
    await setComputedColumnsHidden(USER, ["column-b", "column-a", "column-b", "column-c", "column-a"]);

    expect(harness.db!.prepare(
      "SELECT id, user_id, key, value, deleted_at FROM settings WHERE key = 'computed_columns_hidden'",
    ).get()).toEqual({
      id: `det:setting:${USER}:computed_columns_hidden`,
      user_id: USER,
      key: "computed_columns_hidden",
      value: JSON.stringify(["column-b", "column-a", "column-c"]),
      deleted_at: null,
    });
    const settingsOutbox = tableOutbox("settings");
    expect(settingsOutbox).toHaveLength(1);
    expect(JSON.parse(String(settingsOutbox[0]!.payload))).toMatchObject({
      id: `det:setting:${USER}:computed_columns_hidden`,
      user_id: USER,
      key: "computed_columns_hidden",
      value: JSON.stringify(["column-b", "column-a", "column-c"]),
      deleted_at: null,
    });
  });

  it("reorders known ids into the input row slots while preserving every other field", async () => {
    insertColumn("column-a", 30);
    insertColumn("column-b", 10);
    insertColumn("column-c", 20);
    harness.db!.prepare("UPDATE computed_columns SET name = ? WHERE id = ?").run("Preserved", "column-c");
    const columns = ["column-a", "column-b", "column-c"].map(columnInputRow);

    await reorderComputedColumns(USER, columns, ["column-c", "column-a", "unknown-column"]);

    expect(harness.db!.prepare(
      "SELECT id, name, definition, sort_order FROM computed_columns ORDER BY id",
    ).all()).toEqual([
      {
        id: "column-a",
        name: "Column column-a",
        definition: JSON.stringify({ op: "income_minus_expense" }),
        sort_order: 10,
      },
      {
        id: "column-b",
        name: "Column column-b",
        definition: JSON.stringify({ op: "income_minus_expense" }),
        sort_order: 10,
      },
      {
        id: "column-c",
        name: "Preserved",
        definition: JSON.stringify({ op: "income_minus_expense" }),
        sort_order: 30,
      },
    ]);
    expect(tableOutbox("computed_columns").map((row) => row.row_id)).toEqual([
      "column-c",
      "column-a",
    ]);
    expect(tableOutbox("computed_columns").map((row) => {
      const payload = JSON.parse(String(row.payload)) as Record<string, unknown>;
      return { id: payload.id, name: payload.name, sortOrder: payload.sort_order };
    })).toEqual([
      { id: "column-c", name: "Preserved", sortOrder: 30 },
      { id: "column-a", name: "Column column-a", sortOrder: 10 },
    ]);
  });

  it("ignores unknown or exhausted ids and performs empty reorders without acquiring persistence", async () => {
    insertColumn("column-a", 4);
    insertColumn("column-b", 8);
    const columns = ["column-a", "column-b"].map(columnInputRow);
    const acquisitionsBefore = harness.dbAcquisitions;

    await reorderComputedColumns(USER, columns, []);
    await reorderComputedColumns(USER, columns, ["unknown-a", "unknown-b", "column-a"]);

    expect(harness.dbAcquisitions).toBe(acquisitionsBefore);
    expect(rawColumn("column-a").sort_order).toBe(4);
    expect(rawColumn("column-b").sort_order).toBe(8);
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("atomically rejects a reorder when any requested row is foreign or tombstoned", async () => {
    insertColumn("owned-column", 5);
    insertColumn("foreign-column", 15, OTHER_USER);
    insertColumn("deleted-column", 25, USER, "2026-08-12T09:00:00.000Z");
    const ownedBefore = rawColumn("owned-column");

    for (const rejectedId of ["foreign-column", "deleted-column"]) {
      const columns = [columnInputRow("owned-column"), columnInputRow(rejectedId)];
      await expect(
        reorderComputedColumns(USER, columns, ["owned-column", rejectedId]),
      ).rejects.toThrow("Cannot edit missing computed_columns row");
      expect(rawColumn("owned-column")).toEqual(ownedBefore);
      expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
    }
  });
});
