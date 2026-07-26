import { useEffect, useRef, useState } from "react";
import type { ProgressValue } from "./loading-indicator";

type OperationResult<T> =
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

export class OperationCancelledError extends Error {
  constructor() {
    super("Operation cancelled");
    this.name = "OperationCancelledError";
  }
}

export interface TrackedOperationContext {
  signal: AbortSignal;
  report(completed: number, total: number): void;
}

export interface TrackedOperationState {
  active: boolean;
  progress: ProgressValue | null;
}

type TrackedTask = (context: TrackedOperationContext) => Promise<void>;

/**
 * Adds caller-owned progress and cancellation to the synchronous operation
 * gate. Controller identity prevents a late report or completion from an old
 * task from overwriting the current operation state.
 */
export function useTrackedOperation() {
  const guard = useOperationGuard();
  const [state, setState] = useState<TrackedOperationState>({
    active: false,
    progress: null,
  });
  const controllerRef = useRef<AbortController | null>(null);

  const run = async (task: TrackedTask): Promise<OperationResult<void>> => {
    if (guard.active) return { started: false };
    return guard.run(async () => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setState({ active: true, progress: null });
      try {
        await task({
          signal: controller.signal,
          report(completed, total) {
            if (controllerRef.current !== controller) return;
            setState({ active: true, progress: { completed, total } });
          },
        });
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setState({ active: false, progress: null });
        }
      }
    });
  };

  const cancel = () => {
    controllerRef.current?.abort(new OperationCancelledError());
  };

  useEffect(() => () => {
    const controller = controllerRef.current;
    controllerRef.current = null;
    controller?.abort(new OperationCancelledError());
  }, []);

  return { state, run, cancel };
}
