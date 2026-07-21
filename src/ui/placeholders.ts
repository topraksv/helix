/**
 * Rotating example placeholders: every form shows a different, realistic
 * example each time (and cycles while the field is empty), instead of one
 * frozen sample value.
 */

import { useEffect, useState } from "react";
import { tr } from "../i18n/tr";

export const placeholderPools = {
  subscription: tr.placeholders.subscription,
  installment: tr.placeholders.installment,
  category: tr.placeholders.category,
  person: tr.placeholders.person,
  income: tr.placeholders.income,
  source: tr.placeholders.source,
  note: tr.placeholders.note,
  amount: tr.placeholders.amount,
} as const;

const ROTATE_MS = 4000;

/**
 * A placeholder from the pool that starts at a random spot and keeps cycling.
 * Amount fields pass `prefix: false` so the example reads as a bare number
 * ("1.250") instead of "Ör. 1.250".
 */
export function useRotatingPlaceholder(pool: readonly string[], opts?: { prefix?: boolean }): string {
  const [start] = useState(() => Math.floor(Math.random() * pool.length));
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setOffset((o) => o + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, []);
  const sample = pool[(start + offset) % pool.length] ?? "";
  return opts?.prefix === false ? sample : tr.placeholders.example(sample);
}
