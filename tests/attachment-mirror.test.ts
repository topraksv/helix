/**
 * The rules that decide whether a document survives.
 *
 * Two of these are the reason this file exists rather than the reason it is
 * thorough. A path assembled from a row instead of the session would let a
 * synced row address another account's folder, and the storage policy compares
 * exactly that first segment. And a reconcile that removed "any object no live
 * row names" would delete a receipt another device added ten seconds ago and
 * this one has not pulled yet — a data loss with no error and no undo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.fn(async (): Promise<unknown[]> => []);
const bytesFor = vi.fn(async (_name: string): Promise<Uint8Array | null> => null);
const written = vi.fn(async (_name: string, _bytes: Uint8Array) => {});

vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => ({ getAllAsync: (_sql: string, _params: unknown[]) => rows() }),
}));
vi.mock("../src/services/attachment-store", () => ({
  readAttachmentBytes: (name: string) => bytesFor(name),
  writeAttachmentBytes: (name: string, bytes: Uint8Array) => written(name, bytes),
}));
vi.mock("../src/services/logger", () => ({ devWarning: vi.fn(), devError: vi.fn() }));

const storage = {
  list: vi.fn(async (_prefix: string, _options?: { limit: number; offset: number }) =>
    ({ data: [] as { name: string }[], error: null as { message: string } | null })),
  upload: vi.fn(async (_path: string, _body: Uint8Array, _options?: unknown) =>
    ({ error: null as { message: string } | null })),
  remove: vi.fn(async (_paths: string[]) => ({ error: null as { message: string } | null })),
  download: vi.fn(async (_path: string) =>
    ({ data: null as Blob | null, error: null as { message: string } | null })),
};
const client = { storage: { from: vi.fn(() => storage) } };
let configured = true;
vi.mock("../src/sync/supabase", () => ({ getSupabase: () => (configured ? client : null) }));

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NAME = "0198aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.pdf";
const live = (stored_name: string) => ({ stored_name, mime_type: "application/pdf", deleted_at: null });
const dead = (stored_name: string) => ({ stored_name, mime_type: "application/pdf", deleted_at: "2026-09-02T00:00:00.000Z" });

/** A fresh module each time: reconcile holds an in-flight flag by design. */
async function mirror() {
  vi.resetModules();
  return import("../src/sync/attachment-mirror");
}

beforeEach(() => {
  configured = true;
  rows.mockResolvedValue([]);
  bytesFor.mockResolvedValue(null);
  written.mockClear();
  storage.list.mockClear().mockResolvedValue({ data: [], error: null });
  storage.upload.mockClear().mockResolvedValue({ error: null });
  storage.remove.mockClear().mockResolvedValue({ error: null });
  storage.download.mockClear().mockResolvedValue({ data: null, error: null });
});

