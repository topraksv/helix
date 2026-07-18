/** PII-free local health events in production; raw details only in development. */
import { recordDiagnostic } from "./diagnostics";

export function devError(scope: string, error: unknown, detail?: unknown): void {
  recordDiagnostic(scope, "error", error);
  if (typeof __DEV__ !== "undefined" && __DEV__) console.error(`[${scope}]`, error, detail ?? "");
}

export function devWarning(scope: string, message: string): void {
  recordDiagnostic(scope, "warning", message);
  if (typeof __DEV__ !== "undefined" && __DEV__) console.warn(`[${scope}]`, message);
}
