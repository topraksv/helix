/**
 * Documents kept beside a transaction (spec §2.5).
 *
 * The row and the file are written as a pair, and the order matters: the file lands before the
 * row that names it, and on delete the row is tombstoned before the file is removed.
 * `domain/attachments.ts` owns what may be stored; this module owns where it goes.
 */

import { getSqliteAsync } from "../../db/client";
import { newId } from "../../db/ids";
import { assertLiveRow, fromDbShape, nowIso, restoreRows, writeRows, writeRowsValidated, type RowWrite } from "../../db/mutations";
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
   * Copy the picked file to the app-owned path this function decides. Inverted on purpose: the
   * repository never receives a source URI, so nothing here can be pointed at another app's storage.
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

  // The file first: a row without its file cannot be opened; a file without its row is collected by `pruneOrphanAttachmentFiles`.
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
  return id;
}

export interface AttachmentSnapshot {
  row: Record<string, unknown>;
  storedName: string;
}

/**
 * Tombstone the row, then report the file to remove. The caller deletes the file only after this
 * resolves, so an interrupted delete leaves a collectable file, never a row without its file.
 */
export async function deleteAttachment(userId: string, id: string): Promise<AttachmentSnapshot | null> {
  const sqlite = await getSqliteAsync();
  const row = await sqlite.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM attachments WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [id, userId],
  );
  if (!row) return null;
  const snapshot = fromDbShape("attachments", row);
  await writeRows(userId, [{ table: "attachments", row: { ...snapshot, deletedAt: nowIso() } }]);
  return { row: snapshot, storedName: String(row.stored_name) };
}

export async function restoreAttachment(userId: string, snapshot: AttachmentSnapshot): Promise<void> {
  const writes: RowWrite[] = [{ table: "attachments", row: { ...snapshot.row, deletedAt: null } }];
  await restoreRows(userId, writes);
}

/** Stored names this account still has a live row for; the caller removes any file in the attachment directory absent from this set. */
export async function liveAttachmentNames(userId: string): Promise<Set<string>> {
  const sqlite = await getSqliteAsync();
  const rows = await sqlite.getAllAsync<{ stored_name: string }>(
    `SELECT stored_name FROM attachments WHERE user_id = ? AND deleted_at IS NULL`,
    [userId],
  );
  return new Set(rows.map((row) => row.stored_name).filter(isStoredAttachmentName));
}