describe("what the mirror sends", () => {
  it("addresses the caller's own folder, and puts the file inside it", async () => {
    const { reconcileAttachments } = await mirror();
    rows.mockResolvedValue([live(NAME)]);
    bytesFor.mockResolvedValue(new Uint8Array([1, 2, 3]));

    await reconcileAttachments(USER);

    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(storage.upload.mock.calls[0]![0]).toBe(`${USER}/${NAME}`);
    expect(storage.upload.mock.calls[0]![0]).not.toContain(OTHER);
  });

  it("sends nothing for a row whose bytes this device never held", async () => {
    const { reconcileAttachments } = await mirror();
    // The ordinary case for a row that arrived by sync: there is no file here.
    rows.mockResolvedValue([live(NAME)]);
    bytesFor.mockResolvedValue(null);

    await reconcileAttachments(USER);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("sends nothing for a file the bucket already has", async () => {
    const { reconcileAttachments } = await mirror();
    rows.mockResolvedValue([live(NAME)]);
    bytesFor.mockResolvedValue(new Uint8Array([1]));
    storage.list.mockResolvedValue({ data: [{ name: NAME }], error: null });

    await reconcileAttachments(USER);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("refuses a stored name that could not have come from this app", async () => {
    const { reconcileAttachments } = await mirror();
    rows.mockResolvedValue([live("../../etc/passwd")]);
    bytesFor.mockResolvedValue(new Uint8Array([1]));

    await reconcileAttachments(USER);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("refuses a user id that is not a session id", async () => {
    const { reconcileAttachments } = await mirror();
    rows.mockResolvedValue([live(NAME)]);
    bytesFor.mockResolvedValue(new Uint8Array([1]));

    await reconcileAttachments("local-only");
    expect(storage.list).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("refuses a type the bucket would not accept", async () => {
    const { reconcileAttachments } = await mirror();
    rows.mockResolvedValue([{ stored_name: NAME, mime_type: "application/zip", deleted_at: null }]);
    bytesFor.mockResolvedValue(new Uint8Array([1]));

    await reconcileAttachments(USER);
    expect(storage.upload).not.toHaveBeenCalled();
  });
});

describe("what the mirror removes", () => {
  it("removes the object behind a delete this device has seen", async () => {
    const { reconcileAttachments } = await mirror();
    rows.mockResolvedValue([dead(NAME)]);
    storage.list.mockResolvedValue({ data: [{ name: NAME }], error: null });

    await reconcileAttachments(USER);
    expect(storage.remove).toHaveBeenCalledWith([`${USER}/${NAME}`]);
  });

  it("leaves an object no local row mentions, because it may be newer than this device", async () => {
    const { reconcileAttachments } = await mirror();
    const addedElsewhere = "0198ffff-cccc-4ddd-8eee-ffffffffffff.pdf";
    // The device knows about one document and the bucket holds two. The second
    // belongs to a row this device has not pulled yet. Treating it as an orphan
    // is the failure this asymmetry exists to prevent.
    rows.mockResolvedValue([live(NAME)]);
    bytesFor.mockResolvedValue(new Uint8Array([1]));
    storage.list.mockResolvedValue({ data: [{ name: NAME }, { name: addedElsewhere }], error: null });

    await reconcileAttachments(USER);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("does nothing at all when the listing failed", async () => {
    const { reconcileAttachments } = await mirror();
    rows.mockResolvedValue([dead(NAME)]);
    storage.list.mockResolvedValue({ data: null as never, error: { message: "offline" } });

    await reconcileAttachments(USER);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("purges every object under the account before it is deleted", async () => {
    const { purgeRemoteAttachments } = await mirror();
    const second = "0198ffff-cccc-4ddd-8eee-ffffffffffff.pdf";
    storage.list.mockResolvedValue({ data: [{ name: NAME }, { name: second }], error: null });

    await purgeRemoteAttachments(USER);
    expect(storage.remove).toHaveBeenCalledWith([`${USER}/${NAME}`, `${USER}/${second}`]);
  });
});

describe("what the mirror fetches", () => {
  it("writes a downloaded document under the name that was asked for", async () => {
    const { fetchAttachment } = await mirror();
    storage.download.mockResolvedValue({ data: new Blob([new Uint8Array([7, 8])]), error: null });

    expect(await fetchAttachment(USER, NAME)).toBe(true);
    expect(storage.download).toHaveBeenCalledWith(`${USER}/${NAME}`);
    expect(written).toHaveBeenCalledTimes(1);
    expect(written.mock.calls[0]![0]).toBe(NAME);
  });

  it("answers false rather than throwing when the bucket does not have it", async () => {
    const { fetchAttachment } = await mirror();
    storage.download.mockResolvedValue({ data: null, error: { message: "not found" } });

    expect(await fetchAttachment(USER, NAME)).toBe(false);
    expect(written).not.toHaveBeenCalled();
  });

  it("refuses to write a document larger than the bound", async () => {
    const { fetchAttachment } = await mirror();
    const tooBig = { arrayBuffer: async () => new ArrayBuffer(25 * 1024 * 1024 + 1) } as Blob;
    storage.download.mockResolvedValue({ data: tooBig, error: null });

    expect(await fetchAttachment(USER, NAME)).toBe(false);
    expect(written).not.toHaveBeenCalled();
  });

  it("does nothing without a configured project", async () => {
    const { fetchAttachment, reconcileAttachments } = await mirror();
    configured = false;
    rows.mockResolvedValue([live(NAME)]);

    expect(await fetchAttachment(USER, NAME)).toBe(false);
    await reconcileAttachments(USER);
    expect(storage.list).not.toHaveBeenCalled();
  });
});

/**
 * The listing this session can skip, and the one it must not.
 *
 * Reconcile runs after every completed sync, so an unconditional listing hands
 * a network request back to a feature whose steady state is "nothing to do".
 * The cache that removes it is also the thing that could silently stop the
 * mirror forever, so both directions are pinned here.
 */
describe("when the mirror asks the bucket again", () => {
  it("stops listing once everything it knows about is settled", async () => {
    const { reconcileAttachments } = await mirror();
    rows.mockResolvedValue([live(NAME)]);
    bytesFor.mockResolvedValue(new Uint8Array([1]));

    await reconcileAttachments(USER);
    expect(storage.list).toHaveBeenCalledTimes(1);
    expect(storage.upload).toHaveBeenCalledTimes(1);

    await reconcileAttachments(USER);
    await reconcileAttachments(USER);
    expect(storage.list).toHaveBeenCalledTimes(1);
    expect(storage.upload).toHaveBeenCalledTimes(1);
  });

  it("lists again as soon as a document it has not sent appears", async () => {
    const { reconcileAttachments } = await mirror();
    rows.mockResolvedValue([live(NAME)]);
    bytesFor.mockResolvedValue(new Uint8Array([1]));
    await reconcileAttachments(USER);
    expect(storage.list).toHaveBeenCalledTimes(1);

    const added = "0198cccc-dddd-4eee-8fff-aaaaaaaaaaaa.pdf";
    rows.mockResolvedValue([live(NAME), live(added)]);
    await reconcileAttachments(USER);

    expect(storage.list).toHaveBeenCalledTimes(2);
    expect(storage.upload).toHaveBeenLastCalledWith(`${USER}/${added}`, expect.anything(), expect.anything());
  });

  it("lists again when a document it sent is later deleted", async () => {
    const { reconcileAttachments } = await mirror();
    rows.mockResolvedValue([live(NAME)]);
    bytesFor.mockResolvedValue(new Uint8Array([1]));
    await reconcileAttachments(USER);

    // The tombstone arrives, and the object is still up there.
    rows.mockResolvedValue([dead(NAME)]);
    storage.list.mockResolvedValue({ data: [{ name: NAME }], error: null });
    await reconcileAttachments(USER);

    expect(storage.list).toHaveBeenCalledTimes(2);
    expect(storage.remove).toHaveBeenCalledWith([`${USER}/${NAME}`]);
  });

  it("does not carry one account's listing into the next one's answers", async () => {
    const { reconcileAttachments } = await mirror();
    rows.mockResolvedValue([live(NAME)]);
    bytesFor.mockResolvedValue(new Uint8Array([1]));
    await reconcileAttachments(USER);
    expect(storage.list).toHaveBeenCalledTimes(1);

    // Signing out and in as somebody else. The cache above describes the first
    // account's bucket and must not be allowed to answer for the second's.
    await reconcileAttachments(OTHER);
    expect(storage.list).toHaveBeenCalledTimes(2);
    expect(storage.list.mock.calls[1]![0]).toBe(OTHER);
  });

  it("does not treat a failed first listing as knowledge", async () => {
    const { reconcileAttachments } = await mirror();
    rows.mockResolvedValue([live(NAME)]);
    bytesFor.mockResolvedValue(new Uint8Array([1]));
    storage.list.mockResolvedValue({ data: null as never, error: { message: "offline" } });

    await reconcileAttachments(USER);
    expect(storage.upload).not.toHaveBeenCalled();

    // Back online: the document must still be sent, not skipped as settled.
    storage.list.mockResolvedValue({ data: [], error: null });
    await reconcileAttachments(USER);
    expect(storage.upload).toHaveBeenCalledTimes(1);
  });
});
