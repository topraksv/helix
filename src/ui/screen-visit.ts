/**
 * A tiny external store for screen-arrival events.
 *
 * The arrival counter belongs to motion consumers, not to the Screen render
 * tree. Keeping it here lets the navigator notify only the entrance wrapper,
 * charts and hero figures; the page's data and form subtree remain settled.
 */
export interface ScreenVisitStore {
  getSnapshot: () => number;
  subscribe: (listener: () => void) => () => void;
  increment: () => void;
}

export function createScreenVisitStore(initial = 1): ScreenVisitStore {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    increment: () => {
      snapshot += 1;
      for (const listener of listeners) listener();
    },
  };
}
