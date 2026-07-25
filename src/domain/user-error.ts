/**
 * The boundary between an engine failure and something a user can act on.
 *
 * Repository, database and platform errors carry English technical text
 * ("Invalid opening balance month", a SQLite constraint, a storage quota
 * message). Rendering that verbatim tells a Turkish user nothing and exposes
 * internals, so a screen may only show a message that was written for them.
 *
 * `UserFacingError` is that promise: throw it with a `tr.*` string when the
 * remedy is genuinely the user's, and `userMessage` will pass it through.
 * Everything else collapses to the caller's own fallback — which keeps precise
 * import/backup diagnostics intact instead of flattening every failure into one
 * vague sentence.
 */

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/**
 * The message to show for a caught failure.
 *
 * Instance checks alone are not enough: a bundle validated inside a dynamically
 * imported module, or re-thrown across a realm, can arrive as a plain `Error`
 * carrying the same authored text. The marker property survives that, so both
 * shapes resolve to the user's message.
 */
export function userMessage(error: unknown, fallback: string): string {
  if (error instanceof UserFacingError) return error.message;
  if (
    error instanceof Error &&
    error.name === "UserFacingError" &&
    error.message.trim() !== ""
  ) {
    return error.message;
  }
  return fallback;
}
