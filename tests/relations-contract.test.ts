import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RELATIONS } from "../src/db/relations";
import { SYNCED_TABLES } from "../src/db/schema";

const migrationsDir = join(process.cwd(), "supabase/migrations");

function migrationRelations(): Set<string> {
  const found = new Set<string>();
  const tableBody = /create table\s+(?:if not exists\s+)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\s*\);|alter table\s+(?:only\s+)?(?:public\.)?"?(\w+)"?([\s\S]*?);/gi;
  const foreignKey = /foreign key\s*\(([^)]+)\)\s*references\s+(?:public\.)?"?(\w+)"?\s*\(([^)]+)\)/gi;

  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(migrationsDir, file), "utf8").toLowerCase();
    tableBody.lastIndex = 0;
    for (const match of sql.matchAll(tableBody)) {
      const child = match[1] ?? match[3];
      const body = match[2] ?? match[4] ?? "";
      if (!child || !Object.hasOwn(SYNCED_TABLES, child)) continue;
      foreignKey.lastIndex = 0;
      for (const relation of body.matchAll(foreignKey)) {
        const childColumns = relation[1]!.split(",").map((column) => column.trim());
        const parent = relation[2]!;
        const parentColumns = relation[3]!.split(",").map((column) => column.trim());
        const parentIdIndex = parentColumns.indexOf("id");
        const childColumn = childColumns[parentIdIndex];
        if (parentIdIndex < 0 || !childColumn || childColumn === "user_id" || !childColumn.endsWith("_id")) continue;
        if (!Object.hasOwn(SYNCED_TABLES, parent)) continue;
        found.add(`${child}|${childColumn}|${parent}`);
      }
    }
  }
  return found;
}

describe("foreign-key relation contract", () => {
  it("keeps the restore graph equal to the Supabase row-level FK graph", () => {
    const canonical = new Set(RELATIONS.map(([child, column, parent]) => `${child}|${column}|${parent}`));
    const parsed = migrationRelations();

    // A silent parser failure would make the equality assertion meaningless.
    expect(parsed.size).toBeGreaterThanOrEqual(RELATIONS.length);
    expect([...parsed].sort()).toEqual([...canonical].sort());
  });
});

const rlsSuiteFile = join(process.cwd(), "supabase/tests/owner_integrity_and_rls.sql");

/**
 * Every `array[...]` in the pgTAP suite that names synced tables at all.
 *
 * The suite cannot ask Postgres which tables are synced — that list lives in
 * `SYNCED_TABLES` — so it repeats the names in eight hardcoded arrays and
 * asserts a count against them. That is exactly the shape that drifts.
 */
function pgTapTableArrays(): string[][] {
  const sql = readFileSync(rlsSuiteFile, "utf8");
  const synced = new Set(Object.keys(SYNCED_TABLES));
  return [...sql.matchAll(/array\s*\[([^\]]*)\]/gi)]
    .map((match) => match[1]!.split(",").map((entry) => entry.trim().replace(/^'|'$/g, "")).filter(Boolean))
    .filter((entries) => entries.some((entry) => synced.has(entry)));
}

/**
 * This is not a guard against hypothetical drift — it is a guard against drift
 * that already shipped. The suite was written when there were 19 synced tables
 * and stayed at 19 after `attachments` and `matrix_colors` were added, so it
 * kept passing while asserting nothing about the two newest tables' policies.
 * A count assertion cannot notice its own array getting shorter than the truth.
 */
describe("RLS suite coverage", () => {
  it("names every synced table in every table array the pgTAP suite asserts over", () => {
    const expected = Object.keys(SYNCED_TABLES).sort();
    const arrays = pgTapTableArrays();

    // A parser that found nothing would make the per-array assertion vacuous.
    expect(arrays.length).toBeGreaterThanOrEqual(8);
    for (const entries of arrays) expect([...entries].sort()).toEqual(expected);
  });

  it("keeps the suite's hardcoded counts equal to the number of synced tables", () => {
    const sql = readFileSync(rlsSuiteFile, "utf8");
    const total = Object.keys(SYNCED_TABLES).length;

    // Three policies per table — select, insert and update. Migration 30 adds
    // no delete policy, which the suite asserts separately by privilege.
    expect(sql).toContain(`all ${total} synced tables have select, insert and update owner policies`);
    expect([...sql.matchAll(/^\s*(\d+)::bigint,$/gm)].map((match) => Number(match[1]))).toEqual(
      expect.arrayContaining([total, total * 3]),
    );
  });
});

/**
 * The change probe carries a second copy of the synced table list.
 *
 * `public.sync_cursors()` (migration 32) reports each table's keyset head so a
 * sync can skip tables that have not moved. Its list is a literal in PL/pgSQL —
 * it cannot import `SYNCED_TABLES`. A table added to the schema but not to that
 * array would be reported as ABSENT, and the client is written to pull an
 * absent table for exactly this reason. So a drifted list costs a round trip,
 * never a row.
 *
 * This asserts the equality anyway, because "you silently lost the speedup on
 * your newest table" is not a thing anyone would notice, and the failure mode
 * of the opposite drift — a name in the function that is no longer a table —
 * is a runtime error inside the function for every user.
 */
describe("sync change probe coverage", () => {
  it("names exactly the synced tables in sync_cursors()", () => {
    const sql = readFileSync(join(migrationsDir, "00000000000032_sync_change_probe.sql"), "utf8");
    // One `union all` branch per table, each reading one relation. Parsed from
    // the relation the branch actually reads rather than from the label it
    // returns, because a copy-paste that updates the label and not the table is
    // exactly the mistake writing 21 branches out invites.
    const read = [...sql.matchAll(/from public\.([a-z_]+) h\b/g)].map((match) => match[1]!);
    const labelled = [...sql.matchAll(/select '([a-z_]+)'::text, k\.updated_at/g)].map((match) => match[1]!);

    expect(read.length, "every branch must read a relation").toBe(labelled.length);
    expect(read, "each branch must label itself with the table it reads").toEqual(labelled);
    expect(read.length).toBe(new Set(read).size);
    expect([...read].sort()).toEqual(Object.keys(SYNCED_TABLES).sort());
  });
});
