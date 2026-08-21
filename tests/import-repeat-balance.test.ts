/**
 * Importing the same workbook twice.
 *
 * The reported failure is the one this file exists to disprove: a second
 * import of the SAME source silently doubling the ledger, most visibly through
 * the opening balance. It runs the real importer against a real database with
 * the real migrations, because every guard involved — the per-year batch
 * index, the opening-balance anchor and the replace-mode cleanup — is a
 * property of the write path, not of a mock.
 *
 * The workbook is synthetic. No personal financial data belongs in this repo.
 */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null, nextId: 0 }));

vi.mock("../src/db/client", async () => {
  const { sqliteClientMock } = await import("./helpers");
  return sqliteClientMock(() => harness.db!);
});

vi.mock("../src/db/ids", () => ({
  newId: () => `0198f2aa-0000-7000-8000-${String(++harness.nextId).padStart(12, "0")}`,
  deterministicId: async (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 32),
  naturalKeys: new Proxy({}, {
    get: (_target, property) => (...parts: unknown[]) => `${String(property)}|${parts.join("|")}`,
  }),
}));
vi.mock("../src/sync/engine", () => ({ scheduleSync: vi.fn() }));

import { importSheets, openingBalanceFromSheets } from "../src/data/repo/imports";
import type { ParsedSheet } from "../src/services/spreadsheet-import";
import { currentBalance } from "../src/domain/balance";
import type { TxLike } from "../src/domain/types";
import type { MonthKey } from "../src/domain/dates";
import { migrationStatements } from "./helpers";

const USER = "import-user";
const NOW = "2026-08-18T09:00:00.000Z";
const OPENING_MINOR = 10_000_00;


function seed(): void {
  harness.db!.prepare(
    `INSERT INTO persons (id, user_id, created_at, updated_at, deleted_at, tombstone_version, name, is_self)
     VALUES ('person-self', ?, ?, ?, NULL, 0, 'Ben', 1)`,
  ).run(USER, NOW, NOW);
}

/** One month, one expense column, one opening-balance cell. */
function sheet(): ParsedSheet {
  return {
    sheetName: "2026",
    year: 2026,
    months: ["2026-01", "2026-02"],
    columns: [{ label: "Market", kindGuess: "expense", isInvestment: false, balanceLike: false, dueDay: null }],
    cells: [
      [{ valueMinor: 1_500_00, formulaParts: null, comment: null, commentParts: null }],
      [{ valueMinor: 2_500_00, formulaParts: null, comment: null, commentParts: null }],
    ],
    skippedColumns: [],
    openingBalance: { month: "2026-01", minor: OPENING_MINOR },
  };
}

const request = (mode: "replace" | "add") => ({
  sheets: [sheet()],
  excludedLabels: [],
  selfId: "person-self",
  mode,
});

const setting = (key: string): unknown => {
  const row = harness.db!
    .prepare(`SELECT value FROM settings WHERE user_id = ? AND key = ? AND deleted_at IS NULL`)
    .get(USER, key) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : null;
};

interface Row { id: string; type: string; amount_try_minor: number; effective_date: string; status: string; person_id: string; category_id: string | null; is_aggregate: number; origin: string | null }

const liveRows = (): Row[] =>
  harness.db!.prepare(`SELECT * FROM transactions WHERE user_id = ? AND deleted_at IS NULL`).all(USER) as unknown as Row[];

/** The balance the dashboard would show, derived exactly as production does. */
function balanceNow(): number {
  const transactions: TxLike[] = liveRows().map((row) => ({
    id: row.id,
    type: row.type as TxLike["type"],
    amountTryMinor: row.amount_try_minor,
    effectiveDate: row.effective_date,
    status: row.status as TxLike["status"],
    categoryId: row.category_id,
    categoryKind: "expense",
    paymentSourceId: null,
    personIsSelf: row.person_id === "person-self",
    installmentPlanId: null,
    subscriptionId: null,
    isAggregate: Boolean(row.is_aggregate),
  }));
  return currentBalance({
    openingBalanceMinor: Number(setting("opening_balance_minor") ?? 0),
    transactions,
    adjustments: [],
    today: "2026-12-31",
  });
}

