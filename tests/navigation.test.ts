import { describe, expect, it, vi } from "vitest";
import { navigateBack } from "../src/ui/navigation";

describe("safe back navigation", () => {
  it("uses stack history when a previous screen exists", () => {
    const router = { canGoBack: () => true, back: vi.fn(), replace: vi.fn() };
    navigateBack(router, "/fallback");
    expect(router.back).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("returns to the screen parent for a direct link", () => {
    const router = { canGoBack: () => false, back: vi.fn(), replace: vi.fn() };
    navigateBack(router, "/fallback");
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/fallback");
  });
});
