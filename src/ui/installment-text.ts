import { formatMinorCompact, installmentShareRange } from "../domain/money";
import { tr } from "../i18n/tr";

/** A label with its currency appended when the amount is not lira. */
export function withCurrency(label: string, currency: string): string {
  return currency === "TRY" ? label : `${label} · ${currency}`;
}

/** How a purchase splits, said the way the schedule writes it: one figure when every month bills the same, else the first and the rest. */
export function installmentSplitText(totalMinor: number, count: number, currency: string): string | null {
  const shares = installmentShareRange(totalMinor, count);
  if (!shares) return null;
  return shares.first === shares.rest
    ? tr.tx.installmentInfo(formatMinorCompact(shares.first, currency), count)
    : tr.tx.installmentInfoUneven(count, formatMinorCompact(shares.first, currency), formatMinorCompact(shares.rest, currency));
}
