/**
 * The browser's copy of the attachment store.
 *
 * Same role as the native one — this device's cache of documents the mirror
 * keeps — with the browser's own private storage standing in for the app
 * sandbox. IndexedDB rather than `localStorage`: documents are binary and can
 * be megabytes, and `localStorage` is a synchronous string store with a few
 * megabytes for the whole origin.
 *
 * It is deliberately NOT the SQLite database the rest of the app uses. Every
 * table there is a synced table, so a document put in one would travel as a
 * base64 column inside PostgREST JSON — through the outbox, into every LWW
 * comparison, and into every backup file. The bytes do reach the server now,
 * but through Storage, which is built to carry them.
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
    request.onsuccess = () => {
      // The browser can close a connection it already gave us — storage
      // eviction is the common way — and it announces that here. Dropping the
      // cache is what lets the next call open a new one instead of reusing a
      // handle that now throws on every use.
      request.result.onclose = () => { connection = null; };
      resolve(request.result);
    };
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

/**
 * A connection the browser has closed, as opposed to an operation that failed.
 *
 * Narrow on purpose. Every other failure — a refused write, a missing store —
 * is the caller's answer and must reach it unchanged; only a dead handle is
 * worth retrying, because retrying anything else would turn one refusal into
 * two attempts at the same refusal.
 */
function isDeadConnection(error: unknown): boolean {
  const name = (error as { name?: unknown })?.name;
  if (name === "InvalidStateError") return true;
  return error instanceof Error && error.message.includes("InvalidStateError");
}

function runTransaction<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const request = run(database.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Attachment storage failed"));
  });
}

async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  try {
    return await runTransaction(await connect(), mode, run);
  } catch (error) {
    // `onclose` above is the announcement; this is the case where there was
    // none. A handle closed by a schema upgrade in another tab throws
    // `InvalidStateError` on every later use, and the cached promise would
    // keep handing that same dead handle out for the life of the page — which
    // `presentAttachments` reports as "no documents", permanently. One retry
    // on a fresh connection is what this file's header already promised.
    if (!isDeadConnection(error)) throw error;
    connection = null;
    return runTransaction(await connect(), mode, run);
  }
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

/**
 * A URL that can be drawn as a picture, for a document this device holds.
 *
 * Only for images — see the native file for why — and the caller MUST call
 * `release` when the picture leaves the screen. An object URL pins its blob in
 * memory for the life of the document, so a transaction list that opened and
 * closed a few edit forms would hold every receipt it had ever drawn.
 */
export async function attachmentThumbnail(
  storedName: string,
  mimeType: string,
): Promise<{ uri: string; release: () => void } | null> {
  if (!mimeType.startsWith("image/")) return null;
  const blob = await transact<Blob | undefined>("readonly", (store) => store.get(storedName));
  if (!blob) return null;
  const uri = URL.createObjectURL(new Blob([blob], { type: mimeType }));
  return { uri, release: () => URL.revokeObjectURL(uri) };
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

/** See the native file for why these are separate from the URI accessors. */
export async function readAttachmentBytes(storedName: string): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!isStoredAttachmentName(storedName)) return null;
  const blob = await transact<Blob | undefined>("readonly", (store) => store.get(storedName));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

export async function writeAttachmentBytes(storedName: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  if (!isStoredAttachmentName(storedName)) throw new Error("Refusing to store an attachment under an unsafe name");
  await transact("readwrite", (store) => store.put(new Blob([bytes]), storedName));
}
