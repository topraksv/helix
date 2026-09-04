/**
 * Committing the statement rows a person accepted (spec §3.1b).
 *
 * Everything here happens AFTER a review: this module never decides what to
 * import, only how to write what was already approved. Two properties carry
 * the whole thing:
 *
 * - **Deterministic identity.** Each row's id is derived from the statement
 *   line it came from (`naturalKeys.statementTx`), so importing the same
 *   statement twice converges on the same rows instead of adding a second copy
 *   — even across devices, and even if the first import's outbox never synced.
 * - **All or nothing.** One batch, one transaction. A statement that fails
 *   half way through must leave the ledger exactly as it was, because a
 *   half-imported statement is indistinguishable from a complete one.
 */

import { getSqliteAsync } from "../../db/client";
import { deterministicId, naturalKeys } from "../../db/ids";
import { writeRowsValidated, type RowWrite } from "../../db/mutations";
import { todayISO, type ISODate } from "../../domain/dates";
import { assertSupportedMinorAmount, type Minor } from "../../domain/money";
import { assertInputWithinLimit } from "../../domain/input";
import { assertLiveTransactionPerson, assertTransactionCategory } from "./transactions";

/** One approved row, as the review hands it over. */
export interface AcceptedStatementRow {
  importKey: string;
  /** Editable in review: the owner may correct anything the parser read. */
  date: ISODate;
  description: string;
  amountMinor: Minor;
  isRefund: boolean;
  categoryId: string;
  paymentSourceId: string | null;
}

export interface StatementCommitResult {
  writtenIds: string[];
  /** Rows whose id already existed: the same line, imported before. */
  skipped: number;
}

/** SQLite binds far more than this. The ids are asked for in groups anyway, so
 *  the statement text stays the same size whatever the import's length. */
const ID_LOOKUP_CHUNK = 200;

/** Which of `ids` this account already holds a transaction for. */
async function existingTransactionIds(
  sqlite: Awaited<ReturnType<typeof getSqliteAsync>>,
  userId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  const present = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += ID_LOOKUP_CHUNK) {
    const chunk = ids.slice(offset, offset + ID_LOOKUP_CHUNK);
    const rows = await sqlite.getAllAsync<{ id: string }>(
      `SELECT id FROM transactions WHERE user_id = ? AND id IN (${chunk.map(() => "?").join(", ")})`,
      [userId, ...chunk],
    );
    for (const row of rows) present.add(row.id);
  }
  return present;
}

/**
 * Write the accepted rows in one atomic batch.
 *
 * Rows whose deterministic id is already present are SKIPPED rather than
 * overwritten. Overwriting would silently discard an edit the owner made to
 * that transaction after the first import, which is exactly the kind of loss
 * an importer must never cause.
 */
export async function commitStatementRows(
  userId: string,
  personId: string,
  rows: readonly AcceptedStatementRow[],
): Promise<StatementCommitResult> {
  if (rows.length === 0) return { writtenIds: [], skipped: 0 };
  const sqlite = await getSqliteAsync();
  const today = todayISO();

  await assertLiveTransactionPerson(userId, personId);
  const writes: RowWrite[] = [];
  const writtenIds: string[] = [];
  let skipped = 0;

  // Checked as what is actually WRITTEN below: a refund is a negative expense
  // in its own category, never income. Validating it as income rejected every
  // refund whose category was (correctly) an expense one.
  //
  // Once per distinct category rather than once per row. A statement is
  // hundreds of lines drawn from a handful of columns, so the per-row form
  // asked the same question of the same category hundreds of times.
  for (const categoryId of new Set(rows.map((row) => row.categoryId))) {
    await assertTransactionCategory(userId, "expense", categoryId, true);
  }

  // The ids first, then ONE existence read for all of them. Per-row point
  // reads are what a statement import spent its time on, and on web each is a
  // round trip to the SQLite worker.
  const idByRow = new Map<string, string>();
  for (const row of rows) {
    idByRow.set(row.importKey, await deterministicId(naturalKeys.statementTx(userId, row.importKey)));
  }
  const present = await existingTransactionIds(sqlite, userId, [...idByRow.values()]);

  for (const row of rows) {
    assertInputWithinLimit(row.description, "text");
    assertSupportedMinorAmount(row.amountMinor, false);
    if (row.amountMinor <= 0) throw new Error("Statement row amount must be positive");

    const id = idByRow.get(row.importKey)!;
    if (present.has(id)) {
      skipped += 1;
      continue;
    }
    // A refund is an expense with a negative amount, in the same category —
    // the canonical form the rest of the ledger already uses, so a refund
    // reduces its category rather than appearing as unrelated income.
    const signed = row.isRefund ? -row.amountMinor : row.amountMinor;
    writes.push({
      table: "transactions",
      row: {
        id,
        type: "expense",
        amountMinor: signed,
        currency: "TRY",
        fxRate: null,
        amountTryMinor: signed,
        entryDate: today,
        purchaseDate: row.date,
        effectiveDate: row.date,
        status: row.date <= today ? "realized" : "pending",
        categoryId: row.categoryId,
        paymentSourceId: row.paymentSourceId,
        personId,
        installmentPlanId: null,
        installmentNo: null,
        cardStatementId: null,
        subscriptionId: null,
        isAggregate: false,
        note: row.description,
        origin: "statement",
        importKey: row.importKey,
        deletedAt: null,
      },
    });
    writtenIds.push(id);
  }

  if (writes.length > 0) {
    // One call, one database transaction: a failure anywhere rolls the whole
    // statement back rather than leaving a partial import nobody can identify.
    await writeRowsValidated(userId, writes, () => Promise.resolve());
  }
  return { writtenIds, skipped };
}
