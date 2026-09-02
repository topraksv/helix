import { describe, expect, it } from "vitest";
import {
  classifyDiagnostic,
  createDiagnosticEvent,
  errorName,
  fingerprintMessage,
  redactStack,
} from "../src/domain/diagnostics";

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
      // A `devWarning` passes a string, so there is no constructor and no
      // stack; the text itself is developer-written and survives as tokens.
      name: null,
      fingerprint: "offline",
      frames: null,
    });
    expect(createDiagnosticEvent("a".repeat(40), "error", "unknown", at).scope).toBe("a".repeat(40));
    expect(createDiagnosticEvent("a".repeat(41), "error", "unknown", at).scope).toBe("app");
  });
});

/**
 * The edges of what migration 33 lets through.
 *
 * These call the redactors directly, so each refusal is pinned at the place
 * that decides it rather than inferred from a row further down the path.
 */
describe("diagnostic redaction boundaries", () => {
  it("returns nothing for input that has no message to fingerprint", () => {
    expect(fingerprintMessage(null)).toBeNull();
    expect(fingerprintMessage(new Error(""))).toBeNull();
    expect(fingerprintMessage({ message: "not an Error" })).toBeNull();
    // Digits and single letters are not tokens, so this has nothing to keep.
    expect(fingerprintMessage("1 2 3 a b")).toBeNull();
  });

  it("keeps only the first eight tokens", () => {
    expect(fingerprintMessage("one two three four five six seven eight nine ten"))
      .toBe("one two three four five six seven eight");
  });

  it("refuses a name that is not shaped like a constructor", () => {
    expect(errorName(Object.assign(new Error("x"), { name: "Not A Name!" }))).toBeNull();
    expect(errorName(Object.assign(new Error("x"), { name: "9Lives" }))).toBeNull();
    expect(errorName(Object.assign(new Error("x"), { name: "a".repeat(41) }))).toBeNull();
    expect(errorName("a string is not an Error")).toBeNull();
    expect(errorName(Object.assign(new Error("x"), { name: "PostgrestError" }))).toBe("PostgrestError");
  });

  it("returns nothing when there is no stack to redact", () => {
    expect(redactStack("a string")).toBeNull();
    const stackless = new Error("boom");
    delete (stackless as { stack?: string }).stack;
    expect(redactStack(stackless)).toBeNull();
  });

  it("returns nothing when a stack holds no frame it can read", () => {
    const noFrames = new Error("boom");
    // A Hermes stack that was truncated, and a header line. Neither is a frame.
    noFrames.stack = "Error: boom\n    at <unknown>\n  ...";
    expect(redactStack(noFrames)).toBeNull();
  });

  it("drops a frame whose file name survives redaction as nothing", () => {
    const odd = new Error("boom");
    // Everything before the position is a separator or a refused character, so
    // there is no file left to name the code — the frame is worth no row.
    odd.stack = "Error: boom\n    at fn (/:1:2)\n    at real (/x/ok.ts:3:4)";
    expect(redactStack(odd)).toBe("real@ok.ts:3:4");
  });

  it("reads a Windows path separator as a path separator", () => {
    const windows = new Error("boom");
    windows.stack = "Error: boom\n    at fn (C:\\Users\\someone\\app\\bundle.js:7:8)";
    expect(redactStack(windows)).toBe("fn@bundle.js:7:8");
  });
});

/**
 * The couplings that fail silently.
 *
 * A scope the pattern refuses is not an error — it is quietly rewritten to
 * "app", and the label is gone with no sign that it ever existed. A message
 * whose tokens the fingerprint drops is the same kind of loss. Both are asserted
 * at the exact strings the engine sends, because both are one edit away from
 * turning telemetry into noise that still looks like telemetry.
 */
describe("what the sync engine sends survives redaction", () => {
  const at = new Date("2026-09-02T12:00:00.000Z");

  it("keeps the quarantine scope instead of collapsing it to the fallback", () => {
    expect(createDiagnosticEvent("sync.quarantine", "warning", "x", at).scope).toBe("sync.quarantine");
  });

  it("keeps the refused table and reason, which is all the incident log carries", () => {
    // `sync_dead_letters` never leaves the device, so this string is the only
    // way "transactions rows are being refused as invalid" reaches anyone.
    const event = createDiagnosticEvent("sync.quarantine", "warning", "invalid_row transactions cell_notes", at);
    // Underscores are separators, so a table name arrives as its words.
    expect(event.fingerprint).toBe("invalid row transactions cell notes");
    expect(event.code).toBe("validation");
  });

  it("keeps the probe's own fallback message readable", () => {
    const event = createDiagnosticEvent("sync", "warning", "sync_cursors() is not applied; pulling every table", at);
    // Exactly the eight-token ceiling; the sentence happens to fit whole.
    expect(event.fingerprint).toBe("sync cursors is not applied pulling every table");
  });
});
