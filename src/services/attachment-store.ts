/**
 * This device's copy of an attachment's bytes (spec §3.1c).
 *
 * It used to be the only copy. `src/sync/attachment-mirror.ts` now sends what
 * is here to the owner's Storage bucket and fetches what is not, so this is a
 * cache: authoritative for what can be opened right now, not for what exists.
 *
 * The original objection survives the change and shapes it. Replicating every
 * receipt onto every device is still the wrong behaviour, so the mirror uploads
 * eagerly and downloads lazily — only the documents a screen is showing. What
 * changed is that a file this device lacks is now "not here yet" rather than
 * unreachable, and the panel asks the mirror before it tells the owner
 * anything.
 *
 * Native uses the app sandbox; `attachment-store.web.ts` is the browser's
 * equivalent and keeps this exact interface.
 */

import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { isStoredAttachmentName } from "../domain/attachments";
import { devWarning } from "./logger";

/** One directory, inside the app sandbox, holding every stored document. */
const ATTACHMENT_DIRECTORY = "attachments";

export function attachmentsSupported(): boolean {
  return true;
}

function directory(): Directory {
  const dir = new Directory(Paths.document, ATTACHMENT_DIRECTORY);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * Resolve a stored name to a file inside the attachment directory.
 *
 * The name is re-validated HERE, not only where it was written: this value
 * arrives from a database row that may have come from sync or a restored
 * backup, and it is about to become a filesystem path. A name that this app
 * could not have produced is refused rather than resolved.
 */
function resolve(storedName: string): File | null {
  if (!isStoredAttachmentName(storedName)) return null;
  return new File(directory(), storedName);
}

/** Copy a picked file into app storage under a name the repository chose. */
export async function storeAttachmentBytes(source: { uri: string }, storedName: string): Promise<void> {
  const destination = resolve(storedName);
  if (!destination) throw new Error("Refusing to store an attachment under an unsafe name");
  await new File(source.uri).copy(destination);
}

/** Which of these documents this device actually holds. */
export async function presentAttachments(storedNames: readonly string[]): Promise<Set<string>> {
  const present = new Set<string>();
  for (const name of storedNames) {
    try {
      if (resolve(name)?.exists) present.add(name);
    } catch (error) {
      devWarning("attachment.resolve", String(error));
    }
  }
  return present;
}

/** Hand the document to the OS so the owner can view or save it. */
export async function openAttachment(storedName: string, mimeType: string): Promise<void> {
  const file = resolve(storedName);
  if (!file?.exists) throw new Error("Attachment is not on this device");
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType });
}

/**
 * A URL that can be drawn as a picture, for a document this device holds.
 *
 * Only for images: a PDF has no thumbnail, and asking `expo-image` to draw one
 * gets a blank box rather than a page. `null` means "draw the type mark
 * instead", which is also the answer for a file that lives on another device.
 *
 * Native has nothing to release — the sandbox path is stable — so `release` is
 * a no-op here and real work in the browser. Both are returned so the caller
 * does not have to know which platform it is on.
 */
export async function attachmentThumbnail(
  storedName: string,
  mimeType: string,
): Promise<{ uri: string; release: () => void } | null> {
  if (!mimeType.startsWith("image/")) return null;
  const file = resolve(storedName);
  if (!file?.exists) return null;
  return { uri: file.uri, release: () => {} };
}

/**
 * Delete stored files that no live row names any more.
 *
 * Files can outlive their rows: an add interrupted after the copy, a delete
 * the owner did not undo, or a restore that brought rows from a device whose
 * files never travelled. Nothing else removes those, so they would occupy the
 * device for ever.
 */
export async function pruneOrphanAttachmentFiles(liveNames: ReadonlySet<string>): Promise<number> {
  let removed = 0;
  try {
    for (const entry of directory().list()) {
      if (!(entry instanceof File)) continue;
      const name = entry.name;
      if (typeof name !== "string" || liveNames.has(name)) continue;
      entry.delete();
      removed += 1;
    }
  } catch (error) {
    devWarning("attachment.prune", String(error));
  }
  return removed;
}

/**
 * The bytes themselves, for the remote mirror.
 *
 * Separate from `openAttachment` and `attachmentThumbnail` because those hand
 * a URI to something that will draw or share it, and the mirror needs the
 * content. `null` means this device does not hold the file, which is a normal
 * answer for a row that arrived by sync, not an error.
 */
export async function readAttachmentBytes(storedName: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const file = resolve(storedName);
  if (!file?.exists) return null;
  return file.bytes();
}

/** Write bytes fetched from the mirror into the same sandbox `storeAttachmentBytes` uses. */
export async function writeAttachmentBytes(storedName: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const file = resolve(storedName);
  if (!file) throw new Error("Refusing to store an attachment under an unsafe name");
  // `overwrite` rather than a prior existence check: a partially written file
  // from an interrupted download must be replaced, not appended to.
  file.create({ intermediates: true, overwrite: true });
  file.write(bytes);
}
