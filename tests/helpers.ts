import type { TxLike } from "../src/domain/types";

let txCounter = 0;

/** Build a TxLike with sensible defaults; amounts in minor units (kuruş). */
export function tx(overrides: Partial<TxLike> & Pick<TxLike, "type" | "amountTryMinor" | "effectiveDate">): TxLike {
  return {
    id: `tx-${++txCounter}`,
    status: "realized",
    categoryId: null,
    categoryKind: null,
    paymentSourceId: null,
    personIsSelf: true,
    installmentPlanId: null,
    subscriptionId: null,
    isAggregate: false,
    ...overrides,
  };
}

/** "18.822,92" → 1882292 (test readability for Excel golden values). */
export function tl(s: string): number {
  const [intPart, frac = "00"] = s.replace(/\./g, "").split(",");
  const sign = intPart.startsWith("-") ? -1 : 1;
  return sign * (Math.abs(Number(intPart)) * 100 + Number((frac + "00").slice(0, 2)));
}
