/**
 * Setting and clearing the contextual colours on Mali Tablo (spec §3.1d).
 *
 * One row per target, addressed by a deterministic id, so re-colouring the
 * same cell updates it on every device instead of stacking marks that
 * disagree. Clearing tombstones rather than deletes, for the same reason every
 * other row here does: a delete that only happened locally comes back on the
 * next pull.
 */

import { deterministicId, naturalKeys } from "../../db/ids";
import { assertLiveRow, nowIso, writeRowsValidated } from "../../db/mutations";
import { scheduleSync } from "../../sync/engine";
import { isValidColorTarget, isMatrixColorToken, type MatrixColorScope, type MatrixColorToken } from "../../domain/matrix-colors";

export interface ColorTarget {
  scope: MatrixColorScope;
  /** Category id or computed-column key; null for a whole-month mark. */
  itemKey: string | null;
  /** Month key; null for a whole-row mark. */
  month: string | null;
}

async function colorRowId(userId: string, target: ColorTarget): Promise<string> {
  return deterministicId(
    naturalKeys.matrixColor(userId, target.scope, target.itemKey ?? "", target.month ?? ""),
  );
}

/**
 * Mark a target, or clear it when `token` is null.
 *
 * A row/cell mark is validated against the live category it names — a colour
 * pointing at a deleted category is a mark that can never be seen or removed
 * again. Computed-column and system keys (`opening`, `closing`) carry no
 * category, which is why the check is conditional rather than unconditional.
 */
export async function setMatrixColor(
  userId: string,
  target: ColorTarget,
  token: MatrixColorToken | null,
  options: { validateCategory?: boolean } = {},
): Promise<void> {
  if (!isValidColorTarget(target)) throw new Error("Invalid matrix colour target");
  if (token !== null && !isMatrixColorToken(token)) throw new Error("Invalid matrix colour token");
  const id = await colorRowId(userId, target);
  await writeRowsValidated(
    userId,
    [{
      table: "matrix_colors",
      row: {
        id,
        scope: target.scope,
        itemKey: target.itemKey,
        month: target.month,
        // A cleared mark keeps its last token: the column is NOT NULL, and the
        // tombstone is what makes it cleared. Storing a placeholder token here
        // would make a restored tombstone unreadable to the validator.
        token: token ?? "yellow",
        deletedAt: token === null ? nowIso() : null,
      },
    }],
    options.validateCategory && target.itemKey
      ? (sqlite) => assertLiveRow(sqlite, "categories", userId, target.itemKey!)
      : () => Promise.resolve(),
  );
  scheduleSync(userId);
}
