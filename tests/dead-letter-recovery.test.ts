/**
 * The owner-facing retry must use the current local row, not the rejected raw
 * payload. This exercises the real write layer and migration schema so a
 * future change cannot turn the recovery button into a data-dropping delete.
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null }));

vi.mock("../src/db/client", async () => {
  const { sqliteClientMock } = await import("./helpers");
  return sqliteClientMock(() => harness.db!);
});

vi.mock("../src/db/ids", () => ({
  deterministicId: async (key: string) => `det:${key}`,
  naturalKeys: new Proxy({}, { get: (_target, property) => (...parts: unknown[]) => `${String(property)}|${parts.join("|")}` }),
}));

const { discardSyncDeadLetter, requeueSyncDeadLetter } = await import("../src/db/mutations");

const migrationsDir = join(process.cwd(), "src/db/migrations");
const migrations = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
  .flatMap((name) => readFileSync(join(migrationsDir, name), "utf8").split("--> statement-breakpoint"))
  .map((statement) => statement.trim())
  .filter(Boolean);

const USER = "10000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000002";

/**
 * Real uuids, because the retry now runs the push's own validator and that
 * validator checks the id. The fixture used to say "tx-1", which no row this
 * app writes has ever looked like — `uuidv7` and `deterministicId` both produce
 * uuids — so a synthetic id was the one thing standing between this suite and
 * the check it exists to exercise.
 */
const TX = {
  one: "30000000-0000-4000-8000-000000000001",
  bad: "30000000-0000-4000-8000-000000000002",
  fixed: "30000000-0000-4000-8000-000000000003",
  foreign: "30000000-0000-4000-8000-000000000004",
  gone: "30000000-0000-4000-8000-00000000000f",
} as const;

function insertDeadLetter(id: number, tableName: string, rowId: string): void {
  harness.db!.prepare(`
    INSERT INTO sync_dead_letters (outbox_id, table_name, row_id, payload, reason, quarantined_at)
    VALUES (?, ?, ?, ?, 'invalid_row', '2026-08-09T00:00:00.000Z')
  `).run(id, tableName, rowId, "{\"amount_minor\":\"not-a-number\"}");
}

function insertTransaction(userId: string, id: string, amountMinor: unknown = 10000): void {
  harness.db!.prepare(`
    INSERT INTO transactions (
      id, user_id, created_at, updated_at, deleted_at, tombstone_version,
      type, amount_minor, currency, amount_try_minor, entry_date, effective_date,
      status, category_id, payment_source_id, person_id, installment_plan_id,
      installment_no, card_statement_id, subscription_id, is_aggregate, note
    ) VALUES (?, ?, '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z', NULL, 0,
      'expense', ?, 'TRY', 10000, '2026-08-09', '2026-08-09', 'realized',
      NULL, NULL, ?, NULL, NULL, NULL, NULL, 0, 'yerel kayıt')
  `).run(id, userId, amountMinor as never, OTHER);
}

beforeEach(() => {
  harness.db = new DatabaseSync(":memory:");
  for (const migration of migrations) harness.db.exec(migration);
});

