/**
 * The bytes of an attachment, mirrored to the owner's Storage bucket (spec §3.1c).
 *
 * The row that describes a document has always synced. This is the other half:
 * the file itself, so a receipt added on the phone opens on the laptop.
 *
 * EAGER UPLOAD, LAZY DOWNLOAD. A device sends what it has and fetches what it
 * is asked for, rather than pulling every document onto every device. That
 * keeps the objection the original design was built around — a laptop should
 * not silently acquire a copy of every receipt — while removing the part that
 * made it a defect, which is that the file was unreachable rather than merely
 * not-yet-here.
 *
 * NOT END-TO-END. Supabase encrypts at rest and the bucket is private, but the
 * app uploads plaintext, so project credentials can read a document. That was
 * a decision, not an oversight; `ARCHITECTURE.md` records what the alternatives
 * cost and `PRIVACY.md` says it in the words a user needs.
 *
 * The path `<user_id>/<stored_name>` is the authorization boundary, not a
 * naming convention: migration 35's policies compare its first segment with
 * `auth.uid()`. It is therefore built from the SESSION's id, never from a row's
 * `user_id`, so a row that arrived from anywhere cannot address another
 * account's folder. The name is re-validated here for the same reason the
 * device stores re-validate it: it is about to become a path.
 */

import { getSqliteAsync } from "../db/client";
import { isAttachmentMimeType, isStoredAttachmentName, MAX_ATTACHMENT_BYTES } from "../domain/attachments";
import { isUuidShaped } from "./merge-policy";
import { readAttachmentBytes, writeAttachmentBytes } from "../services/attachment-store";
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
 * Two directions, deliberately asymmetric:
 *
 *   - a live row whose bytes are here and whose object is not gets uploaded;
 *   - a TOMBSTONED row whose object is still there gets the object removed.
 *
 * The second is not "delete anything the live rows do not name". That version
 * is the one that loses data: a device that has not pulled yet does not know
 * about a document another device added minutes ago, and would delete it as an
 * orphan. Only a delete this device has actually seen may remove an object.
 */
let reconciling = false;

/**
 * Object names this session has seen in the bucket.
 *
 * Reconcile runs after every completed sync, and its first act is a listing —
 * which would hand back one network request per sync to a feature whose whole
 * steady state is "nothing to do". This is what makes that steady state free:
 * when every live row is already known to be up there and no tombstone names
 * one that is, there is nothing a listing could tell us and it is skipped.
 *
 * In memory only, and only ever grown by an answer from the server. A restart
 * re-learns it with one listing; a stale entry cannot cause a deletion,
 * because deletion is driven by tombstones rather than by absence from here.
 *
 * It holds POSITIVE knowledge only. A name that is not in it has not been
 * shown to be absent — it has not been asked about. `listed` is therefore not
 * decoration: before the first successful listing the set is empty, and an
 * empty set says nothing about a bucket rather than saying it is empty.
 */
const knownRemote = new Set<string>();
let listed = false;
/** Which account the two above describe. They are module state and the app can
 *  change hands — sign out, sign in as somebody else — so without this they
 *  would answer the next account's questions with the last account's listing.
 *  Object names are row ids and cannot collide across accounts, so the stale
 *  answers happen to be harmless today; keying it is how they stay harmless. */
let listedFor: string | null = null;

export async function reconcileAttachments(userId: string, signal?: AbortSignal): Promise<void> {
  const supabase = getSupabase();
  // Reconcile is fired from every completed sync and can spend a while sending
  // a 25 MB file. Without this, a second sync starting mid-upload would begin
  // the same upload again against a listing it had already invalidated.
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
 * Erase this account's documents from the bucket.
 *
 * Called before `delete_own_account()`, because Storage does not cascade from
 * `auth.users` and the API — not a `delete` against `storage.objects` — is what
 * actually frees the blob. Migration 35 repeats the removal inside the RPC as a
 * backstop for the case where this never ran.
 */
export async function purgeRemoteAttachments(userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase || !isUuidShaped(userId)) return;
  const remote = await remoteNames(userId);
  if (!remote || remote.size === 0) return;
  const paths = [...remote]
    .map((name) => objectPath(userId, name))
    .filter((path): path is string => path !== null);
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) devWarning("attachment.mirror", `purge ${error.message}`);
  else {
    knownRemote.clear();
    listed = false;
  }
}
