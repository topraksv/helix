import { getSqliteAsync } from "../../db/client";
import { deterministicId, naturalKeys } from "../../db/ids";
import { RELATIONS } from "../../db/relations";
import { assertLiveRow, assertRestorableRows, fromDbShape, nowIso, restoreRows, softDelete, writeRows, writeRowsValidated, type RowWrite } from "../../db/mutations";
import { isMonthKey, type MonthKey } from "../../domain/dates";
import { assertSupportedMinorAmount, type Minor } from "../../domain/money";

// Budgets have the same FK as the other category references, but are derived
// targets and are tombstoned with their category rather than reassigned.
type CategoryRelation = Extract<(typeof RELATIONS)[number], readonly [string, "category_id", "categories"]>;
type CategoryReferenceTable = Exclude<CategoryRelation[0], "category_budgets">;

const CATEGORY_REFERENCE_TABLES: CategoryReferenceTable[] = RELATIONS
  .filter(([, column, target]) => column === "category_id" && target === "categories")
  .map(([table]) => table)
  .filter((table): table is CategoryReferenceTable => table !== "category_budgets");

export interface CategoryReferenceUsage {
  transactions: number;
  subscriptions: number;
  recurringIncomes: number;
  installmentPlans: number;
  cellNotes: number;
  total: number;
}

interface CategoryReferenceSnapshot {
  table: CategoryReferenceTable;
  row: Record<string, unknown>;
}

export async function upsertCategoryBudget(
  userId: string,
  input: { month: MonthKey; categoryId: string; amountMinor: Minor },
): Promise<string> {
  if (!isMonthKey(input.month)) throw new Error("Invalid budget month");
  if (input.amountMinor <= 0) throw new Error("Budget amount must be positive");
  assertSupportedMinorAmount(input.amountMinor, false);
  const sqlite = await getSqliteAsync();
  const category = await sqlite.getFirstAsync<{ id: string }>(
    `SELECT id FROM categories
     WHERE id = ? AND user_id = ? AND kind = 'expense' AND deleted_at IS NULL`,
    [input.categoryId, userId],
  );
  if (!category) throw new Error("Budget category must be a live expense category");
  const id = await deterministicId(naturalKeys.categoryBudget(userId, input.month, input.categoryId));
  await writeRows(userId, [{
    table: "category_budgets",
    row: {
      id,
      categoryId: input.categoryId,
      month: input.month,
      amountMinor: input.amountMinor,
      deletedAt: null,
    },
  }]);
  return id;
}

export function deleteCategoryBudget(userId: string, id: string) {
  return softDelete(userId, "category_budgets", id);
}

export function restoreCategoryBudget(userId: string, snapshot: Record<string, unknown>): Promise<void> {
  const row: Record<string, unknown> = { ...fromDbShape("category_budgets", snapshot), deletedAt: null };
  return restoreRows(
    userId,
    [{ table: "category_budgets", row }],
    (sqlite) => assertLiveRow(sqlite, "categories", userId, String(row["categoryId"])),
  );
}

export interface CategoryDeleteSnapshot {
  category: Record<string, unknown>;
  budgets: Record<string, unknown>[];
  /**
   * Original rows are retained so undo restores every reassigned reference.
   *
   * Required, not optional: the only producer initialises both to `[]`, so
   * every `?.` and `?? []` this type used to force was code that could not
   * run. The type now says what is actually true.
   */
  reassigned: CategoryReferenceSnapshot[];
  /** Cell notes receive their natural target id when they move to a new column. */
  created: CategoryReferenceSnapshot[];
}

