import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  getSqliteAsync: vi.fn(),
  writeRows: vi.fn(),
  runMaintenance: vi.fn(async () => {}),
}));

vi.mock("../src/db/client", () => ({ getSqliteAsync: dependencies.getSqliteAsync }));
vi.mock("../src/db/mutations", () => ({
  fromDbShape: (_table: string, row: Record<string, unknown>) => row,
  nowIso: () => "2026-08-02T00:00:00.000Z",
  restoreRow: vi.fn(),
  restoreRows: vi.fn(),
  softDelete: vi.fn(),
  writeRows: dependencies.writeRows,
  writeRowsValidated: vi.fn(),
  assertLiveRow: vi.fn(),
}));
vi.mock("../src/db/ids", () => ({ newId: () => "new-id" }));
vi.mock("../src/data/repo/maintenance", () => ({
  repairCardStatementLinks: vi.fn(),
  runMaintenance: dependencies.runMaintenance,
}));

import { deleteUnreferencedPerson, reassignAndDeletePerson } from "../src/data/repo/accounts";

describe("person reference lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reassigns every live reference before tombstoning the watched person", async () => {
    const references = {
      payment_sources: [{ id: "source-1", person_id: "watch" }],
      installment_plans: [{ id: "plan-1", person_id: "watch" }],
      transactions: [{ id: "tx-1", person_id: "watch" }],
      subscriptions: [{ id: "subscription-1", person_id: "watch" }],
      recurring_incomes: [{ id: "income-1", person_id: "watch" }],
    };
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (_sql: string, args: unknown[]) => args[0] === "watch"
        ? { id: "watch", user_id: "user-1", is_self: 0, deleted_at: null }
        : { id: "self", user_id: "user-1", is_self: 1, deleted_at: null },
      getAllAsync: async (sql: string) => {
        for (const [table, rows] of Object.entries(references)) {
          if (sql.includes(`FROM ${table}`)) return rows;
        }
        return [];
      },
    });

    await reassignAndDeletePerson("user-1", "watch", "self");

    expect(dependencies.writeRows).toHaveBeenCalledOnce();
    const [, writes] = dependencies.writeRows.mock.calls[0] as [
      string,
      { table: string; row: Record<string, unknown> }[],
    ];
    expect(writes.map((write) => write.table)).toEqual([
      "payment_sources",
      "installment_plans",
      "transactions",
      "subscriptions",
      "recurring_incomes",
      "persons",
    ]);
    expect(writes.slice(0, -1).every((write) => write.row.personId === "self")).toBe(true);
    expect(writes.at(-1)?.row).toMatchObject({ id: "watch", deletedAt: "2026-08-02T00:00:00.000Z" });
    expect(dependencies.runMaintenance).toHaveBeenCalledWith("user-1");
  });

  it("refuses deletion while any reference is live", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => sql.includes("COUNT(*)")
        ? { paymentSources: 1, installmentPlans: 0, transactions: 0, subscriptions: 0, recurringIncomes: 0 }
        : null,
      getAllAsync: async () => [],
    });

    await expect(deleteUnreferencedPerson("user-1", "watch")).rejects.toThrow(/references/i);
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });
});
