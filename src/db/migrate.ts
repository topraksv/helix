/**
 * Async migration runner over the drizzle-kit journal. Uses the same table
 * and timestamp bookkeeping as drizzle's own migrator (`__drizzle_migrations`,
 * compared by the journal's `when`) so installs created by the previous sync
 * migrator continue seamlessly. The `hash` column exists only for schema
 * compatibility with drizzle's migrator and is intentionally left empty —
 * applied-migration content is never re-verified against it.
 */

import { getSqliteAsync, withTransaction } from "./client";
import migrations from "./migrations/migrations";

export async function migrateDb(): Promise<void> {
  const db = await getSqliteAsync();
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
  );
  const last = await db.getFirstAsync<{ created_at: number }>(
    `SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
  );
  const appliedUpTo = Number(last?.created_at ?? 0);

  for (const entry of migrations.journal.entries) {
    if (entry.when <= appliedUpTo) continue;
    const sqlBundle = migrations.migrations[`m${String(entry.idx).padStart(4, "0")}` as keyof typeof migrations.migrations];
    if (!sqlBundle) throw new Error(`Missing migration: ${entry.tag}`);
    await withTransaction(async () => {
      for (const statement of sqlBundle.split("--> statement-breakpoint")) {
        await db.execAsync(statement);
      }
      await db.runAsync(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, ["", entry.when]);
    });
  }
}
