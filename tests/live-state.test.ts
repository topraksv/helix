import { describe, expect, it } from "vitest";
import {
  combineLiveQueryStatus,
  completeLiveQuery,
  failLiveQuery,
  initialLiveSnapshot,
  startLiveQuery,
} from "../src/data/live-state";

describe("live query state", () => {
  it("separates first loading, ready refresh and stale last-good data", () => {
    const initial = initialLiveSnapshot<number[]>([]);
    expect(initial.status).toBe("loading");

    const ready = completeLiveQuery([42], new Date("2026-07-18T10:00:00Z"));
    expect(startLiveQuery(ready)).toMatchObject({ data: [42], status: "refreshing", error: null });

    const stale = failLiveQuery(ready, 2, new Date("2026-07-18T10:01:00Z"));
    expect(stale).toMatchObject({ data: [42], status: "stale", error: { kind: "query_failed", attempt: 2 } });

    const recovered = completeLiveQuery([84], new Date("2026-07-18T10:02:00Z"));
    expect(recovered).toMatchObject({ data: [84], status: "ready", error: null });
  });

  it("reports an initial failure as error and preserves severity when combined", () => {
    const failed = failLiveQuery(initialLiveSnapshot<string[]>([]), 1, new Date());
    const ready = completeLiveQuery(["ok"], new Date());
    expect(failed.status).toBe("error");
    expect(combineLiveQueryStatus([ready, failed])).toBe("error");
  });
});
