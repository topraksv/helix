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
vi.mock("../src/services/kv", () => ({
  kv: {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => { store.set(key, value); },
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
  ({ at, scope, severity: "error" as const, code: code as "network" });

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
    expect(batches[0]).toEqual([
      { user_id: "user-1", occurred_at: "2026-08-01T00:00:00.000Z", scope: "sync.push", severity: "error", code: "network", platform: "ios", app_version: "1.0.0" },
      { user_id: "user-1", occurred_at: "2026-08-02T00:00:00.000Z", scope: "sync.push", severity: "error", code: "network", platform: "ios", app_version: "1.0.0" },
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
    // Give the ring's serialized writer a turn; `recordDiagnostic` is fire and
    // forget, so a regression here would land just after the await above.
    await new Promise((resolve) => setTimeout(resolve, 0));
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
    recordDiagnostic("sync.push", "error", new Error("fetch failed: offline"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const batches: DiagnosticUpload[][] = [];
    expect(await uploadDiagnostics(port(batches), "user-1", "android", "1.2.3")).toBe(1);
    const row = batches[0]![0]!;
    expect(row.scope).toBe("sync.push");
    expect(row.code).toBe("network");
    expect(row.platform).toBe("android");
    // No message, no stack, nowhere.
    expect(Object.keys(row).sort()).toEqual(
      ["app_version", "code", "occurred_at", "platform", "scope", "severity", "user_id"],
    );
    expect(JSON.stringify(row)).not.toContain("offline");
  });
});
