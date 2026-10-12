/**
 * The bytes of an attachment, mirrored to the owner's Storage bucket (spec §2.5): the file itself, so a
 * receipt added on the phone opens on the laptop.
 *
 * Eager upload, lazy download: a device sends what it has and fetches what it is asked for, so a laptop
 * does not silently acquire every receipt. Not end-to-end: the bucket is private but the upload is
 * plaintext (`ARCHITECTURE.md`, `PRIVACY.md`).
 *
 * The path `<user_id>/<stored_name>` is the authorization boundary (migration 35's policies compare its
 * first segment with `auth.uid()`), so it is built from the session's id, never a row's `user_id`, and the
 * name is re-validated because it is about to become a path.
 */

import { getSqliteAsync } from "../db/client";
import { isAttachmentMimeType, isStoredAttachmentName, MAX_ATTACHMENT_BYTES } from "../domain/attachments";
import { isUuidShaped } from "./merge-policy";
import { presentAttachments, pruneOrphanAttachmentFiles, readAttachmentBytes, writeAttachmentBytes } from "../services/attachment-store";
import { devWarning } from "../services/logger";
import { getSupabase } from "./supabase";

const BUCKET = "attachments";
/** Storage pages its listing; this bounds the walk rather than trusting it. */
const LIST_PAGE = 100;
const MAX_LIST_PAGES = 40;

function objectPath(userId: string, storedName: string): string | null {
  if (!isUuidShaped(userId) || !isStoredAttachmentName(storedName)) return null;
  return `${userId}/${storedName}`;
}

/** Rows this device could mirror: live, and named by something storable. */
interface MirrorRow {
  stored_name: string;
  mime_type: string;
  deleted_at: string | null;
}

async function mirrorRows(userId: string): Promise<MirrorRow[]> {
  const sqlite = await getSqliteAsync();
  return sqlite.getAllAsync<MirrorRow>(
    `SELECT stored_name, mime_type, deleted_at FROM attachments WHERE user_id = ?`,
    [userId],
  );
}

/** Every object name the bucket holds under this account's folder. */
async function remoteNames(userId: string, signal?: AbortSignal): Promise<Set<string> | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const names = new Set<string>();
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    if (signal?.aborted) return null;
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(userId, { limit: LIST_PAGE, offset: page * LIST_PAGE });
    if (error) {
      devWarning("attachment.mirror", `list ${error.message}`);
      return null;
    }
    for (const entry of data ?? []) if (entry?.name) names.add(entry.name);
    if ((data?.length ?? 0) < LIST_PAGE) break;
  }
  return names;
}

/**
 * Send one document's bytes.
 *
 * `upsert: true` because the only way the same path is written twice is the
 * same file being re-sent — `stored_name` is derived from the row id and the
 * bytes never change once written, so a second upload is a retry, not a
 * different document.
 */
async function upload(userId: string, row: MirrorRow, signal?: AbortSignal): Promise<boolean> {
  const supabase = getSupabase();
  const path = objectPath(userId, row.stored_name);
  if (!supabase || !path || !isAttachmentMimeType(row.mime_type)) return false;
  const bytes = await readAttachmentBytes(row.stored_name);
  // Not an error: a row pulled from another device names a file this one has
  // never held. There is nothing here to send.
  if (!bytes) return false;
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    devWarning("attachment.mirror", "refusing to upload a file over the size bound");
    return false;
  }
  if (signal?.aborted) return false;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: row.mime_type, upsert: true });
  if (error) {
    devWarning("attachment.mirror", `upload ${error.message}`);
    return false;
  }
  return true;
}

/**
 * Fetch a document this device does not hold, if the bucket has it.
 *
 * Returns whether the file is on the device afterwards, so the caller can go
 * from "not here" to "here" without knowing where it came from. Every failure
 * is false rather than a throw: not having a document is a state the UI
 * already renders, and an exception would turn it into an error dialog.
 */
export async function fetchAttachment(userId: string, storedName: string): Promise<boolean> {
  const supabase = getSupabase();
  const path = objectPath(userId, storedName);
  if (!supabase || !path) return false;
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error || !data) return false;
    const buffer = await data.arrayBuffer();
    // The bucket enforces this too. Checked again because this value becomes a
    // write into the device's own storage.
    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) return false;
    await writeAttachmentBytes(storedName, new Uint8Array(buffer));
    return true;
  } catch (error) {
    devWarning("attachment.mirror", `download ${String(error)}`);
    return false;
  }
}

/**
 * Make the bucket agree with this device about what exists.
 *
 * Asymmetric: a live row whose bytes are here and whose object is not gets uploaded; a tombstoned row whose
 * object is still there gets the object removed. Never "delete what live rows do not name": a device that
 * has not pulled yet would delete another device's new document as an orphan.
 */