describe("importing the same workbook twice", () => {
  beforeEach(() => {
    harness.db = new DatabaseSync(":memory:");
    for (const statement of migrationStatements) harness.db.exec(statement);
    harness.nextId = 0;
    seed();
  });

  it("anchors the ledger from the workbook's own opening cell", async () => {
    await importSheets(USER, request("replace"));
    expect(setting("start_month")).toBe("2026-01");
    expect(setting("opening_balance_minor")).toBe(OPENING_MINOR);
  });

  /**
   * The reported failure. The anchor is an ABSOLUTE assignment behind a
   * "only if this workbook starts earlier" guard, so a second import can
   * neither add to it nor move it — but that is a property worth proving
   * rather than reading.
   */
  it("does not double the opening balance on a repeated replace import", async () => {
    await importSheets(USER, request("replace"));
    const afterFirst = { opening: setting("opening_balance_minor"), balance: balanceNow(), rows: liveRows().length };

    await importSheets(USER, request("replace"));

    expect(setting("opening_balance_minor")).toBe(afterFirst.opening);
    expect(setting("opening_balance_minor")).toBe(OPENING_MINOR);
    expect(liveRows()).toHaveLength(afterFirst.rows);
    expect(balanceNow()).toBe(afterFirst.balance);
  });

  it("keeps the balance stable across many repeated replace imports", async () => {
    await importSheets(USER, request("replace"));
    const expected = balanceNow();
    for (let round = 0; round < 3; round += 1) await importSheets(USER, request("replace"));
    expect(balanceNow()).toBe(expected);
    expect(setting("opening_balance_minor")).toBe(OPENING_MINOR);
  });

  /** Replace means replace: the previous year's rows are gone, not stacked. */
  it("replaces the previous import's rows rather than adding to them", async () => {
    await importSheets(USER, request("replace"));
    const firstIds = new Set(liveRows().map((row) => row.id));
    await importSheets(USER, request("replace"));
    const secondIds = new Set(liveRows().map((row) => row.id));
    expect(secondIds.size).toBe(firstIds.size);
    // Genuinely new rows, with the old ones tombstoned rather than left live.
    const tombstoned = harness.db!
      .prepare(`SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND deleted_at IS NOT NULL`)
      .get(USER) as { n: number };
    expect(tombstoned.n).toBe(firstIds.size);
  });

  /**
   * Add mode is the deliberate other choice, and it must behave as advertised:
   * the rows stack (that is what "add" means) while the ANCHOR still does not
   * move, so a second import cannot change what the ledger starts from.
   */
  it("stacks rows in add mode but still never moves the anchor", async () => {
    await importSheets(USER, request("replace"));
    const first = liveRows().length;
    await importSheets(USER, request("add"));
    expect(liveRows().length).toBe(first * 2);
    expect(setting("opening_balance_minor")).toBe(OPENING_MINOR);
    expect(setting("start_month")).toBe("2026-01");
  });

  it("marks every imported row with its origin so review can tell it apart", async () => {
    await importSheets(USER, request("replace"));
    expect(liveRows().every((row) => row.origin === "spreadsheet")).toBe(true);
  });

  /** An earlier workbook may move the anchor back; a later one may not. */
  it("moves the anchor only when the workbook genuinely starts earlier", async () => {
    await importSheets(USER, request("replace"));
    const earlier: ParsedSheet = {
      ...sheet(),
      sheetName: "2025",
      year: 2025,
      months: ["2025-12"],
      cells: [[{ valueMinor: 100_00, formulaParts: null, comment: null, commentParts: null }]],
      openingBalance: { month: "2025-12", minor: 5_000_00 },
    };
    await importSheets(USER, { ...request("add"), sheets: [earlier] });
    expect(setting("start_month")).toBe("2025-12");
    expect(setting("opening_balance_minor")).toBe(5_000_00);

    const later: ParsedSheet = { ...sheet(), openingBalance: { month: "2026-06", minor: 99_999_00 } };
    await importSheets(USER, { ...request("add"), sheets: [later] });
    expect(setting("start_month")).toBe("2025-12");
    expect(setting("opening_balance_minor")).toBe(5_000_00);
  });
});

/**
 * The anchor the whole chained ledger hangs off.
 *
 * It used to be written silently and only when the workbook's month was
 * EARLIER than the current anchor — so the first import's answer was permanent
 * and re-importing a corrected workbook could never put a wrong opening balance
 * right. The importer states the figure and the owner decides.
 */
describe("adopting a workbook's opening balance", () => {
  it("reads the earliest opening cell among the imported years", () => {
    const sheet = (year: number, minor: number): ParsedSheet => ({
      sheetName: String(year),
      year,
      months: [`${year}-01` as MonthKey],
      columns: [],
      cells: [[]],
      skippedColumns: [],
      openingBalance: { month: `${year}-01` as MonthKey, minor },
    });
    expect(openingBalanceFromSheets([sheet(2026, 500_00), sheet(2025, 300_00)]))
      .toEqual({ month: "2025-01", minor: 300_00 });
    // A year the owner did not select cannot move the anchor.
    expect(openingBalanceFromSheets([sheet(2026, 500_00), sheet(2025, 300_00)], (year) => year === 2026))
      .toEqual({ month: "2026-01", minor: 500_00 });
    expect(openingBalanceFromSheets([{ ...sheet(2026, 0), openingBalance: null }])).toBeNull();
    expect(openingBalanceFromSheets([])).toBeNull();
  });
});
