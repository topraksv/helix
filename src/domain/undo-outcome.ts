/**
 * Whether an undo actually restored anything.
 *
 * Undo callbacks were written as `() => void restoreRow(...)`: the snackbar
 * dismissed itself the moment it was tapped, so a failed restore looked exactly
 * like a successful one and the row stayed deleted with no message. `void` is
 * not error handling — it only silences the floating-promise lint.
 *
 * The decision is pure so it can be asserted without a renderer; the caller
 * supplies the effect that reports a failure.
 */
export type UndoOutcome = { ok: true } | { ok: false; error: unknown };

export async function runUndo(action: () => Promise<unknown>): Promise<UndoOutcome> {
  try {
    await action();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
