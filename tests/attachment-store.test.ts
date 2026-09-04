/**
 * The two device stores, driven for real.
 *
 * These files decide which of the owner's documents this device keeps and
 * which it DELETES, and the mutation gate scored both at zero with every
 * mutant uncovered: `attachment-mirror.test.ts` replaces the whole module with
 * `vi.mock`, so the real code had never run in a test. A zero is not "safe", it
 * is a gate that cannot fail.
 *
 * So the stand-in stops at the platform boundary — an in-memory filesystem for
 * the sandbox, an in-memory object store for IndexedDB — and everything above
 * it is the shipped module. The two are exercised through ONE contract because
 * the native file's header promises the web file "keeps this exact interface",
 * and a promise nothing checks is a comment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** An in-memory stand-in for the app sandbox. */
const sandbox = vi.hoisted(() => {
  const failing = { list: false, exists: false };
  const files = new Map<string, Uint8Array>();
  const directories = new Set<string>(["/doc"]);

  class FakeFile {
    readonly uri: string;
    constructor(parent: unknown, name?: string) {
      this.uri = name == null
        ? String(parent)
        : `${(parent as { uri: string }).uri}/${name}`;
    }
    get name(): string {
      return this.uri.slice(this.uri.lastIndexOf("/") + 1);
    }
    get exists(): boolean {
      if (failing.exists) throw new Error("EIO: the volume is unreadable");
      return files.has(this.uri);
    }
    async copy(destination: FakeFile): Promise<void> {
      const bytes = files.get(this.uri);
      if (!bytes) throw new Error(`No such file: ${this.uri}`);
      files.set(destination.uri, bytes);
    }
    async bytes(): Promise<Uint8Array> {
      const bytes = files.get(this.uri);
      if (!bytes) throw new Error(`No such file: ${this.uri}`);
      return bytes;
    }
    create(options?: { intermediates?: boolean; overwrite?: boolean }): void {
      // The real API refuses an existing file unless told to overwrite, which
      // is the whole reason the caller passes it: a half-written download must
      // be replaced rather than reopened.
      if (files.has(this.uri) && options?.overwrite !== true) {
        throw new Error(`Already exists: ${this.uri}`);
      }
      if (options?.intermediates !== true && !directories.has(this.uri.slice(0, this.uri.lastIndexOf("/")))) {
        throw new Error(`No parent directory for ${this.uri}`);
      }
      files.set(this.uri, new Uint8Array());
    }
    write(bytes: Uint8Array): void {
      files.set(this.uri, bytes);
    }
    delete(): void {
      files.delete(this.uri);
    }
  }

  class FakeDirectory {
    readonly uri: string;
    constructor(parent: unknown, name?: string) {
      this.uri = name == null
        ? String(parent)
        : `${typeof parent === "string" ? parent : (parent as { uri: string }).uri}/${name}`;
    }
    get exists(): boolean {
      return directories.has(this.uri);
    }
    create(options?: { intermediates?: boolean; idempotent?: boolean }): void {
      if (directories.has(this.uri) && options?.idempotent !== true) {
        throw new Error(`Already exists: ${this.uri}`);
      }
      directories.add(this.uri);
    }
    /** Present, and destructive, exactly as the real one is. */
    delete(): void {
      directories.delete(this.uri);
      for (const path of [...files.keys()]) {
        if (path.startsWith(`${this.uri}/`)) files.delete(path);
      }
    }
    /** Files directly inside, plus any directory — the caller must skip those. */
    list(): (FakeFile | FakeDirectory)[] {
      if (failing.list) throw new Error("EIO: the volume is unreadable");
      const prefix = `${this.uri}/`;
      const entries: (FakeFile | FakeDirectory)[] = [];
      for (const path of files.keys()) {
        if (path.startsWith(prefix) && !path.slice(prefix.length).includes("/")) {
          entries.push(new FakeFile(path));
        }
      }
      for (const path of directories) {
        if (path.startsWith(prefix) && !path.slice(prefix.length).includes("/")) {
          entries.push(new FakeDirectory(path));
        }
      }
      return entries;
    }
  }

  return { files, directories, FakeFile, FakeDirectory, failing };
});

const shared = vi.hoisted(() => ({ shareAvailable: true, shared: [] as { uri: string; mimeType?: string }[] }));

