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
