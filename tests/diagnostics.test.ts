import { describe, expect, it } from "vitest";
import { classifyDiagnostic, createDiagnosticEvent } from "../src/domain/diagnostics";

describe("diagnostic redaction categories", () => {
  it("classifies without exporting raw messages", () => {
    expect(classifyDiagnostic(new Error("Failed to fetch account@example.com"))).toBe("network");
    expect(classifyDiagnostic(new Error("SQLITE_CONSTRAINT: amount"))).toBe("database");
    expect(classifyDiagnostic(new Error("JWT expired"))).toBe("auth");
    expect(classifyDiagnostic(new Error("malformed workbook"))).toBe("validation");
  });

  it("persists no raw error, account, amount, note or payload field", () => {
    const event = createDiagnosticEvent(
      "Sync / User@example.com",
      "error",
      new Error("Failed to fetch account@example.com amount=125000 note=private"),
      new Date("2026-07-18T10:00:00.000Z"),
    );

    expect(event).toEqual({
      at: "2026-07-18T10:00:00.000Z",
      scope: "sync---user-example-com",
      severity: "error",
      code: "network",
    });
    expect(Object.keys(event).sort()).toEqual(["at", "code", "scope", "severity"]);
    expect(JSON.stringify(event)).not.toMatch(/125000|private|failed to fetch/i);
  });
});
