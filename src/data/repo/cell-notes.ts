import { deterministicId, naturalKeys } from "../../db/ids";
import { assertLiveRow, nowIso, writeRowsValidated, type RowWrite } from "../../db/mutations";
import { isMonthKey } from "../../domain/dates";
import { assertInputWithinLimit } from "../../domain/input";

interface ExistingCellNote {
  id: string;
  body: string;
}

/** Save the one canonical note for a real month/category cell. */
export async function saveCellNote(
  userId: string,
  month: string,
  categoryId: string,
  body: string,
  existing?: ExistingCellNote,
): Promise<void> {
  if (!isMonthKey(month)) throw new Error("Invalid cell note month");
  assertInputWithinLimit(body, "note");
  const id = await deterministicId(naturalKeys.cellNote(userId, month, categoryId));
  const normalized = body.trim();
  const deletedAt = normalized === "" ? nowIso() : null;
  const writes: RowWrite[] = [];
  // A legacy random-id note converges to the natural key. The tombstone must come FIRST: push
  // upserts in write order and the server's unique index (one live note per cell) would reject the canonical row.
  if (existing && existing.id !== id) {
    writes.push({
      table: "cell_notes",
      row: { id: existing.id, month, categoryId, body: existing.body, deletedAt: nowIso() },
    });
  }
  writes.push({ table: "cell_notes", row: { id, month, categoryId, body: normalized, deletedAt } });
  await writeRowsValidated(userId, writes, (sqlite) => assertLiveRow(sqlite, "categories", userId, categoryId));
}
