/**
 * Where an attachment's bytes live: this device, and nowhere else (spec §3.1c).
 *
 * The row that describes an attachment syncs; the file does not. That is not a
 * limitation being worked around, it is the design — the sync pipeline carries
 * PostgREST JSON, and pushing documents through it would replicate every
 * receipt to every device and put them somewhere the owner did not choose.
 *
 * The consequence is stated openly rather than hidden: a device that did not
 * add the file does not have it, `presentAttachments` omits it there, and the
 * UI says so instead of showing an open button that cannot work.
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
  new File(source.uri).copy(destination);
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
