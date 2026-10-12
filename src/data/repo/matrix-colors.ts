/**
 * Setting and clearing the contextual colours on Mali Tablo (spec §1.3).
 * One row per target under a deterministic id, so devices never stack disagreeing marks.
 * Clearing tombstones, because a local-only delete comes back on the next pull.
 */

import { deterministicId, naturalKeys } from "../../db/ids";
import { assertLiveRow, nowIso, writeRowsValidated } from "../../db/mutations";
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
 * Mark a target, or clear it when `token` is null. A row/cell mark is validated against its live
 * category; computed-column and system keys (`opening`, `closing`) carry none, so the check is optional.
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
        // The column is NOT NULL, so a cleared mark stores a valid token; the tombstone is what clears it.
        token: token ?? "yellow",
        deletedAt: token === null ? nowIso() : null,
      },
    }],
    options.validateCategory && target.itemKey
      ? (sqlite) => assertLiveRow(sqlite, "categories", userId, target.itemKey!)
      : () => Promise.resolve(),
  );
}
