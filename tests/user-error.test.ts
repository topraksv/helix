/**
 * The engine/user message boundary.
 *
 * Screens used to render `e.message` verbatim, so a repository error written in
 * English ("Invalid opening balance month") or a platform failure reached a
 * Turkish user at the exact moment a financial write failed. The rule is not
 * "hide every message": authored `tr.*` text has to survive, or the import and
 * backup diagnostics collapse into one useless sentence.
 */

import { describe, expect, it } from "vitest";
import { UserFacingError, userMessage } from "../src/domain/user-error";
import { tr } from "../src/i18n/tr";

describe("userMessage", () => {
  it("passes an authored user-facing message through", () => {
    expect(userMessage(new UserFacingError(tr.errors.backupTooLarge), tr.errors.saveFailed))
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