vi.mock("expo-file-system", () => ({
  Directory: sandbox.FakeDirectory,
  File: sandbox.FakeFile,
  Paths: { document: "/doc" },
}));
vi.mock("expo-sharing", () => ({
  isAvailableAsync: async () => shared.shareAvailable,
  shareAsync: async (uri: string, options?: { mimeType?: string }) => {
    shared.shared.push({ uri, mimeType: options?.mimeType });
  },
}));
const logger = vi.hoisted(() => ({ devWarning: vi.fn(), devError: vi.fn() }));
vi.mock("../src/services/logger", () => logger);

/**
 * Enough IndexedDB to run the browser store.
 *
 * Requests settle on a microtask because the module attaches `onsuccess` after
 * the call returns, exactly as a browser allows; a transaction completes one
 * microtask later so its own `oncomplete` lands after the writes it carries.
 */
function installFakeIndexedDB(): { store: Map<string, Blob>; failNext: (times?: number) => void } {
  const store = new Map<string, Blob>();
  const names = new Set<string>();
  let failures = 0;
  const takeFailure = () => (failures > 0 ? (failures -= 1, true) : false);

  const request = <T>(produce: () => T) => {
    const req: Record<string, unknown> = { result: undefined, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      if (takeFailure()) {
        req.error = new Error("QuotaExceededError");
        (req.onerror as (() => void) | null)?.();
        return;
      }
      try {
        req.result = produce();
        (req.onsuccess as (() => void) | null)?.();
      } catch (error) {
        req.error = error;
        (req.onerror as (() => void) | null)?.();
      }
    });
    return req;
  };
  const storeFor = (mode: string) => {
    const write = (run: () => void) => {
      // The browser throws synchronously here; a mode is a permission, not a
      // label, and the sweep deliberately reads in one and deletes in another.
      if (mode !== "readwrite") throw new Error("ReadOnlyError: the transaction is read-only");
      return request(run);
    };
    return {
      put: (value: Blob, key: string) => write(() => void store.set(key, value)),
      get: (key: string) => request(() => store.get(key)),
      getAllKeys: () => request(() => [...store.keys()]),
      delete: (key: string) => write(() => void store.delete(key)),
    };
  };
  const database = {
    // Name-aware, so the store constant is load-bearing rather than decorative:
    // ask for a store that was never created and the browser throws.
    objectStoreNames: { contains: (name: string) => names.has(name) },
    createObjectStore: (name: string) => {
      names.add(name);
      return storeFor("readwrite");
    },
    transaction: (name: string, mode = "readonly") => {
      if (!names.has(name)) throw new Error(`NotFoundError: no object store named ${name}`);
      const tx: Record<string, unknown> = {
        oncomplete: null,
        onerror: null,
        error: null,
        objectStore: (inner: string) => {
          if (!names.has(inner)) throw new Error(`NotFoundError: no object store named ${inner}`);
          return storeFor(mode);
        },
      };
      queueMicrotask(() => queueMicrotask(() => {
        if (takeFailure()) {
          tx.error = new Error("AbortError");
          (tx.onerror as (() => void) | null)?.();
          return;
        }
        (tx.oncomplete as (() => void) | null)?.();
      }));
      return tx;
    },
  };
  (globalThis as Record<string, unknown>).indexedDB = {
    open: (name: string) => {
      const req: Record<string, unknown> = { result: database, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => {
        if (name !== "helix-attachments") {
          req.error = new Error(`Unknown database ${name}`);
          (req.onerror as (() => void) | null)?.();
          return;
        }
        (req.onupgradeneeded as (() => void) | null)?.();
        (req.onsuccess as (() => void) | null)?.();
      });
      return req;
    },
  };
  return { store, failNext: (times = 1) => { failures = times; } };
}

let webBoundary: ReturnType<typeof installFakeIndexedDB> | null = null;
/** What the browser store actually handed the page. */
const handed = {
  opened: [] as { url: string; target?: string; features?: string }[],
  objectUrls: new Map<string, Blob>(),
  revoked: [] as string[],
};

const PDF = "application/pdf";
const PNG = "image/png";
const bytes = (...values: number[]) => new Uint8Array(values);