describe("dead-letter recovery", () => {
  it("requeues the current owned row and removes only its old quarantine", async () => {
    insertTransaction(USER, TX.one);
    insertDeadLetter(1, "transactions", TX.one);

    await expect(requeueSyncDeadLetter(USER, 1)).resolves.toBe("requeued");
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM sync_dead_letters").get()).toEqual({ n: 0 });
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox WHERE row_id = ?").get(TX.one)).toEqual({ n: 1 });
    expect(harness.db!.prepare("SELECT payload FROM outbox WHERE row_id = ?").get(TX.one)).toMatchObject({
      payload: expect.stringContaining('"note":"yerel kayıt"'),
    });
  });

  it("reports a dead letter that is not there rather than throwing", async () => {
    await expect(requeueSyncDeadLetter(USER, 999)).resolves.toBe("missing");
  });

  /**
   * A repair is not something the user typed.
   *
   * `writeRows` bumps `last_entry_at` for a user entry, and that timestamp is
   * what the catch-up banner reads. Requeueing a quarantined row would
   * otherwise tell the app the owner had just entered something.
   */
  it("does not count as a user entry", async () => {
    insertTransaction(USER, TX.one);
    insertDeadLetter(1, "transactions", TX.one);

    await requeueSyncDeadLetter(USER, 1);
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 1 });
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM settings").get()).toEqual({ n: 0 });
  });

  it("keeps a quarantine when its local row is gone", async () => {
    insertDeadLetter(1, "transactions", "missing");

    await expect(requeueSyncDeadLetter(USER, 1)).resolves.toBe("missing");
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM sync_dead_letters").get()).toEqual({ n: 1 });
  });

  it("cannot requeue a row belonging to another account", async () => {
    insertTransaction(OTHER, TX.foreign);
    insertDeadLetter(1, "transactions", TX.foreign);

    await expect(requeueSyncDeadLetter(USER, 1)).resolves.toBe("missing");
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM sync_dead_letters").get()).toEqual({ n: 1 });
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("refuses a table name outside the synced allow-list", async () => {
    insertDeadLetter(1, "users", "user-1");

    await expect(requeueSyncDeadLetter(USER, 1)).resolves.toBe("unsupported");
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM sync_dead_letters").get()).toEqual({ n: 1 });
  });

  /**
   * The loop the owner reported.
   *
   * A quarantine means the server refused the row. Queueing the SAME row again
   * meant the next push refused it for the same reason and quarantined it
   * again, so "Yeniden Dene" could only ever produce another error. The retry
   * now runs the push's own validator first and says the row itself is the
   * problem, without spending an outbox event on it.
   */
  it("does not requeue a row the push would refuse again", async () => {
    // A text amount is exactly what `convertOutboundRow` refuses, and exactly
    // what a corrupt row carries.
    insertTransaction(USER, TX.bad, "not-a-number");
    insertDeadLetter(1, "transactions", TX.bad);

    await expect(requeueSyncDeadLetter(USER, 1)).resolves.toBe("unrepairable");
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
    // The clue stays: it is the only local record that this happened.
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM sync_dead_letters").get()).toEqual({ n: 1 });
  });

  it("still requeues a row that has since been repaired", async () => {
    insertTransaction(USER, TX.fixed, "not-a-number");
    insertDeadLetter(1, "transactions", TX.fixed);
    await expect(requeueSyncDeadLetter(USER, 1)).resolves.toBe("unrepairable");

    harness.db!.prepare("UPDATE transactions SET amount_minor = 2500 WHERE id = ?").run(TX.fixed);
    await expect(requeueSyncDeadLetter(USER, 1)).resolves.toBe("requeued");
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox WHERE row_id = ?").get(TX.fixed)).toEqual({ n: 1 });
  });

  it("writes nothing at all when the answer is that the row cannot be sent", async () => {
    // `convertOutboundRow` COERCES the row it is handed — booleans especially —
    // so it is given a copy. A refusal must leave the database exactly as it
    // was: no write, no stamp, no outbox event.
    insertTransaction(USER, TX.bad, "not-a-number");
    insertDeadLetter(1, "transactions", TX.bad);
    const before = harness.db!.prepare("SELECT * FROM transactions WHERE id = ?").get(TX.bad);

    await expect(requeueSyncDeadLetter(USER, 1)).resolves.toBe("unrepairable");
    expect(harness.db!.prepare("SELECT * FROM transactions WHERE id = ?").get(TX.bad)).toEqual(before);
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("changes only the timestamp on the row it does requeue", async () => {
    insertTransaction(USER, TX.one);
    insertDeadLetter(1, "transactions", TX.one);
    const before = harness.db!.prepare("SELECT * FROM transactions WHERE id = ?").get(TX.one) as Record<string, unknown>;

    await requeueSyncDeadLetter(USER, 1);
    const after = harness.db!.prepare("SELECT * FROM transactions WHERE id = ?").get(TX.one) as Record<string, unknown>;
    // `updated_at` moves because the requeue IS a write — that is what makes it
    // a fresh outbox event. Nothing the user entered may move with it.
    expect(after.updated_at).not.toBe(before.updated_at);
    expect({ ...after, updated_at: null }).toEqual({ ...before, updated_at: null });
  });
});

/**
 * A quarantine whose row is gone had no exit at all: the retry answered
 * "missing" for ever and the panel never cleared. Forgetting the CLUE is not
 * forgetting the record — there is nothing here that deletes a row.
 */
describe("forgetting a quarantine", () => {
  it("removes the clue and reports that there was one", async () => {
    insertDeadLetter(1, "transactions", TX.gone);

    await expect(discardSyncDeadLetter(1)).resolves.toBe(true);
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM sync_dead_letters").get()).toEqual({ n: 0 });
  });

  it("reports nothing to forget rather than claiming success", async () => {
    await expect(discardSyncDeadLetter(404)).resolves.toBe(false);
  });

  it("never touches the row the clue points at", async () => {
    insertTransaction(USER, TX.one);
    insertDeadLetter(1, "transactions", TX.one);

    await discardSyncDeadLetter(1);
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM transactions WHERE id = ?").get(TX.one)).toEqual({ n: 1 });
  });

  it("forgets only the one it was asked about", async () => {
    insertDeadLetter(1, "transactions", "a");
    insertDeadLetter(2, "transactions", "b");

    await discardSyncDeadLetter(1);
    expect(harness.db!.prepare("SELECT outbox_id AS id FROM sync_dead_letters").all()).toEqual([{ id: 2 }]);
  });
});
