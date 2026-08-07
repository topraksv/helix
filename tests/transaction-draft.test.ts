/**
 * The guard between a half-filled transaction form and the ledger.
 *
 * It used to be a boolean inside a 500-line component, so none of these cases
 * could be stated without a renderer — and the two that matter most (a person
 * deleted on another device, a foreign amount that crosses the ceiling only
 * after conversion) are exactly the ones a screen test would be least likely
 * to reach.
 */

import { describe, expect, it } from "vitest";
import { previewTryMinor, resolveTransactionSave, type TransactionDraft } from "../src/domain/transaction-draft";
import { MAX_ABS_AMOUNT_MINOR } from "../src/domain/money";
import { required } from "./helpers";

const complete: TransactionDraft = {
  dataReady: true,
  type: "expense",
  amountMinor: 250_00,
  isReversal: false,
  currency: "TRY",
  rateTry: 1,
  categoryId: "category-1",
  person: { id: "person-1", isSelf: true },
  dateValid: true,
  installmentValid: true,
  cardCycleValid: true,
  installment: false,
};

const draft = (overrides: Partial<TransactionDraft> = {}): TransactionDraft => ({ ...complete, ...overrides });

describe("resolveTransactionSave", () => {
  it("returns the whole write, or nothing at all", () => {
    const save = required(resolveTransactionSave(complete));
    expect(save).toEqual({
      amountMinor: 250_00,
      signedAmountMinor: 250_00,
      tryMinor: 250_00,
      rateTry: 1,
      person: { id: "person-1", isSelf: true },
      categoryId: "category-1",
    });
  });

  it("refuses a person that is no longer live", () => {
    // Deleted on another device while this form was open. The id used to be
    // carried on its own and the row looked up again inside the save, where an
    // assertion threw instead of the form simply refusing.
    expect(resolveTransactionSave(draft({ person: null }))).toBeNull();
  });

  it("refuses to write before every query has answered", () => {
    // A form that saves from an unresolved account writes against categories
    // and people it has not seen yet.
    expect(resolveTransactionSave(draft({ dataReady: false }))).toBeNull();
  });

  it("keeps a missing rate missing instead of reading a foreign amount as TRY", () => {
    expect(resolveTransactionSave(draft({ currency: "USD", rateTry: null }))).toBeNull();
  });

  it("carries the sign of a reversal into both the entry and its TRY figure", () => {
    const save = required(resolveTransactionSave(draft({ isReversal: true, currency: "USD", rateTry: 40 })));
    // The magnitude the user typed stays positive; the ledger figures go negative.
    expect(save.amountMinor).toBe(250_00);
    expect(save.signedAmountMinor).toBe(-250_00);
    expect(save.tryMinor).toBe(-10_000_00);
  });

  it("applies the amount ceiling to the CONVERTED figure, not the typed one", () => {
    // The typed amount is far under the ceiling; the TRY figure it becomes is
    // not, and the TRY figure is what the balance chain carries.
    const underInOwnCurrency = Math.floor(MAX_ABS_AMOUNT_MINOR / 100) + 1;
    expect(resolveTransactionSave(draft({ amountMinor: underInOwnCurrency, currency: "USD", rateTry: 1 }))).not.toBeNull();
    expect(resolveTransactionSave(draft({ amountMinor: underInOwnCurrency, currency: "USD", rateTry: 200 }))).toBeNull();
  });

  it("refuses a zero or negative magnitude", () => {
    // A reversal is expressed by the flag, never by typing a minus.
    expect(resolveTransactionSave(draft({ amountMinor: 0 }))).toBeNull();
    expect(resolveTransactionSave(draft({ amountMinor: -1 }))).toBeNull();
    expect(resolveTransactionSave(draft({ amountMinor: null }))).toBeNull();
  });

  it("refuses an entry with no category", () => {
    expect(resolveTransactionSave(draft({ categoryId: null }))).toBeNull();
  });

  it("refuses an installment plan that is also a reversal", () => {
    // A plan is a schedule of charges; a reversal refunds one of them. One row
    // cannot be both.
    expect(resolveTransactionSave(draft({ installment: true, isReversal: true }))).toBeNull();
    expect(resolveTransactionSave(draft({ installment: true, isReversal: false }))).not.toBeNull();
  });

  it("refuses an invalid date, schedule or card cycle", () => {
    expect(resolveTransactionSave(draft({ dateValid: false }))).toBeNull();
    expect(resolveTransactionSave(draft({ installmentValid: false }))).toBeNull();
    expect(resolveTransactionSave(draft({ cardCycleValid: false }))).toBeNull();
  });
});

describe("previewTryMinor", () => {
  it("shows the figure the save would write, sign and all", () => {
    const save = required(resolveTransactionSave(draft({ currency: "USD", rateTry: 40, isReversal: true })));
    // The number under the amount field and the number in the ledger come from
    // one conversion, so they cannot disagree.
    expect(previewTryMinor(250_00, true, 40)).toBe(save.tryMinor);
  });

  it("shows nothing rather than a figure taken on faith", () => {
    expect(previewTryMinor(250_00, false, null)).toBeNull();
    expect(previewTryMinor(null, false, 40)).toBeNull();
  });

  it("previews an amount the save would still refuse", () => {
    // Over the ceiling: the user must be able to SEE what they typed converts
    // to before being told it is too large.
    const huge = MAX_ABS_AMOUNT_MINOR;
    expect(previewTryMinor(huge, false, 40)).toBeGreaterThan(MAX_ABS_AMOUNT_MINOR);
    expect(resolveTransactionSave(draft({ amountMinor: huge, currency: "USD", rateTry: 40 }))).toBeNull();
  });
});
