/** Pure decision shared by form navigation guards and tests. */
export function shouldBlockDirtyExit(dirty: boolean, explicitlyAllowed: boolean): boolean {
  return dirty && !explicitlyAllowed;
}

interface AsyncFieldState {
  /** What the control renders. */
  value: string;
  /** Real user intent: they typed. NOT inferred from comparing values. */
  edited: boolean;
  /** Whether a save may be offered at all. */
  canSave: boolean;
}

/**
 * A text control whose default arrives asynchronously. Seeding `useState` from
 * an unresolved live query freezes the placeholder, and a save button comparing
 * the frozen draft to the later value stays enabled and overwrites the real
 * setting. So dirtiness is the presence of a draft, never value equality.
 *
 * `resolved === null` means not known yet (loading, or the read failed): saving
 * is refused even when the user has typed, since it would overwrite a value
 * that was never loaded.
 */
export function asyncFieldState(
  draft: string | null,
  resolved: string | null,
  isValid: (value: string) => boolean = () => true,
): AsyncFieldState {
  const edited = draft !== null;
  const value = draft ?? resolved ?? "";
  if (resolved === null) return { value, edited, canSave: false };
  // `value` is `draft ?? resolved`, so a difference from `resolved` already proves a draft exists.
  return { value, edited, canSave: value !== resolved && isValid(value) };
}