let reconciling = false;

/**
 * Object names this session has seen in the bucket, so the steady state ("nothing to do") skips the listing
 * that every completed sync would otherwise make. In memory, grown only by a server answer; deletion is
 * driven by tombstones, so a stale entry deletes nothing. Positive knowledge only: before the first
 * successful listing (`listed`) an empty set says nothing about the bucket.
 */
const knownRemote = new Set<string>();
let listed = false;
/** Which account the two above describe, so the next account never reads the last one's listing. */
let listedFor: string | null = null;

export async function reconcileAttachments(userId: string, signal?: AbortSignal): Promise<void> {
  const supabase = getSupabase();
  // A second sync starting mid-upload would repeat the upload against a listing it invalidated.
  if (!supabase || !isUuidShaped(userId) || reconciling) return;
  reconciling = true;
  try {
    await reconcileOnce(userId, supabase, signal);
  } finally {
    reconciling = false;
  }
}

/** Drop what the session remembers when the app changes hands. */
function forgetOtherAccount(userId: string): void {
  if (listedFor === userId) return;
  knownRemote.clear();
  listed = false;
  listedFor = userId;
}

/**
 * Whether the bucket already matches what this device knows: every live row
 * uploaded, and no tombstoned row still up there. Untrue before the first
 * listing, because an empty memory says nothing about a bucket.
 */
function agreesWithBucket(rows: readonly MirrorRow[]): boolean {
  return listed && rows.every((row) => (row.deleted_at == null) === knownRemote.has(row.stored_name));
}

async function reconcileOnce(
  userId: string,
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  signal?: AbortSignal,
): Promise<void> {
  const rows = await mirrorRows(userId);
  if (rows.length === 0) return;

  // Nothing to upload and nothing to remove, as far as this session already
  // knows: every live row is up there and no tombstoned one still is. Asking
  // the server would only confirm what its last answer already said.
  forgetOtherAccount(userId);
  if (agreesWithBucket(rows)) return;

  const remote = await remoteNames(userId, signal);
  if (!remote) return;
  knownRemote.clear();
  for (const name of remote) knownRemote.add(name);
  listed = true;

  for (const row of rows) {
    if (signal?.aborted) return;
    if (row.deleted_at == null) {
      if (!remote.has(row.stored_name) && await upload(userId, row, signal)) {
        knownRemote.add(row.stored_name);
      }
      continue;
    }
    if (!remote.has(row.stored_name)) continue;
    const path = objectPath(userId, row.stored_name);
    if (!path) continue;
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) devWarning("attachment.mirror", `remove ${error.message}`);
    else knownRemote.delete(row.stored_name);
  }
}

/**
 * Documents a sign-out would erase with no copy anywhere: held here, and not
 * seen in the bucket by this session.
 *
 * Before any listing has answered — offline since the app started — that is
 * every document held here, and `verified` is false, so the warning can say
 * it could not check rather than claim they were never sent. Only a listing
 * turns a name into knowledge; an unanswered question is not a yes.
 */
export async function unsentAttachments(userId: string): Promise<{ count: number; verified: boolean }> {
  const live = (await mirrorRows(userId)).filter((row) => row.deleted_at == null).map((row) => row.stored_name);
  if (live.length === 0) return { count: 0, verified: true };
  const verified = listed && listedFor === userId;
  let count = 0;
  for (const name of await presentAttachments(live)) if (!verified || !knownRemote.has(name)) count += 1;
  return { count, verified };
}

/** Erase every document's bytes from this device; `session.ts` says when. */
export function eraseDeviceAttachments(): Promise<number> {
  return pruneOrphanAttachmentFiles(new Set());
}

/**
 * Erase this account's documents from the bucket, and say whether it is clear.
 *
 * Called before `delete_own_account()`, because Storage does not cascade from
 * `auth.users` and the API — not a `delete` against `storage.objects` — is what
 * actually frees the blob. Nothing behind this repeats it: migration 35's
 * removal inside the RPC is refused by the storage guard and swallowed, so
 * false is the only notice that a document would outlive the account.
 */
export async function purgeRemoteAttachments(userId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase || !isUuidShaped(userId)) return true;
  const remote = await remoteNames(userId);
  if (!remote) return false;
  const paths = [...remote]
    .map((name) => objectPath(userId, name))
    .filter((path): path is string => path !== null);
  if (paths.length === 0) return true;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) {
    devWarning("attachment.mirror", `purge ${error.message}`);
    return false;
  }
  knownRemote.clear();
  listed = false;
  return true;
}
