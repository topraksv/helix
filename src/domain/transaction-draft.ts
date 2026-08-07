/**
 * Whether a transaction form holds a saveable entry, and what it would write.
 *
 * This is the guard between a half-filled form and the ledger, and it lived
 * inside a 500-line component as a boolean beside a handful of nullable
 * values — so the write path re-asserted each one with `!` and nothing could
 * test the rule without a renderer. Pure on purpose: the fields, the FX rate
 * and the React state stay in `app/transaction.tsx`, and this is what a test
 * can hold.
 *
 * It returns the whole write or nothing at all. A partial answer is what let
 * the guard and the write disagree.
 */

import { convertToTryMinor } from "./fx";
import { isSupportedMinorAmount, type Minor } from "./money";
import type { TransactionType } from "./types";

export interface TransactionDraft {
  /** Every live query the form reads has answered at least once. */
  dataReady: boolean;
  type: TransactionType;
  /** Magnitude as typed; the sign comes from `isReversal`. */
  amountMinor: Minor | null;
  /** A refund or reversal keeps its type and category with a negative amount. */
  isReversal: boolean;
  currency: string;
  /** TRY per unit of `currency`; 1 for TRY, `null` while a rate is missing. */
  rateTry: number | null;
  categoryId: string | null;
  /**
   * The person ROW, not an id. A person deleted on another device arrives by
   * sync while this form is open, and an id that no longer resolves is not a
   * person — the installment plan needs `isSelf` from the live row.
   */
  person: { id: string; isSelf: boolean } | null;
  dateValid: boolean;
  installmentValid: boolean;
  cardCycleValid: boolean;
  installment: boolean;
}

export interface TransactionSave {
  amountMinor: Minor;
  /** What the ledger stores: negative for a reversal. */
  signedAmountMinor: Minor;
  tryMinor: Minor;
  rateTry: number;
  person: { id: string; isSelf: boolean };
  categoryId: string;
}

/**
 * The TRY figure the form shows while it is still being filled.
 *
 * The same conversion and the same sign the save would write, so the number
 * the user reads under a foreign amount cannot differ from the one that lands
 * in the ledger. `null` means the rate is missing — never a TRY figure taken
 * on faith.
 */
export function previewTryMinor(
  amountMinor: Minor | null,
  isReversal: boolean,
  rateTry: number | null,
): Minor | null {
  if (amountMinor == null || rateTry == null) return null;
  return (isReversal ? -1 : 1) * convertToTryMinor(amountMinor, rateTry);
}

export function resolveTransactionSave(draft: TransactionDraft): TransactionSave | null {
  const { amountMinor, rateTry, person, categoryId } = draft;
  if (!draft.dataReady) return null;
  if (amountMinor == null || amountMinor <= 0) return null;
  // Missing rates stay missing: a foreign amount is never read as TRY.
  if (rateTry == null) return null;
  if (person == null || categoryId == null) return null;
  if (!draft.dateValid || !draft.installmentValid || !draft.cardCycleValid) return null;
  // An installment plan is a schedule of charges. A reversal is a single
  // refund of one, so the two cannot describe the same row.
  if (draft.installment && draft.isReversal) return null;

  const tryMinor = previewTryMinor(amountMinor, draft.isReversal, rateTry);
  if (tryMinor == null) return null;
  // The ceiling applies to the TRY figure, because that is what the ledger
  // chains — a large foreign amount can cross it while its own figure does not.
  if (!isSupportedMinorAmount(tryMinor, false)) return null;

  return {
    amountMinor,
    signedAmountMinor: draft.isReversal ? -amountMinor : amountMinor,
    tryMinor,
    rateTry,
    person,
    categoryId,
  };
}
