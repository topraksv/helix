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
 * These tests drive the REAL reducer from `src/ui/request-queue.ts`. They used
 * to drive a copy of it declared in this file, which meant the assertions could
 * stay green while `dialog.tsx` did something else entirely — the copy is why
 * the reducer now lives in its own module.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  advanceRequestQueue,
  emptyRequestQueue,
  enqueueRequest,
  type RequestQueue,
} from "../src/ui/request-queue";

interface Request<T> {
  id: string;
  resolve: (value: T) => void;
}

/** The enqueue/close pair both hosts implement, over the shared reducer. */
function createQueue<T>() {
  let state: RequestQueue<Request<T>> = emptyRequestQueue<Request<T>>();
  return {
    get state() {
      return state;
    },
    enqueue(request: Request<T>) {
      state = enqueueRequest(state, request);
    },
    close(value: T) {
      const settled = state.current;
      state = advanceRequestQueue(state);
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

  it("lets a resolve handler open the next request without losing it", () => {
    // `close` advances BEFORE resolving, so a follow-up prompt opened from the
    // resolve handler enqueues against the advanced state. Advancing after the
    // resolve would overwrite the follow-up with the promoted request.
    const settled: string[] = [];
    const q = createQueue<string | null>();
    q.enqueue({
      id: "a",
      resolve: () => {
        settled.push("a");
        q.enqueue({ id: "follow-up", resolve: () => settled.push("follow-up") });
      },
    });
    q.close(null);
    expect(q.state.current?.id).toBe("follow-up");
    q.close(null);
    expect(settled).toEqual(["a", "follow-up"]);
  });
});

describe("request-queue reducer", () => {
  it("starts empty", () => {
    expect(emptyRequestQueue<string>()).toEqual({ current: null, queue: [] });
  });

  it("does not mutate the state it is given", () => {
    const before: RequestQueue<string> = { current: "a", queue: ["b"] };
    const after = enqueueRequest(before, "c");
    expect(before).toEqual({ current: "a", queue: ["b"] });
    expect(after).toEqual({ current: "a", queue: ["b", "c"] });
    expect(advanceRequestQueue(before)).toEqual({ current: "b", queue: [] });
    expect(before).toEqual({ current: "a", queue: ["b"] });
  });

  it("keeps a queued request behind the open one, never replacing it", () => {
    const state = enqueueRequest(enqueueRequest(emptyRequestQueue<string>(), "a"), "b");
    expect(state.current).toBe("a");
    expect(state.queue).toEqual(["b"]);
  });

  it("empties rather than throwing when advanced past the last request", () => {
    expect(advanceRequestQueue<string>({ current: "a", queue: [] })).toEqual({ current: null, queue: [] });
    expect(advanceRequestQueue<string>({ current: null, queue: [] })).toEqual({ current: null, queue: [] });
  });
});

describe("dialog.tsx wiring", () => {
  const text = readFileSync(join(process.cwd(), "src/ui/dialog.tsx"), "utf8");

  it("routes BOTH stores through the shared reducer", () => {
    expect(text).toContain('from "./request-queue"');
    // Two hosts, one enqueue helper each, both delegating.
    expect(text.match(/enqueueRequest\(/g)).toHaveLength(2);
    expect(text.match(/advanceRequestQueue\(/g)).toHaveLength(2);
    expect(text.match(/create<RequestQueue<\w+>>/g)).toHaveLength(2);
  });

  it("keeps no hand-rolled queue arithmetic behind", () => {
    // The single-slot overwrite and the two open-coded advances must be gone.
    expect(text).not.toMatch(/usePromptStore\.setState\(\{\s*current: \{/);
    expect(text).not.toMatch(/queue\[0\] \?\? null/);
    expect(text).not.toMatch(/queue\.slice\(1\)/);
  });
});
