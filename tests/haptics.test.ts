import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: { OS: "ios" },
  impactAsync: vi.fn(() => Promise.resolve()),
  selectionAsync: vi.fn(() => Promise.resolve()),
  notificationAsync: vi.fn(() => Promise.resolve()),
}));

vi.mock("react-native", () => ({ Platform: mocks.platform }));
vi.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
  impactAsync: mocks.impactAsync,
  selectionAsync: mocks.selectionAsync,
  notificationAsync: mocks.notificationAsync,
}));

import { calculatorKeyHaptic } from "../src/ui/calculator-feedback";
import { haptic, selectionTapIfChanged } from "../src/ui/haptics";

describe("haptic feedback", () => {
  beforeEach(() => {
    mocks.platform.OS = "ios";
    mocks.impactAsync.mockReset().mockResolvedValue(undefined);
    mocks.selectionAsync.mockReset().mockResolvedValue(undefined);
    mocks.notificationAsync.mockReset().mockResolvedValue(undefined);
  });

  it("is a safe no-op outside iOS", () => {
    mocks.platform.OS = "android";
    haptic("light");
    haptic("selection");
    haptic("success");
    expect(mocks.impactAsync).not.toHaveBeenCalled();
    expect(mocks.selectionAsync).not.toHaveBeenCalled();
    expect(mocks.notificationAsync).not.toHaveBeenCalled();
  });

  it("does not repeat selection feedback for the active choice", async () => {
    selectionTapIfChanged("cash-flow", "cash-flow");
    selectionTapIfChanged("dashboard", "cash-flow");
    await Promise.resolve();
    expect(mocks.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it("maps one requested outcome to one native notification", async () => {
    haptic("warning");
    await Promise.resolve();
    expect(mocks.notificationAsync).toHaveBeenCalledTimes(1);
    expect(mocks.notificationAsync).toHaveBeenCalledWith("warning");
  });

  it("does not let unavailable native feedback break the interaction", async () => {
    mocks.impactAsync.mockImplementationOnce(() => {
      throw new Error("unavailable");
    });
    expect(() => haptic("light")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.impactAsync).toHaveBeenCalledTimes(1);
  });

  it("consumes an asynchronous native rejection", async () => {
    mocks.impactAsync.mockRejectedValueOnce(new Error("disabled"));
    haptic("light");
    await Promise.resolve();
    expect(mocks.impactAsync).toHaveBeenCalledTimes(1);
  });
});

describe("calculator feedback", () => {
  it("keeps digit entry quiet and distinguishes selection, success, and error", () => {
    expect(calculatorKeyHaptic({ current: "7", accumulator: null, op: null }, "7")).toBe("none");
    expect(calculatorKeyHaptic({ current: "7", accumulator: null, op: null }, "+")).toBe("selection");
    expect(calculatorKeyHaptic({ current: "3", accumulator: 7, op: "+" }, "=")).toBe("success");
    expect(calculatorKeyHaptic({ current: "0", accumulator: 7, op: "÷" }, "=")).toBe("error");
  });
});
