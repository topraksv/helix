/**
 * What a save actually did, in one line the owner can check against.
 *
 * The same amount can land in this month or the next (a card's statement
 * cycle) and can move today's balance or only the forecast; "Kaydedildi" says
 * neither. Pure, so the sentence can be asserted without a renderer.
 */

import { monthKeyOf, type ISODate } from "./dates";
import type { Minor } from "./money";
import { signedBalanceEffectOf } from "./transactions";
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
 * unless the row is realized, self-owned and not in the future (the conditions
 * of `countsTowardBalance`, restated to keep this a description of one row).
 * `projectedMinor` is the effect on the forecast, which a pending or future
 * row does reach.
 */
interface SaveEffect {
  balanceMinor: Minor;
  projectedMinor: Minor;
  /** True when the row changes the forecast but not today's balance. */
  forecastOnly: boolean;
}

export function saveEffect(saved: SavedTransaction, today: ISODate): SaveEffect {
  // A transfer leaves the ledger like an expense: that money is no longer available.
  const signed = signedBalanceEffectOf(saved.type, saved.amountTryMinor, null);
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
 * A card expense is filed under its statement's due month, which may not be
 * the month the owner was looking at.
 */
export function landsInAnotherMonth(effectiveDate: ISODate, enteredFor: ISODate): boolean {
  return monthKeyOf(effectiveDate) !== monthKeyOf(enteredFor);
}

type SaveSummaryKind = "created" | "updated" | "deleted";

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
        ? monthKeyOf(input.saved.effectiveDate)
        : null,
    undoable: input.undoable ?? true,
  };
}
