/**
 * The failure-telemetry upload.
 *
 * Two properties matter more than the transport, and both are about what the
 * upload must NOT do. It must not empty the device's own ring — that ring is
 * what the owner has when there is no network. And it must never record a
 * diagnostic about itself: a failing upload that logged its failure would grow
 * the ring on every attempt and then queue that growth for the next one.
 *
 * The redaction is not tested here because it is not performed here.
 * `createDiagnosticEvent` builds the only shape that persists
 * (`tests/diagnostics.test.ts`), and the table's CHECK constraints refuse
 * anything wider (`supabase/tests/owner_integrity_and_rls.sql`). This file
 * covers the seam between them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
let nextSetObserver: ((write: { key: string; value: string }) => void) | null = null;
vi.mock("../src/services/kv", () => ({
  kv: {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      nextSetObserver?.({ key, value });
      nextSetObserver = null;
    },
    remove: async (key: string) => { store.delete(key); },
  },
}));

const { pendingDiagnostics, recordDiagnostic, resetDiagnosticUploads, uploadDiagnostics } = await import(
  "../src/services/diagnostics"
);
type DiagnosticUpload = Parameters<
  Parameters<typeof uploadDiagnostics>[0]["upload"]
>[0][number];
const EVENTS_KEY = "helix.diagnostic_events.v1";
const UPLOADED_KEY = "helix.diagnostic_events.uploaded.v1";

const event = (at: string, scope = "sync.push", code = "network") =>
  ({ at, scope, severity: "error" as const, code: code as "network", name: null, fingerprint: null, frames: null });

function observeNextSet(): Promise<{ key: string; value: string }> {
  return new Promise((resolve) => { nextSetObserver = resolve; });
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function port(rows: DiagnosticUpload[][], fail = false) {
  return {
    async upload(batch: DiagnosticUpload[]) {
      if (fail) throw new Error("network");
      rows.push(batch);
    },
  };
}

beforeEach(() => store.clear());

describe("pendingDiagnostics", () => {
  it("returns everything when nothing has been uploaded", () => {
    const events = [event("2026-08-01T00:00:00.000Z"), event("2026-08-02T00:00:00.000Z")];
    expect(pendingDiagnostics(events, null)).toHaveLength(2);
  });

  it("returns only what happened after the watermark", () => {
    const events = [
      event("2026-08-01T00:00:00.000Z"),
      event("2026-08-02T00:00:00.000Z"),
      event("2026-08-03T00:00:00.000Z"),
    ];
    expect(pendingDiagnostics(events, "2026-08-02T00:00:00.000Z").map((e) => e.at))
      .toEqual(["2026-08-03T00:00:00.000Z"]);
  });

  it("treats an event recorded at the watermark as already sent", () => {
    // The watermark IS the last uploaded instant, so `>` rather than `>=` is
    // what keeps the boundary event from being sent a second time.
    const events = [event("2026-08-02T00:00:00.000Z")];
    expect(pendingDiagnostics(events, "2026-08-02T00:00:00.000Z")).toEqual([]);
  });
});

describe("uploadDiagnostics", () => {
  it("sends the ring and stamps every row with the caller's identity", async () => {
    store.set(EVENTS_KEY, JSON.stringify([event("2026-08-01T00:00:00.000Z"), event("2026-08-02T00:00:00.000Z")]));
    const batches: DiagnosticUpload[][] = [];
    const count = await uploadDiagnostics(port(batches), "user-1", "ios", "1.0.0");
    expect(count).toBe(2);
    const row = { scope: "sync.push", severity: "error", code: "network", platform: "ios", app_version: "1.0.0", error_name: null, fingerprint: null, frames: null };
    expect(batches[0]).toEqual([
      { user_id: "user-1", occurred_at: "2026-08-01T00:00:00.000Z", ...row },
      { user_id: "user-1", occurred_at: "2026-08-02T00:00:00.000Z", ...row },
    ]);
  });

  it("leaves the device's own ring intact", async () => {
    const ring = JSON.stringify([event("2026-08-01T00:00:00.000Z")]);
    store.set(EVENTS_KEY, ring);
    await uploadDiagnostics(port([]), "user-1", "web", "1.0.0");
    expect(store.get(EVENTS_KEY), "the offline record survives its own upload").toBe(ring);
  });

  it("does not send the same incident twice", async () => {
    store.set(EVENTS_KEY, JSON.stringify([event("2026-08-01T00:00:00.000Z")]));
    const batches: DiagnosticUpload[][] = [];
    expect(await uploadDiagnostics(port(batches), "user-1", "web", "1.0.0")).toBe(1);
    expect(await uploadDiagnostics(port(batches), "user-1", "web", "1.0.0")).toBe(0);
    expect(batches).toHaveLength(1);
  });

  it("does not advance the watermark when the upload fails", async () => {
    store.set(EVENTS_KEY, JSON.stringify([event("2026-08-01T00:00:00.000Z")]));
    expect(await uploadDiagnostics(port([], true), "user-1", "web", "1.0.0")).toBe(0);
    expect(store.get(UPLOADED_KEY)).toBeUndefined();
    // And the next attempt still has it to send.
    const batches: DiagnosticUpload[][] = [];
    expect(await uploadDiagnostics(port(batches), "user-1", "web", "1.0.0")).toBe(1);
  });

  it("records no diagnostic of its own when it fails", async () => {
    store.set(EVENTS_KEY, JSON.stringify([event("2026-08-01T00:00:00.000Z")]));
    const before = store.get(EVENTS_KEY);
    await uploadDiagnostics(port([], true), "user-1", "web", "1.0.0");
    // A diagnostic write is a microtask-only chain. Drain that queue without a
    // wall-clock turn so a self-recording regression cannot land after assert.
    await flushMicrotasks();
    expect(store.get(EVENTS_KEY), "an upload failure must not become an incident").toBe(before);
  });

  it("survives a corrupt ring without throwing into the sync that called it", async () => {
    store.set(EVENTS_KEY, "{not json");
    await expect(uploadDiagnostics(port([]), "user-1", "web", "1.0.0")).resolves.toBe(0);
  });

  it("starts a fresh history for a new account", async () => {
    store.set(EVENTS_KEY, JSON.stringify([event("2026-08-01T00:00:00.000Z")]));
    await uploadDiagnostics(port([]), "user-1", "web", "1.0.0");
    expect(store.get(UPLOADED_KEY)).toBe("2026-08-01T00:00:00.000Z");
    await resetDiagnosticUploads();
    expect(store.get(UPLOADED_KEY)).toBeUndefined();
  });

  it("uploads what the recorder actually wrote, end to end", async () => {
    const recorded = observeNextSet();
    recordDiagnostic("sync.push", "error", new Error("fetch failed: offline"));
    expect((await recorded).key).toBe(EVENTS_KEY);
    const batches: DiagnosticUpload[][] = [];
    expect(await uploadDiagnostics(port(batches), "user-1", "android", "1.2.3")).toBe(1);
    const row = batches[0]![0]!;
    expect(row.scope).toBe("sync.push");
    expect(row.code).toBe("network");
    expect(row.platform).toBe("android");
    // The exact column set this path may write. It is asserted rather than
    // sampled because the point of the list is that nothing joins it quietly:
    // migration 33 widened it once, deliberately, and the CHECK constraints on
    // the three new columns are the database's half of the same argument.
    expect(Object.keys(row).sort()).toEqual(
      ["app_version", "code", "error_name", "fingerprint", "frames", "occurred_at", "platform", "scope", "severity", "user_id"],
    );
    // The message survives only as its letter runs, which is what makes one
    // network failure tellable from another. `Error` is the constructor name.
    expect(row.error_name).toBe("Error");
    expect(row.fingerprint).toBe("fetch failed offline");
  });
});

/**
 * The two ways this path meets a version of itself that it does not match:
 * a ring written before migration 33's fields existed, and a project that has
 * not taken migration 33 yet. Both have to keep the incident.
 */
