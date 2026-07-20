/** Pure decision shared by form navigation guards and tests. */
export function shouldBlockDirtyExit(dirty: boolean, explicitlyAllowed: boolean): boolean {
  return dirty && !explicitlyAllowed;
}

export interface AsyncFieldState {
  /** What the control renders. */
  value: string;
  /** Real user intent: they typed. NOT inferred from comparing values. */
  edited: boolean;
  /** Whether a save may be offered at all. */
  canSave: boolean;
}

/**
 * A text control whose default arrives asynchronously.
 *
 * Seeding `useState` from an unresolved live query froze the placeholder: the
 * settings reminder field captured the fallback `3` forever, and because the
 * save button compared the frozen draft against the later-resolved value
 * (`3 !== 7`), it stayed ENABLED — one tap silently overwrote the user's real
 * setting with the placeholder.
 *
 * Dirtiness is therefore the presence of a draft, never value equality:
 * `draft === null` means "the user has not typed", which is a different fact
 * from "the draft happens to equal the stored value".
 *
 * `resolved === null` means the value is not known yet (still loading, or the
 * read failed). Saving is refused in that state even when the user has typed,
 * because writing over a value that was never loaded is exactly the overwrite
 * this function exists to prevent.
 */
export function asyncFieldState(
  draft: string | null,
  resolved: string | null,
  isValid: (value: string) => boolean = () => true,
): AsyncFieldState {
  const edited = draft !== null;
  const value = draft ?? resolved ?? "";
  if (resolved === null) return { value, edited, canSave: false };
  // `value` is `draft ?? resolved`, so a difference from `resolved` already
  // proves a draft exists — an extra `edited &&` here would be unreachable.
  return { value, edited, canSave: value !== resolved && isValid(value) };
}
