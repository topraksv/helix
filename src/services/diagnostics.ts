/** PII-free, device-local incident breadcrumbs for development support. */

import { kv } from "../lib/kv";
import { createDiagnosticEvent, type SafeDiagnosticEvent } from "../domain/diagnostics";

const EVENTS_KEY = "helix.diagnostic_events.v1";
const MAX_EVENTS = 12;

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
