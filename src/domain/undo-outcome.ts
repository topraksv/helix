/**
 * Whether an undo actually restored anything: a fire-and-forget `void` callback
 * makes a failed restore look like a successful one. Pure; the caller supplies
 * the effect that reports a failure.
 */
type UndoOutcome = { ok: true } | { ok: false; error: unknown };

export async function runUndo(action: () => Promise<unknown>): Promise<UndoOutcome> {
  try {
    await action();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
