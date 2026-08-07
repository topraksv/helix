/**
 * PII-free incident breadcrumbs: recorded on the device, and — once there is an
 * account and a network — uploaded to the owner's own project.
 *
 * The ring stayed device-local for a long time, which meant a crash on the
 * owner's phone produced exactly one signal: the owner noticing. A failure that
 * only happens on iOS, or only offline, or only after a migration, left nothing
 * anyone could read. `uploadDiagnostics` closes that without changing what is
 * recorded: the same four fields, the same redaction, into a table whose CHECK
 * constraints refuse anything wider (`supabase/migrations/…_diagnostic_events`).
 *
 * Nothing here may record a diagnostic of its own. A failing upload that logged
 * its own failure would grow the ring on every attempt and then try to upload
 * that too.
 */

import { kv } from "./kv";
import { createDiagnosticEvent, type SafeDiagnosticEvent } from "../domain/diagnostics";

const EVENTS_KEY = "helix.diagnostic_events.v1";
const MAX_EVENTS = 12;
/** The high-water mark of what has already been uploaded. */
const UPLOADED_KEY = "helix.diagnostic_events.uploaded.v1";

type DiagnosticEvent = SafeDiagnosticEvent;

let eventWrite = Promise.resolve();

/** Persist only scope/category/time. Raw errors and financial values never leave memory. */
export function recordDiagnostic(scope: string, severity: DiagnosticEvent["severity"], error: unknown): void {
  const event = createDiagnosticEvent(scope, severity, error);
  eventWrite = eventWrite
    .then(async () => {
      let previous: DiagnosticEvent[] = [];
      try {
        const raw = await kv.get(EVENTS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) previous = parsed.filter(isDiagnosticEvent);
      } catch {
        // A corrupt diagnostic ring is replaceable; finance data is untouched.
      }
      await kv.set(EVENTS_KEY, JSON.stringify([...previous, event].slice(-MAX_EVENTS)));
    })
    .catch(() => {});
}

/** The row shape the table accepts; nothing wider exists on this path. */
export interface DiagnosticUpload {
  user_id: string;
  occurred_at: string;
  scope: string;
  severity: DiagnosticEvent["severity"];
  code: DiagnosticEvent["code"];
  platform: "ios" | "android" | "web";
  app_version: string;
}

export interface DiagnosticUploadPort {
  /** Insert, ignoring the rows this device already sent. */
  upload(rows: DiagnosticUpload[]): Promise<void>;
}

/**
 * Which events are new since the last successful upload.
 *
 * A watermark rather than a delete: the ring is what the device shows its owner
 * when there is no network, and an upload must not be the thing that empties
 * it. `at` is an ISO instant, so string order is time order.
 */
export function pendingDiagnostics(events: DiagnosticEvent[], uploadedThrough: string | null): DiagnosticEvent[] {
  return events.filter((event) => !uploadedThrough || event.at > uploadedThrough);
}

/**
 * Send everything recorded since the last upload.
 *
 * Silent on failure and safe to call on every sync: the table's identity index
 * makes a re-send a no-op, and the watermark only advances once the insert has
 * actually landed. Offline, the ring simply keeps its twelve.
 */
export async function uploadDiagnostics(
  port: DiagnosticUploadPort,
  userId: string,
  platform: DiagnosticUpload["platform"],
  appVersion: string,
): Promise<number> {
  try {
    const raw = await kv.get(EVENTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const events = Array.isArray(parsed) ? parsed.filter(isDiagnosticEvent) : [];
    const pending = pendingDiagnostics(events, await kv.get(UPLOADED_KEY));
    if (pending.length === 0) return 0;
    await port.upload(pending.map((event) => ({
      user_id: userId,
      occurred_at: event.at,
      scope: event.scope,
      severity: event.severity,
      code: event.code,
      platform,
      app_version: appVersion,
    })));
    await kv.set(UPLOADED_KEY, pending[pending.length - 1]!.at);
    return pending.length;
  } catch {
    // Deliberately not recorded. A diagnostic about the diagnostic upload
    // grows the ring on every failed attempt and then queues itself for the
    // next one.
    return 0;
  }
}

/** A new account starts its own history; the previous owner's watermark is not it. */
export async function resetDiagnosticUploads(): Promise<void> {
  try {
    await kv.remove(UPLOADED_KEY);
  } catch {
    // Same rule as above.
  }
}

function isDiagnosticEvent(value: unknown): value is DiagnosticEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<DiagnosticEvent>;
  return (
    typeof event.at === "string" &&
    typeof event.scope === "string" &&
    (event.severity === "warning" || event.severity === "error") &&
    ["network", "auth", "database", "validation", "cancelled", "unknown"].includes(event.code ?? "")
  );
}