describe("uploadDiagnostics across a schema change", () => {
  it("uploads a ring recorded before the error fields existed", async () => {
    // Exactly what `recordDiagnostic` wrote until migration 33: four keys, no
    // name, no fingerprint, no frames. Dropping it on upgrade would throw away
    // the twelve incidents most likely to explain the upgrade.
    store.set(EVENTS_KEY, JSON.stringify([
      { at: "2026-08-01T00:00:00.000Z", scope: "sync.push", severity: "error", code: "network" },
    ]));
    const batches: DiagnosticUpload[][] = [];

    expect(await uploadDiagnostics(port(batches), "user-1", "ios", "1.0.0")).toBe(1);
    expect(batches[0]![0]).toMatchObject({ error_name: null, fingerprint: null, frames: null });
  });

  it("retries without the new columns when the project has not taken migration 33", async () => {
    store.set(EVENTS_KEY, JSON.stringify([
      { at: "2026-08-01T00:00:00.000Z", scope: "sync.push", severity: "error", code: "network",
        name: "TypeError", fingerprint: "cannot read", frames: "run@engine.ts:1:2" },
    ]));
    const batches: DiagnosticUpload[][] = [];
    const rejectOnce = {
      async upload(batch: DiagnosticUpload[]) {
        if (batches.length === 0) {
          batches.push(batch);
          throw Object.assign(new Error("Could not find the 'frames' column"), { code: "PGRST204" });
        }
        batches.push(batch);
      },
    };

    expect(await uploadDiagnostics(rejectOnce, "user-1", "ios", "1.0.0")).toBe(1);
    expect(batches).toHaveLength(2);
    expect(batches[0]![0]).toHaveProperty("frames", "run@engine.ts:1:2");
    // The narrowed retry sends the row the pre-33 table will accept, and the
    // watermark advances, so the incident is recorded once and not re-sent.
    expect(Object.keys(batches[1]![0]!)).not.toContain("frames");
    expect(store.get(UPLOADED_KEY)).toBe("2026-08-01T00:00:00.000Z");
  });

  it("does not narrow the row for a failure that is not a missing column", async () => {
    store.set(EVENTS_KEY, JSON.stringify([
      { at: "2026-08-01T00:00:00.000Z", scope: "sync.push", severity: "error", code: "network" },
    ]));
    let attempts = 0;
    const offline = {
      async upload() {
        attempts += 1;
        throw new Error("network request failed");
      },
    };

    expect(await uploadDiagnostics(offline, "user-1", "ios", "1.0.0")).toBe(0);
    expect(attempts).toBe(1);
    expect(store.get(UPLOADED_KEY)).toBeUndefined();
  });
});

