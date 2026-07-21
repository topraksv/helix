/**
 * One-at-a-time request queue for the promise-based overlays.
 *
 * `appAlert`/`appConfirm`/`appPrompt` hand a `resolve` to a store and await it,
 * so a store that keeps a SINGLE slot loses a promise as soon as two requests
 * overlap: the second overwrites `current`, the first `resolve` is dropped, and
 * its `await` never settles. Both re-auth call sites (`account-security.tsx`,
 * `settings/index.tsx`) sit on different screens, so overlap is reachable.
 *
 * The reducer lives here, outside the component file, for one reason: `dialog.tsx`
 * imports react-native and cannot be loaded by vitest, so the logic could only be
 * covered by a copy of itself in the test. Two hosts plus a test copy is three
 * places for the same four lines to drift; this is the one place.
 */

export interface RequestQueue<T> {
  /** The request currently on screen; `null` when nothing is open. */
  current: T | null;
  /** Requests waiting behind it, oldest first. */
  queue: T[];
}

export function emptyRequestQueue<T>(): RequestQueue<T> {
  return { current: null, queue: [] };
}

/** Show `request` immediately when idle, otherwise park it behind the queue. */
export function enqueueRequest<T>(state: RequestQueue<T>, request: T): RequestQueue<T> {
  return state.current == null
    ? { current: request, queue: state.queue }
    : { current: state.current, queue: [...state.queue, request] };
}

/**
 * Close the open request and promote the next one.
 *
 * Advancing is separate from resolving on purpose: the caller resolves AFTER the
 * store has moved on, so a `resolve` handler that opens another request enqueues
 * against the already-advanced state instead of being overwritten by it.
 */
export function advanceRequestQueue<T>(state: RequestQueue<T>): RequestQueue<T> {
  return { current: state.queue[0] ?? null, queue: state.queue.slice(1) };
}
