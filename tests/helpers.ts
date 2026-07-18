import type { TxLike } from "../src/domain/types";

let txCounter = 0;

/** Build a TxLike with sensible defaults; amounts in minor units (kuruş). */
export function tx(overrides: Partial<TxLike> & Pick<TxLike, "type" | "amountTryMinor" | "effectiveDate">): TxLike {
  return {
    id: `tx-${++txCounter}`,
    purchaseDate: null,
    status: "realized",
    categoryId: null,
    categoryKind: null,
    paymentSourceId: null,
    personIsSelf: true,
    installmentPlanId: null,
    cardStatementId: null,
    subscriptionId: null,
    isAggregate: false,
    ...overrides,
  };
}

/** "18.822,92" → 1882292 (test readability for Excel golden values). */
export function tl(s: string): number {
  const [intPart, frac = "00"] = s.replace(/\./g, "").split(",");
  if (intPart == null) throw new Error(`Invalid test amount: ${s}`);
  const sign = intPart.startsWith("-") ? -1 : 1;
  return sign * (Math.abs(Number(intPart)) * 100 + Number((frac + "00").slice(0, 2)));
}

export function required<T>(value: T | undefined, context = "required test value"): T {
  if (value === undefined) throw new Error(`Missing ${context}`);
  return value;
}
