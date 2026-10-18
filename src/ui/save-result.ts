/**
 * The card a save leaves behind: what was written and what it did to the
 * figure the owner watches, readable in a glance, with Geri Al beside it.
 * One sentence per line so it is read in the two or three seconds it is
 * looked at; the bar itself stays up long enough to reach the button.
 */
import { formatMinorCompact, type Minor } from "../domain/money";
import { tr } from "../i18n/tr";
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

/** "Güncel bakiye ₺42.300 → ₺41.800", or null when the save did not move it or it is not known. */
export function balanceLine(beforeMinor: Minor | null, deltaMinor: Minor, line: (before: string, after: string) => string): string | null {
  if (beforeMinor == null || deltaMinor === 0) return null;
  return line(formatMinorCompact(beforeMinor), formatMinorCompact(beforeMinor + deltaMinor));
}
