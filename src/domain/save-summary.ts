/**
 * What a save actually did, in one line the owner can check against.
 *
 * A ledger write is not self-evident: the same amount can land in this month
 * or the next (a card's statement cycle), can move today's balance or only the
 * forecast (pending vs realized), and can be invisible on the screen the owner
 * returns to. "Kaydedildi" says none of that, so the two questions it leaves —
 * *what* changed and *what it did to my money* — had to be answered by going
 * and looking.
 *
 * Pure, so the sentence can be asserted without a renderer, and so the same
 * rules apply wherever a write is confirmed.
 */

import type { ISODate } from "./dates";
import type { Minor } from "./money";
import type { TransactionOrigin, TransactionStatus, TransactionType } from "./types";

/** The written row, as far as a confirmation is concerned. */
export interface SavedTransaction {
  type: TransactionType;
  amountTryMinor: Minor;
  effectiveDate: ISODate;
  status: TransactionStatus;
  personIsSelf: boolean;
  origin?: TransactionOrigin | null;
}

/**
 * How a saved row lands on the two figures the dashboard shows.
 *
 * `balanceMinor` is the signed effect on the CONFIRMED balance and is zero
 * unless the row is realized, self-owned and not in the future — the same
 * three conditions `countsTowardBalance` applies, restated here rather than
 * imported so this stays a pure description of one row rather than a second
 * balance engine. `projectedMinor` is the effect on the forecast, which a
 * pending or future row does reach.
 */
export interface SaveEffect {
  balanceMinor: Minor;
  projectedMinor: Minor;
  /** True when the row changes the forecast but not today's balance. */
  forecastOnly: boolean;
}

function signedEffect(saved: SavedTransaction): Minor {
  // A transfer leaves the ledger the same way an expense does: it is money
  // that is no longer available, whatever it was moved into.
  return saved.type === "income" ? saved.amountTryMinor : -saved.amountTryMinor;
}

export function saveEffect(saved: SavedTransaction, today: ISODate): SaveEffect {
  const signed = signedEffect(saved);
  const counts = saved.status === "realized" && saved.effectiveDate <= today && saved.personIsSelf;
  const projected = saved.personIsSelf ? signed : 0;
  return {
    balanceMinor: counts ? signed : 0,
    projectedMinor: projected,
    forecastOnly: !counts && projected !== 0,
  };
}

/**
 * Which month the row will actually be found in.
 *
 * A card expense bought today is filed under its statement's due month, so
 * "saved" and "visible where I was looking" are different months and the owner
 * has no way to tell without being told.
 */
export function landsInAnotherMonth(effectiveDate: ISODate, enteredFor: ISODate): boolean {
  return effectiveDate.slice(0, 7) !== enteredFor.slice(0, 7);
}

export type SaveSummaryKind = "created" | "updated" | "deleted";

/**
 * The parts a confirmation is built from. The renderer supplies the words; this
 * decides which facts are worth saying at all — a summary that always names
 * every fact is one nobody finishes reading.
 */
export interface SaveSummary {
  kind: SaveSummaryKind;
  effect: SaveEffect;
  /** Say the month only when it is not the one the owner was working in. */
  otherMonth: string | null;
  /** Offer undo only for something that can be taken back. */
  undoable: boolean;
}

export function buildSaveSummary(input: {
  kind: SaveSummaryKind;
  saved: SavedTransaction;
  today: ISODate;
  /** The month the owner was entering for, when that is known. */
  enteredFor?: ISODate | null;
  undoable?: boolean;
}): SaveSummary {
  const effect = saveEffect(input.saved, input.today);
  const enteredFor = input.enteredFor ?? null;
  return {
    kind: input.kind,
    effect,
    otherMonth:
      enteredFor && landsInAnotherMonth(input.saved.effectiveDate, enteredFor)
        ? input.saved.effectiveDate.slice(0, 7)
        : null,
    undoable: input.undoable ?? true,
  };
}
