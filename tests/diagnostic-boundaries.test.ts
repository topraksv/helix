import { describe, expect, it } from "vitest";
import { classifyDiagnostic, createDiagnosticEvent } from "../src/domain/diagnostics";

describe("diagnostic classification boundaries", () => {
  it("pins cancellation, non-Error input, fallback, and classification priority", () => {
    expect(classifyDiagnostic(Object.assign(new Error("operation stopped"), { name: "AbortError" }))).toBe("cancelled");
    expect(classifyDiagnostic("socket closed")).toBe("network");
    expect(classifyDiagnostic("invalid payload")).toBe("validation");
    expect(classifyDiagnostic("auth timeout")).toBe("auth");
    expect(classifyDiagnostic(null)).toBe("unknown");
  });

  it("normalizes safe internal scopes and enforces the exact length ceiling", () => {
    const at = new Date("2026-08-12T12:00:00.000Z");
    expect(createDiagnosticEvent(" Sync.Push_1 ", "warning", "offline", at)).toEqual({
      at: "2026-08-12T12:00:00.000Z",
      scope: "sync.push_1",
      severity: "warning",
      code: "network",
    });
    expect(createDiagnosticEvent("a".repeat(40), "error", "unknown", at).scope).toBe("a".repeat(40));
    expect(createDiagnosticEvent("a".repeat(41), "error", "unknown", at).scope).toBe("app");
  });
});
