import type * as schema from "../../db/schema";
import { newId } from "../../db/ids";
import { assertLiveRow, restoreRow, softDelete, writeRowsValidated, writeSetting } from "../../db/mutations";
import { parseDefinition, type ComputedColumnDefinition } from "../../domain/computed-columns";
import { assertInputWithinLimit } from "../../domain/input";
import { reorderRows } from "./categories";

type ComputedColumnRow = typeof schema.computedColumns.$inferSelect;

export async function saveComputedColumn(
  userId: string,
  input: { id?: string; name: string; definition: ComputedColumnDefinition; sortOrder: number },
): Promise<string> {
  if (!input.name.trim()) throw new Error("Computed column name is required");
  assertInputWithinLimit(input.name, "text");
  const definition = parseDefinition(input.definition);
  const id = input.id ?? newId();
  const writes = [{
    table: "computed_columns" as const,
    row: {
      id,
      name: input.name.trim(),
      definition: JSON.stringify(definition),
      sortOrder: input.sortOrder,
      deletedAt: null,
    },
  }];
  await writeRowsValidated(
    userId,
    writes,
    (sqlite) => input.id ? assertLiveRow(sqlite, "computed_columns", userId, input.id) : Promise.resolve(),
  );
  return id;
}

export function deleteComputedColumn(userId: string, id: string) {
  return softDelete(userId, "computed_columns", id);
}

export function restoreComputedColumn(userId: string, snapshot: Record<string, unknown>) {
  return restoreRow(userId, "computed_columns", snapshot);
}

export async function setComputedColumnsHidden(userId: string, ids: string[]): Promise<void> {
  await writeSetting(userId, "computed_columns_hidden", [...new Set(ids)]);
}

export function reorderComputedColumns(
  userId: string,
  columns: ComputedColumnRow[],
  orderedIds: string[],
): Promise<void> {
  return reorderRows(userId, "computed_columns", columns, orderedIds);
}
