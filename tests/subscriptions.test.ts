import { describe, expect, it } from "vitest";
import { findSubscriptionCategory } from "../src/domain/subscriptions";

describe("subscription category reuse", () => {
  it("reuses the same live expense category with Turkish-aware normalization", () => {
    const categories = [
      { id: "existing", name: "  ABONELİKLER ", kind: "expense" as const, deletedAt: null },
      { id: "income", name: "Abonelikler", kind: "income" as const, deletedAt: null },
    ];
    expect(findSubscriptionCategory(categories, "Abonelikler")?.id).toBe("existing");
    expect(findSubscriptionCategory(categories, "abonelikler")?.id).toBe("existing");
  });

  it("does not revive a deleted category through the read path", () => {
    expect(
      findSubscriptionCategory(
        [{ id: "deleted", name: "Abonelikler", kind: "expense", deletedAt: "2026-07-15T10:00:00Z" }],
        "Abonelikler",
      ),
    ).toBeNull();
  });
});
