import { deterministicId, naturalKeys } from "../db/ids";
import { nowIso, writeRows, type RowWrite } from "../db/mutations";
import { scheduleSync } from "../sync/engine";
import { assertInputWithinLimit } from "../domain/input";

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
  assertInputWithinLimit(body, "note");
  const id = await deterministicId(naturalKeys.cellNote(userId, month, categoryId));
  const normalized = body.trim();
  const deletedAt = normalized === "" ? nowIso() : null;
  const writes: RowWrite[] = [];
  // Editing a legacy random-id note converges it to the natural key instead of
  // leaving two active rows after multi-device sync. The tombstone must come
  // FIRST: push upserts a batch in write order, and the server's partial
  // unique index (one live note per user/month/category) would reject the
  // canonical row while the legacy one is still live.
  if (existing && existing.id !== id) {
    writes.push({
      table: "cell_notes",
      row: { id: existing.id, month, categoryId, body: existing.body, deletedAt: nowIso() },
    });
  }
  writes.push({ table: "cell_notes", row: { id, month, categoryId, body: normalized, deletedAt } });
  await writeRows(userId, writes);
  scheduleSync(userId);
}
