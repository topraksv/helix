import type * as schema from "../../db/schema";
import { newId } from "../../db/ids";
import { assertLiveRow, assertNotTombstonedRow, restoreRow, softDelete, writeRowsValidated, writeSetting } from "../../db/mutations";
import { parseDefinition, type ComputedColumnDefinition } from "../../domain/computed-columns";
import { assertInputWithinLimit } from "../../domain/input";

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
    (sqlite) => input.id ? assertNotTombstonedRow(sqlite, "computed_columns", userId, input.id) : Promise.resolve(),
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

export async function reorderComputedColumns(
  userId: string,
  columns: ComputedColumnRow[],
  orderedIds: string[],
): Promise<void> {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const slots = columns.map((column) => column.sortOrder);
  const writes = orderedIds.flatMap((id, index) => {
    const column = byId.get(id);
    const sortOrder = slots[index];
    return column && sortOrder != null
      ? [{ table: "computed_columns" as const, row: { ...column, sortOrder } }]
      : [];
  });
  if (writes.length > 0) {
    await writeRowsValidated(userId, writes, async (sqlite) => {
      await Promise.all(writes.map((write) => assertLiveRow(sqlite, "computed_columns", userId, String(write.row.id))));
    });
  }
}
