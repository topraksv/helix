/** PII-free classification for local diagnostic events. */

export type DiagnosticCode = "network" | "auth" | "database" | "validation" | "cancelled" | "unknown";

export interface SafeDiagnosticEvent {
  at: string;
  scope: string;
  severity: "warning" | "error";
  code: DiagnosticCode;
  /** The error's constructor name, when it is one this may keep. */
  name: string | null;
  /** Letter-only tokens of the message; null when the message was refused. */
  fingerprint: string | null;
  /** `fn@file:line:col` frames joined by `|`; null when there is no stack. */
  frames: string | null;
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


/**
 * Everything below turns a failure into something that names a CLASS of bug
 * without carrying a value.
 *
 * The rule this file already applied to `scope` — reject an unexpected shape
 * rather than sanitize it into a persisted identifier — is the rule these
 * follow too, because sanitizing is where redaction quietly fails: a masked
 * message still has the shape of what was masked, and one missed pattern is a
 * permanent record. So a message is kept whole or refused whole, and a stack
 * frame is rebuilt from an allowlist rather than filtered.
 *
 * What that costs is real and worth stating: an all-ASCII message that happens
 * to contain a person or category name written without Turkish letters
 * survives as tokens. The residual is bounded by this being the owner's own
 * incident log, in the owner's own project, behind RLS that only they can read.
 */

/** Any of these means the text may be carrying an identifier rather than a
 *  class of failure: `@` an address, a slash a filesystem or URL path, and a
 *  non-ASCII letter is this app's own Turkish content — category names, person
 *  names, notes. One occurrence refuses the whole message. */
const UNSAFE_MESSAGE = /[@/\\]|[^\u0000-\u007F]/;

const MAX_FINGERPRINT_TOKENS = 8;
const MAX_FINGERPRINT_LENGTH = 120;
const MAX_FRAMES = 8;
const MAX_FRAMES_LENGTH = 600;

/** The message reduced to its letter runs: digits, and therefore every amount,
 *  date and account number, cannot survive the tokenizer at all. */
export function fingerprintMessage(error: unknown): string | null {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!text || UNSAFE_MESSAGE.test(text)) return null;
  const tokens = text.match(/[A-Za-z]{2,24}/g);
  if (!tokens) return null;
  return tokens.slice(0, MAX_FINGERPRINT_TOKENS).join(" ").slice(0, MAX_FINGERPRINT_LENGTH);
}

export function errorName(error: unknown): string | null {
  if (!(error instanceof Error) || typeof error.name !== "string") return null;
  return /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(error.name) ? error.name : null;
}

/**
 * One stack line as `fn@file:line:col`, or null if it is not a frame.
 *
 * The directories above the file are dropped rather than shortened. That is
 * where a real name lives: a development build's stack is full of the build
 * machine's home directory, and on Hermes the frame reads
 * `address at /…/main.jsbundle:1:284713`, whose prefix is discarded here for
 * the same reason. The file's own name is what identifies the code.
 */
function redactFrame(rawLine: string): string | null {
  const line = rawLine.trim();
  if (!line.startsWith("at ")) return null;
  const body = line.slice(3).trim();
  const open = body.lastIndexOf("(");
  const parenthesized = open >= 0 && body.endsWith(")");
  const location = parenthesized ? body.slice(open + 1, -1) : body;
  const position = /:(\d+):(\d+)$/.exec(location);
  if (!position) return null;
  const path = location.slice(0, position.index);
  const file = path
    .slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1)
    .replace(/[^A-Za-z0-9_.-]/g, "")
    .slice(0, 40);
  if (!file) return null;
  const name = (parenthesized ? body.slice(0, open) : "")
    .trim()
    .replace(/[^A-Za-z0-9_.$<>]/g, "")
    .slice(0, 40);
  return `${name ? `${name}@` : ""}${file}:${position[1]}:${position[2]}`;
}

export function redactStack(error: unknown): string | null {
  if (!(error instanceof Error) || typeof error.stack !== "string") return null;
  const frames: string[] = [];
  for (const line of error.stack.split("\n")) {
    const frame = redactFrame(line);
    if (frame) frames.push(frame);
    if (frames.length === MAX_FRAMES) break;
  }
  return frames.length > 0 ? frames.join("|").slice(0, MAX_FRAMES_LENGTH) : null;
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
    name: errorName(error),
    fingerprint: fingerprintMessage(error),
    frames: redactStack(error),
  };
}
