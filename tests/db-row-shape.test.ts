/**
 * `fromDbShape` decides which columns survive a soft delete, an undo and a
 * reassignment — every one of those is `{ ...fromDbShape(table, previous) }`
 * plus the field being changed, so whatever it drops is written back as the
 * column's default.
 *
 * Four test files mock it to the identity function, which is right for what
 * they assert (validation and write composition) and wrong as the only account
 * of it: under that mock a snapshot in the wrong shape reaches `writeRows`
 * unchanged and every assertion still passes. Nothing tested the real one.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => ({ runAsync: vi.fn(), getAllAsync: vi.fn(), getFirstAsync: vi.fn() }),
  withTransaction: async (fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../src/db/ids", () => ({
  deterministicId: async (key: string) => `id:${key}`,
  naturalKeys: new Proxy({}, { get: (_t, p) => (...parts: unknown[]) => `${String(p)}|${parts.join("|")}` }),
  newId: () => "new-id",
}));

import { fromDbShape } from "../src/db/mutations";

const storedTransaction = {
  id: "tx-1",
  user_id: "user-1",
  type: "expense",
  amount_minor: 12_34,
  amount_try_minor: 12_34,
  currency: "TRY",
  effective_date: "2026-08-06",
  is_aggregate: 0,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-08-06T00:00:00.000Z",
  deleted_at: null,
};

describe("fromDbShape", () => {
  it("renames every stored column to the key the write layer writes", () => {
    const row = fromDbShape("transactions", storedTransaction);
    expect(row).toMatchObject({
      id: "tx-1",
      userId: "user-1",
      amountMinor: 12_34,
      amountTryMinor: 12_34,
      effectiveDate: "2026-08-06",
      isAggregate: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
    });
    // The snake_case originals must not survive beside their renamed twins:
    // `writeRows` would carry them into the upsert as unknown columns.
    expect(Object.keys(row).some((key) => key.includes("_"))).toBe(false);
  });

  it("keeps a column that is present and null, and omits one that is absent", () => {
    const row = fromDbShape("transactions", storedTransaction);
    // Present-and-null is a real value — dropping it would leave a tombstone in
    // place on restore, because the spread would never clear `deleted_at`.
    expect("deletedAt" in row).toBe(true);
    expect(row.deletedAt).toBeNull();
    // Absent is not `undefined`: a partial row must not blank the columns it
    // never carried.
    expect("note" in row).toBe(false);
  });

  it("drops a column the table does not have", () => {
    const row = fromDbShape("transactions", { ...storedTransaction, legacy_column: "x", note: "kept" });
    expect(row.note).toBe("kept");
    expect(Object.values(row)).not.toContain("x");
  });

  it("returns nothing at all for a row that is already in application shape", () => {
    // The failure the old `Record<string, unknown>` signature allowed: an
    // application-shaped row passed where a stored row was meant produces an
    // EMPTY object, and `{ ...{}, deletedAt: null }` is a write of one column
    // over a row that no longer has an id.
    expect(fromDbShape("transactions", { id: "tx-1", amountMinor: 1, effectiveDate: "2026-08-06" })).toEqual({
      id: "tx-1",
    });
  });
});