/** The two implementations of one interface, each with its own boundary. */
const implementations = [
  {
    name: "native sandbox",
    isNative: true,
    async load() {
      sandbox.files.clear();
      sandbox.directories.clear();
      sandbox.directories.add("/doc");
      shared.shareAvailable = true;
      shared.shared.length = 0;
      vi.resetModules();
      return import("../src/services/attachment-store");
    },
    /** What the document picker hands the store on this platform. */
    pick(value: Uint8Array) {
      sandbox.files.set("/picked/source.bin", value);
      return { uri: "/picked/source.bin" };
    },
    failResolve() {
      sandbox.failing.exists = true;
    },
    failSweep() {
      sandbox.failing.list = true;
    },
    healBoundary() {
      sandbox.failing.exists = false;
      sandbox.failing.list = false;
    },
  },
  {
    name: "browser object store",
    isNative: false,
    async load() {
      webBoundary = installFakeIndexedDB();
      handed.opened.length = 0;
      handed.objectUrls.clear();
      handed.revoked.length = 0;
      (globalThis as Record<string, unknown>).open = (url: string, target?: string, features?: string) => {
        handed.opened.push({ url, target, features });
        return null;
      };
      URL.createObjectURL = (blob: Blob) => {
        const url = `blob:fake/${handed.objectUrls.size}`;
        handed.objectUrls.set(url, blob);
        return url;
      };
      URL.revokeObjectURL = (url: string) => void handed.revoked.push(url);
      vi.resetModules();
      return import("../src/services/attachment-store.web");
    },
    pick(value: Uint8Array) {
      return { uri: "blob:picked", file: new Blob([value as BufferSource]) };
    },
    failResolve() {
      webBoundary!.failNext(1);
    },
    failSweep() {
      webBoundary!.failNext(1);
    },
    healBoundary() {},
  },
] as const;

