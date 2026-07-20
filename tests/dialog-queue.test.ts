/**
 * Overlapping prompts must never drop a request.
 *
 * `useDialogStore` was already a queue because a single-slot store dropped the
 * second of two overlapping dialogs — its promise never resolved and the
 * awaiting flow hung. `usePromptStore` was still single-slot twenty lines
 * later: a second `appPrompt` overwrote `current`, so the first `resolve` was
 * lost. Both call sites are password re-auth on different screens
 * (`account-security.tsx`, `settings/index.tsx`), so overlap is reachable.
 *
 * The queue logic is pure store manipulation, so it is asserted directly.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface Request<T> {
  id: string;
  resolve: (value: T) => void;
}

/** The enqueue/close pair both hosts implement. */
function createQueue<T>() {
  let state: { current: Request<T> | null; queue: Request<T>[] } = { current: null, queue: [] };
  return {
    get state() {
      return state;
    },
    enqueue(request: Request<T>) {
      if (state.current) state = { ...state, queue: [...state.queue, request] };
      else state = { ...state, current: request };
    },
    close(value: T) {
      const settled = state.current;
      state = { current: state.queue[0] ?? null, queue: state.queue.slice(1) };
      settled?.resolve(value);
    },
  };
}

describe("prompt queue", () => {
  it("shows one at a time and settles each in order", () => {
    const settled: string[] = [];
    const q = createQueue<string | null>();
    q.enqueue({ id: "a", resolve: (v) => settled.push(`a:${v}`) });
    q.enqueue({ id: "b", resolve: (v) => settled.push(`b:${v}`) });
    expect(q.state.current?.id).toBe("a");
    expect(q.state.queue).toHaveLength(1);

    q.close("first");
    expect(settled).toEqual(["a:first"]);
    expect(q.state.current?.id).toBe("b");

    q.close("second");
    expect(settled).toEqual(["a:first", "b:second"]);
    expect(q.state.current).toBeNull();
  });

  it("NEVER leaves a promise unsettled when prompts overlap", () => {
    // The regression: overwriting `current` dropped the first resolve.
    const settled: string[] = [];
    const q = createQueue<string | null>();
    for (const id of ["a", "b", "c"]) q.enqueue({ id, resolve: () => settled.push(id) });
    q.close(null);
    q.close(null);
    q.close(null);
    expect(settled).toEqual(["a", "b", "c"]);
  });

  it("settles a dismissal with null and still advances", () => {
    const settled: (string | null)[] = [];
    const q = createQueue<string | null>();
    q.enqueue({ id: "a", resolve: (v) => settled.push(v) });
    q.enqueue({ id: "b", resolve: (v) => settled.push(v) });
    q.close(null);
    expect(settled).toEqual([null]);
    expect(q.state.current?.id).toBe("b");
  });

  it("is idempotent when closed with nothing open", () => {
    const q = createQueue<string | null>();
    expect(() => q.close(null)).not.toThrow();
    expect(q.state.current).toBeNull();
    expect(q.state.queue).toEqual([]);
  });

  it("keeps queue order across an unmount-and-reopen cycle", () => {
    const settled: string[] = [];
    const q = createQueue<string | null>();
    q.enqueue({ id: "a", resolve: () => settled.push("a") });
    q.enqueue({ id: "b", resolve: () => settled.push("b") });
    // Host unmounts and remounts: the store outlives it, so `b` is still queued.
    expect(q.state.queue.map((r) => r.id)).toEqual(["b"]);
    q.close(null);
    expect(q.state.current?.id).toBe("b");
    q.close(null);
    expect(settled).toEqual(["a", "b"]);
  });
});

describe("dialog.tsx wiring", () => {
  const text = readFileSync(join(process.cwd(), "src/ui/dialog.tsx"), "utf8");

  it("routes appPrompt through a queue, like appConfirm", () => {
    expect(text).toContain("function enqueuePrompt(");
    expect(text).toMatch(/usePromptStore = create<\{ current: PromptRequest \| null; queue: PromptRequest\[\] \}>/);
    // The single-slot overwrite must be gone.
    expect(text).not.toMatch(/usePromptStore\.setState\(\{\s*current: \{/);
  });

  it("advances the prompt queue on close", () => {
    expect(text).toMatch(/usePromptStore\.setState\(\{ current: queue\[0\] \?\? null, queue: queue\.slice\(1\) \}\)/);
  });
});
