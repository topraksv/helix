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

const { requeueSyncDeadLetter } = await import("../src/db/mutations");

const migrationsDir = join(process.cwd(), "src/db/migrations");
const migrations = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
  .flatMap((name) => readFileSync(join(migrationsDir, name), "utf8").split("--> statement-breakpoint"))
  .map((statement) => statement.trim())
  .filter(Boolean);

const USER = "10000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000002";

function insertDeadLetter(id: number, tableName: string, rowId: string): void {
  harness.db!.prepare(`
    INSERT INTO sync_dead_letters (outbox_id, table_name, row_id, payload, reason, quarantined_at)
    VALUES (?, ?, ?, ?, 'invalid_row', '2026-08-09T00:00:00.000Z')
  `).run(id, tableName, rowId, "{\"amount_minor\":\"not-a-number\"}");
}

function insertTransaction(userId: string, id: string): void {
  harness.db!.prepare(`
    INSERT INTO transactions (
      id, user_id, created_at, updated_at, deleted_at, tombstone_version,
      type, amount_minor, currency, amount_try_minor, entry_date, effective_date,
      status, category_id, payment_source_id, person_id, installment_plan_id,
      installment_no, card_statement_id, subscription_id, is_aggregate, note
    ) VALUES (?, ?, '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z', NULL, 0,
      'expense', 10000, 'TRY', 10000, '2026-08-09', '2026-08-09', 'realized',
      NULL, NULL, ?, NULL, NULL, NULL, NULL, 0, 'yerel kayıt')
  `).run(id, userId, OTHER);
}

beforeEach(() => {
  harness.db = new DatabaseSync(":memory:");
  for (const migration of migrations) harness.db.exec(migration);
});

describe("dead-letter recovery", () => {
  it("requeues the current owned row and removes only its old quarantine", async () => {
    insertTransaction(USER, "tx-1");
    insertDeadLetter(1, "transactions", "tx-1");

    await expect(requeueSyncDeadLetter(USER, 1)).resolves.toBe("requeued");
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM sync_dead_letters").get()).toEqual({ n: 0 });
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox WHERE row_id = 'tx-1'").get()).toEqual({ n: 1 });
    expect(harness.db!.prepare("SELECT payload FROM outbox WHERE row_id = 'tx-1'").get()).toMatchObject({
      payload: expect.stringContaining('"note":"yerel kayıt"'),
    });
  });

  it("keeps a quarantine when its local row is gone", async () => {
    insertDeadLetter(1, "transactions", "missing");

    await expect(requeueSyncDeadLetter(USER, 1)).resolves.toBe("missing");
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM sync_dead_letters").get()).toEqual({ n: 1 });
  });

  it("cannot requeue a row belonging to another account", async () => {
    insertTransaction(OTHER, "tx-foreign");
    insertDeadLetter(1, "transactions", "tx-foreign");

    await expect(requeueSyncDeadLetter(USER, 1)).resolves.toBe("missing");
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM sync_dead_letters").get()).toEqual({ n: 1 });
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("refuses a table name outside the synced allow-list", async () => {
    insertDeadLetter(1, "users", "user-1");

    await expect(requeueSyncDeadLetter(USER, 1)).resolves.toBe("unsupported");
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM sync_dead_letters").get()).toEqual({ n: 1 });
  });
});
