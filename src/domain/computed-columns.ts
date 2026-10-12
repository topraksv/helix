/**
 * Bounded computed-column engine (spec §1.6 explicitly forbids a free-form
 * formula engine). Definitions are validated JSON restricted to a whitelisted
 * op set; evaluation only reads pre-aggregated month data.
 *
 * The validator is hand-written because a Zod schema here put 11% of the web
 * entry chunk behind four object shapes; every other boundary guard in the
 * tree is hand-written for the same reason.
 *
 * The order matters: a discriminated union on `op`, then strict keys, then each
 * field, then the cross-field uniqueness rule. Anything looser is a formula
 * engine with extra steps, which §1.6 forbids by name.
 */

import { monthColumnBasis, type MonthLedger } from "./balance";
import type { Minor } from "./money";

export const MAX_COMPUTED_CATEGORY_IDS = 500;

export type ComputedColumnDefinition =
  | { op: "sum"; categoryIds: string[] }
  | { op: "difference"; plusCategoryIds: string[]; minusCategoryIds: string[] }
  | { op: "income_minus_expense" }
  | { op: "cc_split"; part: "single" | "installment" };

/** One reason a definition was refused: a rule and where it applies. */
interface DefinitionIssue {
  code: string;
  message: string;
  path: string[];
}

/**
 * The refusal. Not exported: every caller catches generically and shows
 * `tr.errors.saveFailed`. `issues` exists to make a refusal debuggable, and a
 * path names a FIELD, never a value.
 */
class ComputedColumnError extends Error {
  readonly issues: DefinitionIssue[];
  constructor(issues: DefinitionIssue[]) {
    super(issues[0]?.message ?? "Invalid computed column definition");
    this.name = "ComputedColumnError";
    this.issues = issues;
  }
}

const fail = (code: string, message: string, path: string[] = []): never => {
  throw new ComputedColumnError([{ code, message, path }]);
};

/** A plain object. An array is `typeof "object"` and is not one. */
function asRecord(raw: unknown, path: string[]): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail("invalid_type", "Expected an object", path);
  }
  return raw as Record<string, unknown>;
}

/** Refuse any key the branch did not declare, so an unknown op's payload cannot ride along inside a known one. */
function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail("unrecognized_keys", `Unrecognized key: ${key}`, [key]);
  }
}

/** A non-empty list of non-empty strings, bounded at both ends. */
function categoryIdList(raw: unknown, field: string): string[] {
  if (!Array.isArray(raw)) fail("invalid_type", "Expected an array", [field]);
  const list = raw as unknown[];
  if (list.length < 1) fail("too_small", "At least one category is required", [field]);
  if (list.length > MAX_COMPUTED_CATEGORY_IDS) {
    fail("too_big", `At most ${MAX_COMPUTED_CATEGORY_IDS} categories are allowed`, [field]);
  }
  return list.map((entry, index) => {
    if (typeof entry !== "string") fail("invalid_type", "Expected a string", [field, String(index)]);
    if ((entry as string).length < 1) fail("too_small", "Expected a non-empty string", [field, String(index)]);
    return entry as string;
  });
}

/** Checked after the shape: a duplicate only means something once both sides are lists of ids. */
function requireUniqueIds(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) {
    fail("custom", "Computed categories must be unique");
  }
}

export function parseDefinition(raw: unknown): ComputedColumnDefinition {
  const value = asRecord(raw, []);
  switch (value.op) {
    case "sum": {
      rejectUnknownKeys(value, ["op", "categoryIds"]);
      const categoryIds = categoryIdList(value.categoryIds, "categoryIds");
      requireUniqueIds(categoryIds);
      return { op: "sum", categoryIds };
    }
    case "difference": {
      rejectUnknownKeys(value, ["op", "plusCategoryIds", "minusCategoryIds"]);
      const plusCategoryIds = categoryIdList(value.plusCategoryIds, "plusCategoryIds");
      const minusCategoryIds = categoryIdList(value.minusCategoryIds, "minusCategoryIds");
      requireUniqueIds([...plusCategoryIds, ...minusCategoryIds]);
      return { op: "difference", plusCategoryIds, minusCategoryIds };
    }
    case "income_minus_expense": {
      rejectUnknownKeys(value, ["op"]);
      return { op: "income_minus_expense" };
    }
    case "cc_split": {
      rejectUnknownKeys(value, ["op", "part"]);
      if (value.part !== "single" && value.part !== "installment") {
        fail("invalid_value", "Expected 'single' or 'installment'", ["part"]);
      }
      return { op: "cc_split", part: value.part as "single" | "installment" };
    }
    default:
      return fail("invalid_union_discriminator", "Unknown computed column op", ["op"]);
  }
}

/** Pre-aggregated month slice the evaluator is allowed to see. */
export interface MonthAggregates {
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

/** A month's computed value: its ledger figures plus the credit-card split, if any. */
export function evaluateMonthColumn(
  def: ComputedColumnDefinition,
  month: MonthLedger,
  card: { singleMinor: Minor; installmentMinor: Minor } | undefined,
): Minor {
  return evaluateComputedColumn(def, {
    ...monthColumnBasis(month),
    ccSingleMinor: card?.singleMinor ?? 0,
    ccInstallmentMinor: card?.installmentMinor ?? 0,
  });
}