/**
 * What migration 33 is allowed to have widened.
 *
 * These run through `recordDiagnostic` rather than the pure redactors so they
 * assert the shipping path: the ring, the guard that reads it back, and the row
 * the port is handed. A redactor that is correct in isolation and bypassed here
 * would leave the same record behind.
 */
describe("what reaches the server after migration 33", () => {
  const uploadOf = async (error: unknown): Promise<DiagnosticUpload> => {
    store.clear();
    const recorded = observeNextSet();
    recordDiagnostic("sync.push", "error", error);
    await recorded;
    const batches: DiagnosticUpload[][] = [];
    await uploadDiagnostics(port(batches), "user-1", "ios", "1.0.0");
    return batches[0]![0]!;
  };

  it("carries no amount, because digits cannot survive the tokenizer", async () => {
    const row = await uploadOf(new Error("insert failed: amount_minor=125000 exceeds 9007199254740991"));
    expect(row.fingerprint).toBe("insert failed amount minor exceeds");
    expect(JSON.stringify(row)).not.toMatch(/125000|9007199254740991/);
  });

  it("refuses the whole message when it carries an address", async () => {
    const row = await uploadOf(new Error("sign-in rejected for owner@example.com"));
    expect(row.fingerprint).toBeNull();
    expect(JSON.stringify(row)).not.toMatch(/owner|example/);
  });

  it("refuses the whole message when it carries this app's own Turkish content", async () => {
    const row = await uploadOf(new Error("kategori bulunamadı: Market Alışverişi"));
    expect(row.fingerprint).toBeNull();
    expect(JSON.stringify(row)).not.toMatch(/Market|kategori/);
  });

  it("refuses the whole message when it carries a path", async () => {
    const row = await uploadOf(new Error("cannot open /Users/someone/helix/db.sqlite"));
    expect(row.fingerprint).toBeNull();
    expect(JSON.stringify(row)).not.toContain("someone");
  });

  it("keeps stack frames as file and position, never the directories above", async () => {
    const error = new Error("boom");
    error.stack = [
      "Error: boom",
      "    at pullAndMerge (/Users/someone/helix/src/sync/engine.ts:291:17)",
      "    at /Users/someone/helix/src/sync/engine.ts:401:11",
      "    at Object.<anonymous> (address at /var/containers/Bundle/main.jsbundle:1:284713)",
    ].join("\n");
    const row = await uploadOf(error);

    expect(row.frames).toBe(
      "pullAndMerge@engine.ts:291:17|engine.ts:401:11|Object.<anonymous>@main.jsbundle:1:284713",
    );
    expect(row.frames).not.toContain("someone");
    expect(row.frames).not.toContain("Users");
  });

  it("holds every column inside the shape its CHECK constraint accepts", async () => {
    const error = new Error("a".repeat(400));
    error.stack = ["Error", ...Array.from({ length: 40 }, (_, i) => `    at fn${i} (/x/file${i}.ts:${i}:1)`)].join("\n");
    const row = await uploadOf(error);

    expect(row.error_name).toMatch(/^[A-Za-z][A-Za-z0-9_]{0,39}$/);
    expect(row.fingerprint!.length).toBeLessThanOrEqual(120);
    expect(row.fingerprint).toMatch(/^[A-Za-z]+( [A-Za-z]+)*$/);
    expect(row.frames!.length).toBeLessThanOrEqual(600);
    expect(row.frames).toMatch(/^[A-Za-z0-9_.$<>@:|-]+$/);
    // Eight frames, so a deep stack cannot become the whole row.
    expect(row.frames!.split("|")).toHaveLength(8);
  });
});
