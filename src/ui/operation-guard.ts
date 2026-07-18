import { useRef } from "react";

export type OperationResult<T> =
  | { started: false }
  | { started: true; value: T };

export interface OperationGuard {
  readonly active: boolean;
  run<T>(operation: () => Promise<T>): Promise<OperationResult<T>>;
}

/**
 * A synchronous gate around async mutations. React state cannot protect the
 * interval between the first press and the render that applies `disabled`, so
 * the gate flips before the operation callback is invoked. It always releases
 * in `finally`, including validation/network failures.
 */
export function createOperationGuard(): OperationGuard {
  let active = false;
  return {
    get active() {
      return active;
    },
    async run<T>(operation: () => Promise<T>): Promise<OperationResult<T>> {
      if (active) return { started: false };
      active = true;
      try {
        return { started: true, value: await operation() };
      } finally {
        active = false;
      }
    },
  };
}

/** One gate for the lifetime of a mounted form. */
export function useOperationGuard(): OperationGuard {
  const ref = useRef<OperationGuard | null>(null);
  if (ref.current == null) ref.current = createOperationGuard();
  return ref.current;
}
