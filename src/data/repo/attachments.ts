/**
 * Documents kept beside a transaction.
 *
 * The row and the file are written as a pair, and the ORDER matters in both
 * directions: the file lands before the row that names it (a row pointing at
 * nothing is a broken attachment in the list), and on delete the row is
 * tombstoned before the file is removed (a file with no row is invisible
 * garbage that still occupies the device).
 *
 * `domain/attachments.ts` owns every rule about what may be stored;
 * this module owns where it goes.
 */

import { getSqliteAsync } from "../../db/client";
import { newId } from "../../db/ids";
import { assertLiveRow, fromDbShape, nowIso, restoreRows, writeRowsValidated, type RowWrite } from "../../db/mutations";
import { scheduleSync } from "../../sync/engine";
import {
  classifyAttachment,
  isAttachmentKind,
  isStoredAttachmentName,
  storedAttachmentName,
  type AttachmentKind,
} from "../../domain/attachments";
import { AttachmentRejectedError } from "./errors";

/** What the caller must provide; the bytes are copied by `copyInto`. */
export interface NewAttachment {
  transactionId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  kind?: AttachmentKind;
  /**
   * Copy the picked file to the app-owned path this function decides.
   *
   * Inverted deliberately: the repository never receives a source URI, so a
   * caller cannot hand it a path to read from and there is nothing here that
   * could be pointed at another app's storage. The caller does the copy; the
   * repository decides the destination and owns the row.
   */
  copyInto: (storedName: string) => Promise<void>;
}

export interface AttachmentRow {
  id: string;
  transactionId: string;
  fileName: string;
  storedName: string;
  mimeType: string;
  byteSize: number;
  kind: AttachmentKind;
}

export async function addAttachment(userId: string, input: NewAttachment): Promise<string> {
  const classified = classifyAttachment(input);
  if (!classified.ok) throw new AttachmentRejectedError(classified.reason);
  const kind = isAttachmentKind(input.kind) ? input.kind : "other";
  const id = newId();
  const storedName = storedAttachmentName(id, classified.value.mimeType);

  // The file first: a row whose file never arrived is an attachment the list
  // offers and cannot open. A file whose row never arrived is collected by
  // `pruneOrphanAttachmentFiles` instead.
  await input.copyInto(storedName);
  await writeRowsValidated(
    userId,
    [{
      table: "attachments",
      row: {
        id,
        transactionId: input.transactionId,
        fileName: classified.value.fileName,
        storedName,
        mimeType: classified.value.mimeType,
        byteSize: classified.value.byteSize,
        kind,
        deletedAt: null,
      },
    }],
    (sqlite) => assertLiveRow(sqlite, "transactions", userId, input.transactionId),
  );
  scheduleSync(userId);
  return id;
}

export interface AttachmentSnapshot {
  row: Record<string, unknown>;
  storedName: string;
}

/**
 * Tombstone the row, then report the file to remove.
 *
 * The caller deletes the file only after this resolves, so an interrupted
 * delete leaves a file with no row (collectable) rather than a row with no
 * file (broken). The snapshot is what `restoreAttachment` needs, which is why
 * the file is not removed here at all when the caller intends an undo.
 */
export async function deleteAttachment(userId: string, id: string): Promise<AttachmentSnapshot | null> {
  const sqlite = await getSqliteAsync();
  const row = await sqlite.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM attachments WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [id, userId],
  );
  if (!row) return null;
  const snapshot = fromDbShape("attachments", row);
  await writeRowsValidated(
    userId,
    [{ table: "attachments", row: { ...snapshot, deletedAt: nowIso() } }],
    () => Promise.resolve(),
  );
  scheduleSync(userId);
  return { row: snapshot, storedName: String(row.stored_name) };
}

export async function restoreAttachment(userId: string, snapshot: AttachmentSnapshot): Promise<void> {
  const writes: RowWrite[] = [{ table: "attachments", row: { ...snapshot.row, deletedAt: null } }];
  await restoreRows(userId, writes);
  scheduleSync(userId);
}

/**
 * Stored names this account still has a live row for.
 *
 * The caller lists the attachment directory and removes anything absent from
 * this set: files left by an interrupted add, by a tombstone that has since
 * been pruned, or by a restore that brought rows from a device whose files
 * never travelled.
 */
export async function liveAttachmentNames(userId: string): Promise<Set<string>> {
  const sqlite = await getSqliteAsync();
  const rows = await sqlite.getAllAsync<{ stored_name: string }>(
    `SELECT stored_name FROM attachments WHERE user_id = ? AND deleted_at IS NULL`,
    [userId],
  );
  return new Set(rows.map((row) => row.stored_name).filter(isStoredAttachmentName));
}
