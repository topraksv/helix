/** The engine/user message boundary: authored `tr.*` text survives, anything else becomes the generic message. */

import { describe, expect, it } from "vitest";
import { UserFacingError, userMessage } from "../../src/domain/user-error";
import { tr } from "../../src/i18n/tr";

describe("userMessage", () => {
  it("passes an authored user-facing message through", () => {
    const authored = new UserFacingError(tr.errors.backupTooLarge);
    expect(authored.name).toBe("UserFacingError");
    expect(userMessage(authored, tr.errors.saveFailed))
      .toBe(tr.errors.backupTooLarge);
    expect(userMessage(new UserFacingError(tr.importer.fileTooLarge), tr.errors.requestFailed))
      .toBe(tr.importer.fileTooLarge);
  });

  it("replaces an engine error with the caller's own message", () => {
    for (const raw of [
      new Error("Invalid opening balance month"),
      new Error("Onboarding requires exactly one self person"),
      new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: transactions.id"),
      new TypeError("Cannot read properties of undefined (reading 'id')"),
    ]) {
      expect(userMessage(raw, tr.errors.saveFailed)).toBe(tr.errors.saveFailed);
    }
  });

  it("replaces a non-Error rejection", () => {
    expect(userMessage("boom", tr.errors.requestFailed)).toBe(tr.errors.requestFailed);
    expect(userMessage(undefined, tr.errors.requestFailed)).toBe(tr.errors.requestFailed);
    expect(userMessage({ message: tr.errors.backupTooLarge }, tr.errors.requestFailed))
      .toBe(tr.errors.requestFailed);
  });

  it("accepts a marked error that lost its prototype across a module boundary", () => {
    // A dynamically imported validator (XLSX, backup parsing) can hand back an
    // Error whose prototype chain no longer matches this realm's class.
    const detached = new Error(tr.errors.invalidBackupFile);
    detached.name = "UserFacingError";
    expect(userMessage(detached, tr.errors.saveFailed)).toBe(tr.errors.invalidBackupFile);
  });

  it("never returns an empty message", () => {
    const blank = new Error("   ");
    blank.name = "UserFacingError";
    expect(userMessage(blank, tr.errors.saveFailed)).toBe(tr.errors.saveFailed);
  });
});