/** Count every live row that would otherwise keep a deleted column alive. */
export async function categoryReferenceUsage(userId: string, categoryId: string): Promise<CategoryReferenceUsage> {
  const sqlite = await getSqliteAsync();
  const counts = await Promise.all(CATEGORY_REFERENCE_TABLES.map(async (table) => {
    const row = await sqlite.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ? AND category_id = ? AND deleted_at IS NULL`,
      [userId, categoryId],
    );
    return row?.n ?? 0;
  }));
  const countByTable = new Map(CATEGORY_REFERENCE_TABLES.map((table, index) => [table, counts[index] ?? 0]));
  const transactions = countByTable.get("transactions") ?? 0;
  const subscriptions = countByTable.get("subscriptions") ?? 0;
  const recurringIncomes = countByTable.get("recurring_incomes") ?? 0;
  const installmentPlans = countByTable.get("installment_plans") ?? 0;
  const cellNotes = countByTable.get("cell_notes") ?? 0;
  return {
    transactions,
    subscriptions,
    recurringIncomes,
    installmentPlans,
    cellNotes,
    total: counts.reduce((sum, count) => sum + count, 0),
  };
}

/**
 * Deleting a category cascades to its monthly budget targets in the SAME
 * atomic write: a budget is a derived target for a live expense category, so a
 * tombstoned category must never leave nameless budget rows in lists or
 * totals. Returns the pre-delete snapshot; undo restores both together.
 */
export async function deleteCategoryWithBudgets(
  userId: string,
  categoryId: string,
  replacementId?: string | null,
): Promise<CategoryDeleteSnapshot | null> {
  const sqlite = await getSqliteAsync();
  const category = await sqlite.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [categoryId, userId],
  );
  if (!category) return null;
  const budgets = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM category_budgets WHERE user_id = ? AND category_id = ? AND deleted_at IS NULL`,
    [userId, categoryId],
  );
  const deletedAt = nowIso();
  const snapshot: CategoryDeleteSnapshot = {
    category: fromDbShape("categories", category),
    budgets: budgets.map((row) => fromDbShape("category_budgets", row)),
    reassigned: [],
    created: [],
  };

  // An omitted third argument is the legacy uncategorized delete path used by
  // older callers. The settings screen passes null explicitly when the user
  // chooses “Kategorisiz”; that distinction lets the old API remain safe while
  // the new reassignment path can atomically move every reference.
  const hasReassignmentChoice = replacementId !== undefined;
  let references: CategoryReferenceSnapshot[] = [];
  const writes: RowWrite[] = [
    { table: "categories", row: { ...snapshot.category, deletedAt } },
    ...snapshot.budgets.map((row) => ({ table: "category_budgets" as const, row: { ...row, deletedAt } })),
  ];

  if (hasReassignmentChoice) {
    if (replacementId === categoryId) throw new Error("Category cannot be reassigned to itself");
    const target = replacementId == null
      ? null
      : await sqlite.getFirstAsync<{ id: string; kind: string; is_transfer: number | boolean }>(
          `SELECT id, kind, is_transfer FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
          [replacementId, userId],
        );
    if (replacementId != null && !target) throw new Error("Replacement category does not exist");
    if (target && (target.kind !== category.kind || Boolean(target.is_transfer) !== Boolean(category.is_transfer))) {
      throw new Error("Replacement category does not match the deleted category");
    }

    const sourceRows = await Promise.all(CATEGORY_REFERENCE_TABLES.map(async (table) => ({
      table,
      rows: await sqlite.getAllAsync<Record<string, unknown>>(
        `SELECT * FROM ${table} WHERE user_id = ? AND category_id = ? AND deleted_at IS NULL`,
        [userId, categoryId],
      ),
    })));
    const referencesByTable = sourceRows.flatMap(({ table, rows }) => rows.map((row) => ({ table, row: fromDbShape(table, row) })));
    // A subscription or income rule with no column cannot be confirmed later
    // (`confirmExpected` requires a live category), so those are the only
    // references that genuinely need a replacement. Transactions, plans and
    // cell notes all have a safe answer without one.
    const blockingNullReferences = referencesByTable.some(({ table }) =>
      replacementId == null && (table === "subscriptions" || table === "recurring_incomes"));
    if (blockingNullReferences) {
      throw new Error("A replacement category is required for rules");
    }

    references = referencesByTable;
    if (replacementId != null) {
      const targetNotes = await sqlite.getAllAsync<Record<string, unknown>>(
        `SELECT * FROM cell_notes WHERE user_id = ? AND category_id = ? AND deleted_at IS NULL`,
        [userId, replacementId],
      );
      const targetNoteByMonth = new Map(targetNotes.map((row) => [String(row.month), fromDbShape("cell_notes", row)]));
      const referenceIds = new Set<string>();
      for (const reference of references) {
        const original = reference.row;
        referenceIds.add(`${reference.table}:${String(original.id)}`);
        if (reference.table !== "cell_notes") {
          writes.push({ table: reference.table, row: { ...original, categoryId: replacementId } });
          continue;
        }
        const targetNote = targetNoteByMonth.get(String(original.month));
        if (!targetNote) {
          // Cell notes are naturally keyed by (month, category). Keeping the
          // source id after a move would make the next edit create a duplicate
          // target note on Postgres, whose natural-key index is stricter than
          // the local SQLite schema.
          const targetId = await deterministicId(naturalKeys.cellNote(userId, String(original.month), replacementId));
          const movedNote = { ...original, id: targetId, categoryId: replacementId, deletedAt: null };
          writes.push({ table: "cell_notes", row: { ...original, deletedAt } });
          writes.push({ table: "cell_notes", row: movedNote });
          snapshot.created.push({ table: "cell_notes", row: movedNote });
          continue;
        }
        const mergedBody = `${String(targetNote.body)}\n\n${String(original.body)}`;
        if (mergedBody.length > 1000) throw new Error("Category notes are too long to merge");
        const targetKey = `cell_notes:${String(targetNote.id)}`;
        if (!referenceIds.has(targetKey)) {
          snapshot.reassigned.push({ table: "cell_notes", row: targetNote });
          referenceIds.add(targetKey);
        }
        writes.push({ table: "cell_notes", row: { ...targetNote, body: mergedBody } });
        writes.push({ table: "cell_notes", row: { ...original, deletedAt } });
      }
    } else {
      // `transactions.category_id` is `not null` at the Postgres boundary
      // (initial schema, reinforced by the category-kind trigger): nulling it
      // here would pass local SQLite and then dead-letter forever on sync.
      // Leaving the row untouched reproduces the pre-existing orphan behavior
      // that the cash-flow matrix already reconciles as "uncategorized".
      references = references.filter((reference) => reference.table !== "transactions");
      for (const reference of references) {
        // A cell note is keyed by (month, category) and its column is going
        // away, so there is no cell left for it to annotate and its own
        // `category_id` is not null either. It is tombstoned with the
        // category and comes back with it on undo.
        writes.push(reference.table === "cell_notes"
          ? { table: "cell_notes", row: { ...reference.row, deletedAt } }
          : { table: reference.table, row: { ...reference.row, categoryId: null } });
      }
    }
    snapshot.reassigned = [
      ...snapshot.reassigned,
      ...references.filter((reference) => !snapshot.reassigned.some((item) => item.table === reference.table && item.row.id === reference.row.id)),
    ];
  }

  await writeRowsValidated(
    userId,
    writes,
    async (db) => {
      await assertLiveRow(db, "categories", userId, categoryId);
      if (replacementId != null) await assertLiveRow(db, "categories", userId, replacementId);
      if (hasReassignmentChoice) {
        await Promise.all(snapshot.reassigned.map((reference) => assertLiveRow(db, reference.table, userId, String(reference.row.id))));
      }
    },
  );
  return snapshot;
}

/** Undo for `deleteCategoryWithBudgets`: one write restores the whole set. */
export async function restoreCategoryWithBudgets(userId: string, snapshot: CategoryDeleteSnapshot): Promise<void> {
  const categoryWrites: RowWrite[] = [
    { table: "categories", row: { ...snapshot.category, deletedAt: null } },
    ...snapshot.budgets.map((row) => ({ table: "category_budgets" as const, row: { ...row, deletedAt: null } })),
  ];
  if (!snapshot.reassigned.length && !snapshot.created.length) {
    await restoreRows(userId, categoryWrites);
    return;
  }
  const createdTombstones = snapshot.created.map((reference) => ({
    table: reference.table,
    row: { ...reference.row, deletedAt: nowIso() },
  }));
  await writeRowsValidated(userId, [...categoryWrites, ...snapshot.reassigned.map((reference) => ({
    table: reference.table,
    row: { ...reference.row, deletedAt: null },
  })) ?? [], ...createdTombstones], async (db) => {
    await assertRestorableRows(db, userId, categoryWrites);
    await Promise.all(snapshot.reassigned.map(async (reference) => {
      const current = await db.getFirstAsync<{ user_id: string }>(
        `SELECT user_id FROM ${reference.table} WHERE id = ?`,
        [String(reference.row.id)],
      );
      if (!current || current.user_id !== userId) throw new Error(`Cannot restore ${reference.table} row from another account`);
    }));
    await Promise.all(snapshot.created.map(async (reference) => {
      const current = await db.getFirstAsync<{ user_id: string; deleted_at: string | null }>(
        `SELECT user_id, deleted_at FROM ${reference.table} WHERE id = ?`,
        [String(reference.row.id)],
      );
      if (!current || current.user_id !== userId || current.deleted_at != null) {
        throw new Error(`Cannot remove reassigned ${reference.table} row from another account`);
      }
    }));
  });
}
