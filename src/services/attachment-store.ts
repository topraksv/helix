/**
 * Where an attachment's bytes live: this device, and nowhere else.
 *
 * The row that describes an attachment syncs; the file does not. That is not a
 * limitation being worked around, it is the design — the sync pipeline carries
 * PostgREST JSON, and pushing documents through it would replicate every
 * receipt to every device and put them in a place the owner did not choose.
 *
 * The consequence is stated openly rather than hidden: a device that did not
 * add the file does not have it, `localAttachment` returns null there, and the
 * UI says so instead of showing a broken open button.
 *
 * `File`/`Directory` are native-only in expo-file-system 19 (the web build has
 * no sandbox to put them in), so every function here reports "not available"
 * on web rather than pretending a browser is a device with a filesystem.
 */

import { Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import { isStoredAttachmentName } from "../domain/attachments";
import { devWarning } from "./logger";

/** One directory, inside the app sandbox, holding every stored document. */
const ATTACHMENT_DIRECTORY = "attachments";

export function attachmentsSupported(): boolean {
  return Platform.OS !== "web";
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
export async function storeAttachmentBytes(sourceUri: string, storedName: string): Promise<void> {
  if (!attachmentsSupported()) throw new Error("Attachments are not available on this platform");
  const destination = resolve(storedName);
  if (!destination) throw new Error("Refusing to store an attachment under an unsafe name");
  const source = new File(sourceUri);
  source.copy(destination);
}

/** The local file for a stored attachment, or null when this device lacks it. */
export function localAttachment(storedName: string): File | null {
  if (!attachmentsSupported()) return null;
  try {
    const file = resolve(storedName);
    return file?.exists ? file : null;
  } catch (error) {
    devWarning("attachment.resolve", String(error));
    return null;
  }
}

/**
 * Remove a stored file.
 *
 * Never throws: the row is already tombstoned by the time this runs, and a
 * file that cannot be removed is collectable garbage rather than a failure the
 * owner can do anything about. The alternative — surfacing it — would make a
 * successful delete look broken.
 */
export function removeAttachmentBytes(storedName: string): void {
  if (!attachmentsSupported()) return;
  try {
    const file = resolve(storedName);
    if (file?.exists) file.delete();
  } catch (error) {
    devWarning("attachment.remove", String(error));
  }
}

/**
 * Delete stored files that no live row names any more.
 *
 * Files can outlive their rows: an add that was interrupted after the copy, a
 * tombstone that has since been pruned, or a restore that brought rows from a
 * device whose files never travelled. Nothing else would ever remove those, so
 * they would occupy the device for ever.
 */
export function pruneOrphanAttachmentFiles(liveNames: ReadonlySet<string>): number {
  if (!attachmentsSupported()) return 0;
  let removed = 0;
  try {
    for (const entry of directory().list()) {
      const name = entry.name;
      if (typeof name !== "string" || liveNames.has(name)) continue;
      if (entry instanceof File) {
        entry.delete();
        removed += 1;
      }
    }
  } catch (error) {
    devWarning("attachment.prune", String(error));
  }
  return removed;
}
