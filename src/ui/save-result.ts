/**
 * The card a save leaves behind: what was written and what it did to the
 * figure the owner watches, readable in a glance, with Geri Al beside it.
 * One sentence per line so it is read in the two or three seconds it is
 * looked at; the bar itself stays up long enough to reach the button.
 */
import { confirmExpected, FxRateUnavailableError, revertExpected } from "../data/repo";
import type { ISODate } from "../domain/dates";
import { formatMinorCompact, type Minor } from "../domain/money";
import { tr } from "../i18n/tr";
import { devError } from "../services/logger";
import { scheduleSync } from "../sync/engine";
import { appAlert } from "./dialog";
import { useUndo } from "./undo";

export function showSaveResult(input: {
  name: string;
  amountMinor: Minor;
  currency?: string;
  /** The second line, e.g. a balance before → after; null leaves the card one line. */
  detail?: string | null;
  undo?: (() => Promise<unknown>) | null;
  edit?: { label: string; run: () => void } | null;
}): void {
  const message = tr.saved.title(input.name, formatMinorCompact(Math.abs(input.amountMinor), input.currency));
  const bar = useUndo.getState();
  if (!input.detail && !input.edit) {
    bar.show(message, input.undo ?? null);
    return;
  }
  bar.showDetailed(message, { text: input.detail ?? "", action: input.edit ?? null }, input.undo ?? null);
}

/**
 * An expected payment marked paid, from Durum or Bekleyenler: written under
 * its rule's person and kalem, with Geri Al. Durum passes the day (today for
 * one not yet due); Bekleyenler passes a corrected amount. Resolves whether it
 * was written, so the caller can close what it opened.
 */
export async function confirmExpectedPayment(input: {
  userId: string;
  expected: { id: string; refId: string };
  name: string;
  selfPersonId: string;
  rule: { personId: string; categoryId: string | null } | undefined;
  paidOn?: ISODate;
  actualAmountMinor?: Minor;
}): Promise<boolean> {
  const { userId, expected } = input;
  try {
    await confirmExpected(userId, expected.id, {
      personId: input.rule?.personId ?? input.selfPersonId,
      categoryId: input.rule?.categoryId ?? null,
      paidOn: input.paidOn,
      actualAmountMinor: input.actualAmountMinor,
    });
    scheduleSync(userId);
    // Straight through, so a failed revert rejects and the bar keeps its retry instead of clearing as though it had worked.
    useUndo.getState().show(`${input.name} ✓`, () => revertExpected(userId, expected.id).then(() => scheduleSync(userId)));
    return true;
  } catch (error) {
    if (error instanceof FxRateUnavailableError) void appAlert(tr.errors.fxUnavailable, undefined, { tone: "error" });
    else {
      devError("expected.confirm", error);
      void appAlert(tr.errors.saveFailed, undefined, { tone: "error" });
    }
    return false;
  }
}

/** "Güncel bakiye ₺42.300 → ₺41.800", or null when the save did not move it or it is not known. */
export function balanceLine(beforeMinor: Minor | null, deltaMinor: Minor, line: (before: string, after: string) => string): string | null {
  if (beforeMinor == null || deltaMinor === 0) return null;
  return line(formatMinorCompact(beforeMinor), formatMinorCompact(beforeMinor + deltaMinor));
}
