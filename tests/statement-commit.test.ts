/**
 * Committing accepted statement rows.
 *
 * Runs against a real SQLite database with the real migrations, because the
 * two properties that matter — deterministic identity and all-or-nothing —
 * are properties of the write, not of a mock.
 */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null, failWrites: false }));

vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => ({
    getFirstAsync: async (sql: string, args: unknown[] = []) =>
      harness.db!.prepare(sql).get(...(args as never[])) ?? null,
    getAllAsync: async (sql: string, args: unknown[] = []) => harness.db!.prepare(sql).all(...(args as never[])),
    runAsync: async (sql: string, args: unknown[] = []) => {
      // Injected failure: the statement must roll back as one unit.
      if (harness.failWrites && sql.trim().toUpperCase().startsWith("INSERT INTO TRANSACTIONS")) {
        throw new Error("injected write failure");
      }
      return { changes: Number(harness.db!.prepare(sql).run(...(args as never[])).changes) };
    },
  }),
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
  newId: () => "unused",
  // A real digest, not a truncation: a slicing mock made two different
  // statement lines share an id and hid the very collision this file checks.
  deterministicId: async (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 32),
  naturalKeys: new Proxy({}, {
    get: (_target, property) => (...parts: unknown[]) => `${String(property)}|${parts.join("|")}`,
  }),
}));
vi.mock("../src/sync/engine", () => ({ scheduleSync: vi.fn() }));

import { commitStatementRows, type AcceptedStatementRow } from "../src/data/repo/statement-import";
import { migrationStatements } from "./helpers";

const USER = "statement-user";
const NOW = "2026-08-18T09:00:00.000Z";

function seed(): void {
  harness.db!.prepare(
    `INSERT INTO persons (id, user_id, created_at, updated_at, deleted_at, tombstone_version, name, is_self)
     VALUES ('person-self', ?, ?, ?, NULL, 0, 'Ben', 1)`,
  ).run(USER, NOW, NOW);
  harness.db!.prepare(
    `INSERT INTO categories (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       name, kind, sort_order, is_column, is_transfer)
     VALUES ('cat-1', ?, ?, ?, NULL, 0, 'Market', 'expense', 0, 1, 0)`,
  ).run(USER, NOW, NOW);
}

const liveRows = () =>
  harness.db!.prepare(`SELECT * FROM transactions WHERE user_id = ? AND deleted_at IS NULL`).all(USER) as
    Record<string, unknown>[];

const row = (over: Partial<AcceptedStatementRow> = {}): AcceptedStatementRow => ({
  importKey: "stmt|2026-08|2026-08-12|migros market|123456|",
  date: "2026-08-12",
  description: "MIGROS MARKET",
  amountMinor: 123_456,
  isRefund: false,
  categoryId: "cat-1",
  paymentSourceId: null,
  ...over,
});

describe("committing accepted statement rows", () => {
  beforeEach(() => {
    harness.db = new DatabaseSync(":memory:");
    for (const statement of migrationStatements) harness.db.exec(statement);
    harness.failWrites = false;
    seed();
  });

  it("writes an accepted row with its origin and source identity", async () => {
    const result = await commitStatementRows(USER, "person-self", [row()]);
    expect(result.writtenIds).toHaveLength(1);
    expect(result.skipped).toBe(0);
    const [written] = liveRows();
    expect(written).toMatchObject({
      origin: "statement",
      import_key: row().importKey,
      amount_try_minor: 123_456,
      effective_date: "2026-08-12",
      status: "realized",
      note: "MIGROS MARKET",
    });
  });

  /** The whole point of a deterministic id: the second import adds nothing. */
  it("is idempotent when the same statement is imported again", async () => {
    await commitStatementRows(USER, "person-self", [row()]);
    const second = await commitStatementRows(USER, "person-self", [row()]);
    expect(second.writtenIds).toEqual([]);
    expect(second.skipped).toBe(1);
    expect(liveRows()).toHaveLength(1);
  });

  /**
   * A repeat is skipped rather than overwritten: overwriting would discard an
   * edit the owner made to that transaction after the first import.
   */
  it("does not overwrite an edit made after the first import", async () => {
    await commitStatementRows(USER, "person-self", [row()]);
    harness.db!.prepare(`UPDATE transactions SET note = 'benim notum' WHERE user_id = ?`).run(USER);
    await commitStatementRows(USER, "person-self", [row({ description: "MIGROS MARKET" })]);
    expect(liveRows()[0]?.note).toBe("benim notum");
  });

  it("keeps two genuinely different lines apart", async () => {
    const result = await commitStatementRows(USER, "person-self", [
      row(),
      row({ importKey: "stmt|2026-08|2026-08-12|kahve|8990|", description: "KAHVE", amountMinor: 8_990 }),
    ]);
    expect(result.writtenIds).toHaveLength(2);
    expect(liveRows()).toHaveLength(2);
  });

  it("records a refund as a negative expense in its own category", async () => {
    await commitStatementRows(USER, "person-self", [row({ isRefund: true })]);
    expect(liveRows()[0]).toMatchObject({ type: "expense", amount_try_minor: -123_456, category_id: "cat-1" });
  });

  /**
   * A half-imported statement is indistinguishable from a complete one, so a
   * failure anywhere has to leave the ledger exactly as it was.
   */
  it("writes nothing at all when any row fails", async () => {
    harness.failWrites = true;
    await expect(commitStatementRows(USER, "person-self", [
      row(),
      row({ importKey: "stmt|other", description: "KAHVE", amountMinor: 8_990 }),
    ])).rejects.toThrow(/injected write failure/u);
    expect(liveRows()).toEqual([]);
  });

  it("refuses a row whose category is not a live category of this account", async () => {
    await expect(commitStatementRows(USER, "person-self", [row({ categoryId: "missing" })])).rejects.toThrow();
    expect(liveRows()).toEqual([]);
  });

  it("refuses a person who is not a live person of this account", async () => {
    await expect(commitStatementRows(USER, "ghost", [row()])).rejects.toThrow();
    expect(liveRows()).toEqual([]);
  });

  it("refuses a non-positive amount rather than storing a zero charge", async () => {
    await expect(commitStatementRows(USER, "person-self", [row({ amountMinor: 0 })])).rejects.toThrow();
    expect(liveRows()).toEqual([]);
  });

  it("does nothing, successfully, when nothing was accepted", async () => {
    await expect(commitStatementRows(USER, "person-self", [])).resolves.toEqual({ writtenIds: [], skipped: 0 });
  });
});