describe.each(implementations)("$name", (platform) => {
  let store: Awaited<ReturnType<typeof platform.load>>;

  beforeEach(async () => {
    logger.devWarning.mockClear();
    sandbox.failing.list = false;
    sandbox.failing.exists = false;
    store = await platform.load();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const NAME = "01a0695a-7bd1-7c13-87b4-ff7575611685.pdf";
  const OTHER = "01a0695b-7bd1-7c13-87b4-ff7575611686.png";

  it("reports that it can hold documents at all", () => {
    expect(store.attachmentsSupported()).toBe(true);
  });

  it("keeps what it stored, and hands the same bytes back", async () => {
    await store.storeAttachmentBytes(platform.pick(bytes(1, 2, 3)), NAME);
    expect([...(await store.presentAttachments([NAME]))]).toEqual([NAME]);
    expect(await store.readAttachmentBytes(NAME)).toEqual(bytes(1, 2, 3));
  });

  /**
   * The name arrives from a row that may have come from sync or a restore and
   * is about to become a path or a key, so every entry point re-checks it.
   * A refusal must also leave NOTHING behind: a store that threw after writing
   * would be the same defect with a better error message.
   */
  it.each(["../escape.pdf", "/etc/passwd", "-flag.pdf", "..", ".", "a".repeat(121) + ".pdf", ""])(
    "refuses to store under %j and writes nothing",
    async (unsafe) => {
      await expect(store.storeAttachmentBytes(platform.pick(bytes(9)), unsafe)).rejects.toThrow();
      await expect(store.writeAttachmentBytes(unsafe, bytes(9))).rejects.toThrow();
      expect([...(await store.presentAttachments([unsafe]))]).toEqual([]);
      expect(await store.readAttachmentBytes(unsafe)).toBeNull();
    },
  );

  it("says a document is absent rather than inventing one", async () => {
    expect([...(await store.presentAttachments([NAME]))]).toEqual([]);
    // A row that arrived by sync whose bytes have not been fetched is normal,
    // not an error: the panel asks the mirror instead of telling the owner.
    expect(await store.readAttachmentBytes(NAME)).toBeNull();
    expect(await store.attachmentThumbnail(NAME, PNG)).toBeNull();
    await expect(store.openAttachment(NAME, PDF)).rejects.toThrow();
  });

  it("draws a thumbnail only for a picture", async () => {
    await store.storeAttachmentBytes(platform.pick(bytes(7)), OTHER);
    const picture = await store.attachmentThumbnail(OTHER, PNG);
    expect(picture?.uri).toBeTruthy();
    picture?.release();
    // A PDF has no thumbnail; asking `expo-image` for one gets a blank box
    // rather than a page, so the caller must be told to draw the type mark.
    await store.storeAttachmentBytes(platform.pick(bytes(7)), NAME);
    expect(await store.attachmentThumbnail(NAME, PDF)).toBeNull();
  });

  it("replaces a partially written file instead of appending to it", async () => {
    await store.writeAttachmentBytes(NAME, bytes(1, 2, 3, 4));
    await store.writeAttachmentBytes(NAME, bytes(9));
    expect(await store.readAttachmentBytes(NAME)).toEqual(bytes(9));
  });

  /**
   * The sweep DELETES, so both halves matter: an orphan must go, and a document
   * a live row still names must not. Getting the second wrong is a data loss
   * with no error and no undo.
   */
  it("removes exactly the documents no live row names", async () => {
    await store.storeAttachmentBytes(platform.pick(bytes(1)), NAME);
    await store.storeAttachmentBytes(platform.pick(bytes(2)), OTHER);

    expect(await store.pruneOrphanAttachmentFiles(new Set([NAME, OTHER]))).toBe(0);
    expect((await store.presentAttachments([NAME, OTHER])).size).toBe(2);

    expect(await store.pruneOrphanAttachmentFiles(new Set([NAME]))).toBe(1);
    expect([...(await store.presentAttachments([NAME, OTHER]))]).toEqual([NAME]);

    expect(await store.pruneOrphanAttachmentFiles(new Set())).toBe(1);
    expect((await store.presentAttachments([NAME, OTHER])).size).toBe(0);
  });

  it("counts nothing and removes nothing when every document is live", async () => {
    await store.storeAttachmentBytes(platform.pick(bytes(1)), NAME);
    expect(await store.pruneOrphanAttachmentFiles(new Set([NAME]))).toBe(0);
    expect(await store.readAttachmentBytes(NAME)).toEqual(bytes(1));
  });

  /**
   * A store this device cannot read is not an empty store, but the panel has
   * only one honest thing to show for either: nothing held. Throwing here
   * would put a storage error in front of someone looking at a ledger row, so
   * the failure is swallowed and recorded instead.
   */
  it("reports nothing held when the store cannot be read, and records why", async () => {
    await store.storeAttachmentBytes(platform.pick(bytes(1)), NAME);
    platform.failResolve();
    expect([...(await store.presentAttachments([NAME]))]).toEqual([]);
    expect(logger.devWarning).toHaveBeenCalledWith("attachment.resolve", expect.stringContaining("Error"));
    platform.healBoundary();
    // Nothing was destroyed by the failure: the document is held again as soon
    // as the boundary answers.
    expect([...(await store.presentAttachments([NAME]))]).toEqual([NAME]);
  });

  /**
   * A sweep that could not finish must not claim the deletions it did not
   * make. The count is what the caller logs, and an invented one turns a
   * failed cleanup into a report that everything was tidied.
   */
  it("claims no removals when the sweep itself fails", async () => {
    await store.storeAttachmentBytes(platform.pick(bytes(1)), NAME);
    platform.failSweep();
    expect(await store.pruneOrphanAttachmentFiles(new Set())).toBe(0);
    expect(logger.devWarning).toHaveBeenCalledWith("attachment.prune", expect.stringContaining("Error"));
    platform.healBoundary();
    // The document is still there: a failed sweep removes nothing.
    expect([...(await store.presentAttachments([NAME]))]).toEqual([NAME]);
  });

  it("hands a held document to the platform when asked to open it", async () => {
    await store.storeAttachmentBytes(platform.pick(bytes(1)), NAME);
    await expect(store.openAttachment(NAME, PDF)).resolves.toBeUndefined();
  });
});

describe("native sandbox specifics", () => {
  beforeEach(() => {
    sandbox.files.clear();
    sandbox.directories.clear();
    sandbox.directories.add("/doc");
    shared.shareAvailable = true;
    shared.shared.length = 0;
    vi.resetModules();
  });

  it("shares the file's own uri and its declared type", async () => {
    const store = await import("../src/services/attachment-store");
    const name = "01a0695a-7bd1-7c13-87b4-ff7575611685.pdf";
    await store.writeAttachmentBytes(name, bytes(1));
    await store.openAttachment(name, PDF);
    expect(shared.shared).toEqual([{ uri: `/doc/attachments/${name}`, mimeType: PDF }]);
  });

  /** A device with no share sheet must not be told the document is missing. */
  it("stays quiet when the platform offers no way to share", async () => {
    shared.shareAvailable = false;
    const store = await import("../src/services/attachment-store");
    const name = "01a0695a-7bd1-7c13-87b4-ff7575611685.pdf";
    await store.writeAttachmentBytes(name, bytes(1));
    await expect(store.openAttachment(name, PDF)).resolves.toBeUndefined();
    expect(shared.shared).toEqual([]);
  });

  /**
   * The sweep walks the directory and deletes what no row names. A directory
   * entry is not a document, and calling `delete()` on one would remove
   * whatever it holds — which is why the loop tests `instanceof File` and why
   * that guard is worth a case of its own.
   */
  it("walks past a directory rather than deleting it", async () => {
    const store = await import("../src/services/attachment-store");
    const name = "01a0695a-7bd1-7c13-87b4-ff7575611685.pdf";
    await store.writeAttachmentBytes(name, bytes(1));
    sandbox.directories.add("/doc/attachments/nested");
    sandbox.files.set("/doc/attachments/nested/keep.bin", bytes(5));

    expect(await store.pruneOrphanAttachmentFiles(new Set())).toBe(1);
    expect(sandbox.directories.has("/doc/attachments/nested")).toBe(true);
    expect(sandbox.files.get("/doc/attachments/nested/keep.bin")).toEqual(bytes(5));
  });

  it("creates the attachment directory the first time it is needed", async () => {
    const store = await import("../src/services/attachment-store");
    expect(sandbox.directories.has("/doc/attachments")).toBe(false);
    await store.presentAttachments(["01a0695a-7bd1-7c13-87b4-ff7575611685.pdf"]);
    expect(sandbox.directories.has("/doc/attachments")).toBe(true);
  });
});

describe("browser store specifics", () => {
  const NAME = "01a0695a-7bd1-7c13-87b4-ff7575611685.pdf";
  const PICTURE = "01a0695b-7bd1-7c13-87b4-ff7575611686.png";

  async function load() {
    webBoundary = installFakeIndexedDB();
    handed.opened.length = 0;
    handed.objectUrls.clear();
    handed.revoked.length = 0;
    (globalThis as Record<string, unknown>).open = (url: string, target?: string, features?: string) => {
      handed.opened.push({ url, target, features });
      return null;
    };
    URL.createObjectURL = (blob: Blob) => {
      const url = `blob:fake/${handed.objectUrls.size}`;
      handed.objectUrls.set(url, blob);
      return url;
    };
    URL.revokeObjectURL = (url: string) => void handed.revoked.push(url);
    vi.resetModules();
    return import("../src/services/attachment-store.web");
  }

  /**
   * The new tab must not keep a handle on the one that opened it. `noopener`
   * is what severs `window.opener`, and this is a page holding the owner's
   * financial documents — the one place a stray handle is worth naming in a
   * test rather than trusting to a literal nobody reads.
   */
  it("opens the document in a tab that cannot reach back", async () => {
    const store = await load();
    await store.writeAttachmentBytes(NAME, bytes(1));
    await store.openAttachment(NAME, PDF);
    expect(handed.opened).toHaveLength(1);
    expect(handed.opened[0]!.target).toBe("_blank");
    expect(handed.opened[0]!.features).toContain("noopener");
    expect(handed.opened[0]!.features).toContain("noreferrer");
  });

  /**
   * The blob is re-wrapped with the row's declared type because IndexedDB gives
   * back what was stored, and a PDF handed over without one is a download
   * rather than a page the browser renders.
   */
  it("labels the object URL with the document's own type", async () => {
    const store = await load();
    await store.writeAttachmentBytes(NAME, bytes(1));
    await store.openAttachment(NAME, PDF);
    const opened = handed.objectUrls.get(handed.opened[0]!.url);
    expect(opened?.type).toBe(PDF);

    await store.writeAttachmentBytes(PICTURE, bytes(2));
    const thumbnail = await store.attachmentThumbnail(PICTURE, PNG);
    expect(handed.objectUrls.get(thumbnail!.uri)?.type).toBe(PNG);
  });

  /**
   * An object URL pins its blob for the life of the document, so a list that
   * drew and dropped a few receipts would hold every one of them. `release` is
   * the caller's half of that bargain and it must actually revoke.
   */
  it("releases a thumbnail's memory when the caller lets go", async () => {
    const store = await load();
    await store.writeAttachmentBytes(PICTURE, bytes(2));
    const thumbnail = await store.attachmentThumbnail(PICTURE, PNG);
    expect(handed.revoked).toEqual([]);
    thumbnail!.release();
    expect(handed.revoked).toEqual([thumbnail!.uri]);
  });

  /** No browser storage at all is a workspace that cannot hold documents. */
  it("says it cannot hold documents when the browser offers no store", async () => {
    const original = (globalThis as Record<string, unknown>).indexedDB;
    try {
      delete (globalThis as Record<string, unknown>).indexedDB;
      vi.resetModules();
      const store = await import("../src/services/attachment-store.web");
      expect(store.attachmentsSupported()).toBe(false);
    } finally {
      (globalThis as Record<string, unknown>).indexedDB = original;
    }
  });
});
