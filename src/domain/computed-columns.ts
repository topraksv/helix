/**
 * Bounded computed-column engine (spec §3.2 explicitly forbids a free-form
 * formula engine). Definitions are Zod-validated JSON restricted to a
 * whitelisted op set; evaluation only reads pre-aggregated month data.
 */

import { z } from "zod";
import type { Minor } from "./money";
import type { MonthKey } from "./dates";

const computedColumnDefinitionSchema = z.discriminatedUnion("op", [
  /** Sum of selected categories' realized totals. */
  z.object({ op: z.literal("sum"), categoryIds: z.array(z.string().min(1)).min(1) }),
  /** Σ(plus categories) − Σ(minus categories). */
  z.object({
    op: z.literal("difference"),
    plusCategoryIds: z.array(z.string().min(1)).min(1),
    minusCategoryIds: z.array(z.string().min(1)).min(1),
  }),
  /** Month's total income minus total expense. */
  z.object({ op: z.literal("income_minus_expense") }),
  /** Credit-card split: single-shot or installment share. */
  z.object({ op: z.literal("cc_split"), part: z.enum(["single", "installment"]) }),
]);

export type ComputedColumnDefinition = z.infer<typeof computedColumnDefinitionSchema>;

export function parseDefinition(raw: unknown): ComputedColumnDefinition {
  return computedColumnDefinitionSchema.parse(raw);
}

/** Pre-aggregated month slice the evaluator is allowed to see. */
export interface MonthAggregates {
  month: MonthKey;
  byCategory: Map<string, Minor>;
  incomeMinor: Minor;
  expenseMinor: Minor;
  ccSingleMinor: Minor;
  ccInstallmentMinor: Minor;
}

export function evaluateComputedColumn(def: ComputedColumnDefinition, data: MonthAggregates): Minor {
  switch (def.op) {
    case "sum":
      return def.categoryIds.reduce((sum, id) => sum + (data.byCategory.get(id) ?? 0), 0);
    case "difference": {
      const plus = def.plusCategoryIds.reduce((sum, id) => sum + (data.byCategory.get(id) ?? 0), 0);
      const minus = def.minusCategoryIds.reduce((sum, id) => sum + (data.byCategory.get(id) ?? 0), 0);
      return plus - minus;
    }
    case "income_minus_expense":
      return data.incomeMinor - data.expenseMinor;
    case "cc_split":
      return def.part === "single" ? data.ccSingleMinor : data.ccInstallmentMinor;
  }
}
