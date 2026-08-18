/**
 * The browser's copy of the attachment store.
 *
 * Same promise as the native one — the bytes never leave this device — with
 * the browser's own private storage standing in for the app sandbox.
 * IndexedDB rather than `localStorage`: documents are binary and can be
 * megabytes, and `localStorage` is a synchronous string store with a few
 * megabytes for the whole origin.
 *
 * It is deliberately NOT the SQLite database the rest of the app uses. Every
 * table there is a synced table, and a document put in one would be pushed to
 * the server — which is the single thing this feature promises not to do.
 */

import { isStoredAttachmentName } from "../domain/attachments";
import { devWarning } from "./logger";

const DATABASE = "helix-attachments";
const STORE = "files";

export function attachmentsSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Attachment storage is unavailable"));
  });
}

/**
 * One connection for the page's lifetime.
 *
 * Opening and closing per operation turned a list of N documents into N
 * database opens, each an async round trip before the first byte is read.
 * The handle is cached and re-opened if the browser ever closes it.
 */
let connection: Promise<IDBDatabase> | null = null;
function connect(): Promise<IDBDatabase> {
  connection ??= open().catch((error) => {
    connection = null;
    throw error;
  });
  return connection;
}

async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await connect();
  return new Promise<T>((resolve, reject) => {
    const request = run(database.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Attachment storage failed"));
  });
}

/**
 * Read the picked file's bytes and keep them under the name the repository
 * chose.
 *
 * The name is re-validated here for the same reason the native store does it:
 * it arrives from a row that may have come from sync or a restore, and it is
 * about to become a storage key.
 */
export async function storeAttachmentBytes(source: { uri: string; file?: Blob | null }, storedName: string): Promise<void> {
  if (!isStoredAttachmentName(storedName)) throw new Error("Refusing to store an attachment under an unsafe name");
  // The picker hands the browser a real `File`; the blob URL is the fallback.
  const blob = source.file ?? await (await fetch(source.uri)).blob();
  await transact("readwrite", (store) => store.put(blob, storedName));
}

/** One read for the whole list, rather than one per document. */
export async function presentAttachments(storedNames: readonly string[]): Promise<Set<string>> {
  const wanted = new Set(storedNames.filter(isStoredAttachmentName));
  if (wanted.size === 0) return new Set();
  try {
    const keys = await transact<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
    return new Set(keys.map(String).filter((key) => wanted.has(key)));
  } catch (error) {
    devWarning("attachment.resolve", String(error));
    return new Set();
  }
}

/**
 * Open the document in a new tab.
 *
 * The object URL is revoked on the next tick rather than immediately: the tab
 * needs it long enough to start loading, and holding it for the session would
 * pin the whole document in memory.
 */
export async function openAttachment(storedName: string, mimeType: string): Promise<void> {
  const blob = await transact<Blob | undefined>("readonly", (store) => store.get(storedName));
  if (!blob) throw new Error("Attachment is not on this device");
  const url = URL.createObjectURL(new Blob([blob], { type: mimeType }));
  globalThis.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function pruneOrphanAttachmentFiles(liveNames: ReadonlySet<string>): Promise<number> {
  try {
    const keys = await transact<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
    const orphans = keys.map(String).filter((name) => !liveNames.has(name));
    if (orphans.length === 0) return 0;
    // One transaction for every deletion: a write transaction per orphan is
    // the same round trip repeated, on a path that runs at every app open.
    const database = await connect();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      for (const name of orphans) store.delete(name);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Attachment prune failed"));
    });
    return orphans.length;
  } catch (error) {
    devWarning("attachment.prune", String(error));
    return 0;
  }
}
