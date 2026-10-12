/**
 * Per-key serial queue: runs for the SAME key never overlap, and every caller
 * gets a run that starts AFTER its own call. A boolean "already running" flag
 * cannot give the second: a skipped run resolves like success, so callers
 * awaiting their own writes silently get nothing. Keys are independent. A
 * rejected run propagates to its own caller only and never wedges the chain.
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
