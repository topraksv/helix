/**
 * Bounded computed-column engine (spec §3.2 explicitly forbids a free-form
 * formula engine). Definitions are validated JSON restricted to a whitelisted
 * op set; evaluation only reads pre-aggregated month data.
 *
 * WHY THIS VALIDATOR IS HAND-WRITTEN. It was a Zod schema, and Zod was the only
 * thing in the tree importing Zod — reached from `db/schema.ts`, so it was in
 * the entry bundle for every screen. Measured against the source map it was
 * 388_415 bytes, 11.4% of the web entry chunk and larger than react-dom, to
 * check four object shapes. Everything else that guards a boundary here is
 * already hand-written for the same reason and to the same standard:
 * `sync/outbound-validation.ts`, `services/backup-validation.ts`,
 * `domain/attachments.ts`. This file was the outlier, not the pattern.
 *
 * The rules below are a LITERAL translation of the schema it replaces, and the
 * order matters: a discriminated union on `op`, then strict keys, then each
 * field, then the cross-field uniqueness rule. Anything looser is a formula
 * engine with extra steps, which §3.2 forbids by name.
 */

import type { Minor } from "./money";
import type { MonthKey } from "./dates";

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
 * The refusal.
 *
 * Neither this class nor `DefinitionIssue` is exported, and that is the honest
 * shape: every caller of `parseDefinition` catches generically and shows
 * `tr.errors.saveFailed`, so an exported type nothing can name would only
 * advertise an API this module does not actually offer. The sibling validators
 * here throw `UserFacingError` for the same reason — a refusal a user sees
 * needs Turkish copy, not a structured code.
 *
 * `issues` still exists, because it is what makes a refusal debuggable rather
 * than the four-word message `ARCHITECTURE.md` records as a data-loss outcome
 * dressed as validation, and `tests/mutation-survivor-contracts.test.ts` reads
 * its shape. A path names a FIELD, never a value, which is the line every
 * other diagnostic here draws.
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

/**
 * Refuse any key the branch did not declare.
 *
 * This is the `.strict()` the schema carried, and it is the rule that keeps an
 * unknown op's payload from riding along inside a known one.
 */
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

/**
 * The cross-field rule, and the reason it is checked after the shape rather
 * than inside it: a duplicate is only meaningful once both sides are known to
 * be lists of ids.
 */
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
