/**
 * Per-key serial queue.
 *
 * Guarantees two things at once, which a boolean "already running" flag cannot:
 *   1. two runs for the SAME key never overlap;
 *   2. every caller gets a run that starts AFTER its own call.
 *
 * The second property is why a flag is wrong here. `if (running) return;`
 * resolves `Promise<void>` exactly like success, so a skipped run is
 * indistinguishable from a completed one — and callers that await the work in
 * order to observe their own writes silently get nothing. Requests therefore
 * chain instead of being dropped.
 *
 * Keys are independent: one account's work never blocks another's. A rejected
 * run propagates to its own caller only; it orders its successors without
 * failing them, and never wedges the chain.
 */
export function createSerialQueue<T>(): (key: string, task: (key: string) => Promise<T>) => Promise<T> {
  const tail = new Map<string, Promise<unknown>>();

  return async function enqueue(key: string, task: (key: string) => Promise<T>): Promise<T> {
    const previous = tail.get(key);
    // A failed predecessor must order its successor, not fail it.
    const run = (previous ? previous.catch(() => {}) : Promise.resolve()).then(() => task(key));
    tail.set(key, run);
    try {
      return await run;
    } finally {
      // Only the current tail clears itself, so a later enqueue that already
      // chained onto this run keeps its ordering.
      if (tail.get(key) === run) tail.delete(key);
    }
  };
}
