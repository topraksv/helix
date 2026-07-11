/**
 * Row id generation.
 * - Fresh user actions get time-ordered UUIDv7 (good index locality).
 * - Rows with a natural key (settings, fx_rates, expected payments,
 *   plan-generated transactions) get a DETERMINISTIC id derived from that
 *   key, so two devices generating the same logical row converge on the
 *   same primary key instead of creating sync duplicates.
 */

import { uuidv7 } from "uuidv7";
import * as Crypto from "expo-crypto";

export function newId(): string {
  return uuidv7();
}

/** SHA-256 of the natural key folded into a UUID shape (version nibble 8 to avoid colliding with v7 space). */
export async function deterministicId(naturalKey: string): Promise<string> {
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, naturalKey);
  const h = hex.slice(0, 32).split("");
  h[12] = "8"; // fake version nibble, distinct namespace from uuidv7
  h[16] = "8"; // variant bits
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

export const naturalKeys = {
  setting: (userId: string, key: string) => `setting:${userId}:${key}`,
  /** Exactly one "self" person per account; every device converges on this id. */
  selfPerson: (userId: string) => `person-self:${userId}`,
  fxRate: (userId: string, currency: string, rateDate: string) => `fx:${userId}:${currency}:${rateDate}`,
  expected: (userId: string, kind: string, refId: string, dueDate: string) =>
    `expected:${userId}:${kind}:${refId}:${dueDate}`,
  installmentTx: (planId: string, installmentNo: number) => `insttx:${planId}:${installmentNo}`,
  /** The transaction created by confirming an expected item. Deterministic so
   *  a double-tap or two devices confirming concurrently converge on ONE
   *  transaction instead of duplicating the payment. */
  confirmTx: (expectedId: string) => `confirmtx:${expectedId}`,
  /** One note per (month, category) cell — deterministic so re-import overwrites. */
  cellNote: (userId: string, month: string, categoryId: string) => `cellnote:${userId}:${month}:${categoryId}`,
  /** The credit-card installment column, migrated from a hard-coded column to
   *  an ordinary computed column exactly once per account. */
  ccColumn: (userId: string) => `computed-cc-installment:${userId}`,
};
