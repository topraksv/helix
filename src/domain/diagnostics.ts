/** PII-free classification for local diagnostic events. */

export type DiagnosticCode = "network" | "auth" | "database" | "validation" | "cancelled" | "unknown";

export interface SafeDiagnosticEvent {
  at: string;
  scope: string;
  severity: "warning" | "error";
  code: DiagnosticCode;
}

export function classifyDiagnostic(error: unknown): DiagnosticCode {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/abort|cancel|epoch/i.test(text)) return "cancelled";
  if (/jwt|token|auth|unauthorized|401|password/i.test(text)) return "auth";
  if (/network|fetch|timeout|offline|socket/i.test(text)) return "network";
  if (/sqlite|database|migration|constraint|sql/i.test(text)) return "database";
  if (/invalid|parse|validation|malformed|unsupported/i.test(text)) return "validation";
  return "unknown";
}

/** Convert an arbitrary failure into the only shape allowed to persist. */
export function createDiagnosticEvent(
  scope: string,
  severity: SafeDiagnosticEvent["severity"],
  error: unknown,
  at = new Date(),
): SafeDiagnosticEvent {
  // Scopes are internal labels, not user input. Reject an unexpected shape
  // instead of sanitizing it into a persisted e-mail, path or other identifier.
  const normalizedScope = scope.trim().toLocaleLowerCase("en-US");
  const safeScope = /^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)*$/.test(normalizedScope) && normalizedScope.length <= 40
    ? normalizedScope
    : "app";
  return {
    at: at.toISOString(),
    scope: safeScope,
    severity,
    code: classifyDiagnostic(error),
  };
}
