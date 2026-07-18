import { describe, expect, it } from "vitest";
import { runSessionEpochTask, SessionEpoch } from "../src/sync/session-epoch";

describe("account-scoped background tasks", () => {
  it("drops user A's late response after user B becomes active", async () => {
    let release!: () => void;
    const response = new Promise<void>((resolve) => { release = resolve; });
    const writes: string[] = [];
    const epoch = new SessionEpoch();
    epoch.start("user-a");
    const task = runSessionEpochTask(epoch, "user-a", async () => {
      await response;
      return "response-a";
    });

    epoch.start("user-b");
    release();
    const result = await task;
    if (result) writes.push(result);

    expect(result).toBeUndefined();
    expect(writes).toEqual([]);
  });
});
