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
    openingCandidates: [],
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

  /**
   * The rule a replace import lives or dies by: it owns the years it is
   * importing and nothing else.
   *
   * The batch index records which rows belong to which year precisely so that
   * re-importing 2026 cannot touch 2025 — and the protection is a filter over
   * ids, which is the kind of thing that keeps working right up until the
   * moment it silently does not. Nothing exercised it, and the failure would
   * look like a year of records disappearing during an ordinary re-import.
   */
  it("re-importing one year leaves another year's rows alone", async () => {
    const yearSheet = (year: number): ParsedSheet => ({
      ...sheet(),
      sheetName: String(year),
      year,
      months: [`${year}-01` as MonthKey, `${year}-02` as MonthKey],
      openingBalance: { month: `${year}-01` as MonthKey, minor: OPENING_MINOR },
      openingCandidates: [],
    });
    const forYear = (year: number) => ({
      sheets: [yearSheet(year)],
      excludedLabels: [],
      selfId: "person-self",
      mode: "replace" as const,
    });

    await importSheets(USER, forYear(2025));
    const from2025 = new Set(liveRows().map((row) => row.id));
    expect(from2025.size).toBeGreaterThan(0);

    await importSheets(USER, forYear(2026));

    const live = new Set(liveRows().map((row) => row.id));
    for (const id of from2025) expect(live.has(id), `2025 row ${id} was removed by a 2026 import`).toBe(true);
    expect(live.size).toBeGreaterThan(from2025.size);
  });

  /**
   * An opaque monthly total keeps its comment as a cell note — that comment is
   * usually the only record of what the figure was made of, and losing it on
   * import loses the one thing a person could not reconstruct.
   */
  it("keeps an unitemizable cell's comment as a note on that cell", async () => {
    const noted = (): ParsedSheet => {
      const base = sheet();
      return {
        ...base,
        cells: base.cells.map((row, index) =>
          index === 0
            ? [{ ...row[0]!, comment: "Market + eczane, fişler kayıp" }]
            : row),
      };
    };

    await importSheets(USER, { sheets: [noted()], excludedLabels: [], selfId: "person-self", mode: "replace" });

    const notes = harness.db!
      .prepare(`SELECT month, body FROM cell_notes WHERE user_id = ? AND deleted_at IS NULL`)
      .all(USER) as { month: string; body: string }[];
    expect(notes).toEqual([{ month: "2026-01", body: "Market + eczane, fişler kayıp" }]);
  });

  /**
   * The batch record is what a replace import uses to know which rows it owns.
   * If it cannot be read, "replace" has no way to identify the rows it should
   * remove — so the only safe answer is to refuse, and to refuse in ADD mode
   * too, because add mode overwrites the same record and would leave the old
   * rows both unremovable and unattributed.
   *
   * Nothing exercised this. It is the guard that decides whether a corrupt
   * setting costs an error message or a year of doubled rows.
   */
  describe("when a year's batch record cannot be read", () => {
    const corrupt = (year: number, value: string) => {
      harness.db!.prepare(
        `INSERT INTO settings (id, user_id, created_at, updated_at, deleted_at, tombstone_version, key, value)
         VALUES (?, ?, ?, ?, NULL, 0, ?, ?)`,
      ).run(`setting-${year}`, USER, NOW, NOW, `import_batch:${year}`, value);
    };

    it("refuses a replace rather than orphaning the rows it cannot find", async () => {
      corrupt(2026, "{ not json");
      await expect(importSheets(USER, request("replace"))).rejects.toThrow();
      expect(liveRows()).toEqual([]);
    });

    it("refuses an add for the same reason, and writes nothing", async () => {
      corrupt(2026, JSON.stringify({ transactions: "not-an-array" }));
      await expect(importSheets(USER, request("add"))).rejects.toThrow();
      expect(liveRows()).toEqual([]);
      // The anchor is part of the same transaction, so a refusal leaves it too.
      expect(setting("opening_balance_minor")).toBeNull();
    });

    it("still imports a year whose own record is readable", async () => {
      corrupt(2025, "{ not json");
      await importSheets(USER, request("replace"));
      expect(liveRows().length).toBeGreaterThan(0);
    });
  });

  /**
   * A "Taksit" column whose cell comments list the instalments is the one place
   * the importer builds STRUCTURE — a card, a plan and its whole schedule —
   * rather than rows. None of it was covered.
   */
  describe("reconstructing an instalment plan from a comment", () => {
    const CARD = "Kart A";
    const comment = ["══════ Kart A ══════", "Robot Süpürge    2.777,67   3/9"].join("\n");

    function planSheet(): ParsedSheet {
      const base = sheet();
      return {
        ...base,
        columns: [...base.columns, { label: "KK Taksit", kindGuess: "expense", isInvestment: false, balanceLike: false, dueDay: null }],
        cells: base.cells.map((row, index) => [
          ...row,
          { valueMinor: 2_777_67, formulaParts: null, comment: index === 1 ? comment : null, commentParts: null },
        ]),
      };
    }

    const planRequest = (cardCycles?: Record<string, { statementDay: number; dueDay: number }>) => ({
      sheets: [planSheet()],
      excludedLabels: [],
      selfId: "person-self",
      mode: "replace" as const,
      ...(cardCycles ? { cardCycles } : {}),
    });

    /**
     * A plan needs a card, and a card needs a cycle: without a statement and a
     * due day there is no date to put an instalment on. Refusing is the only
     * honest answer, and it is what the wizard's cycle prompt exists to collect.
     */
    it("refuses when the workbook names a card whose cycle nobody supplied", async () => {
      await expect(importSheets(USER, planRequest())).rejects.toThrow();
      expect(liveRows()).toEqual([]);
    });

    it("creates the card, the plan and the whole schedule from one comment", async () => {
      await importSheets(USER, planRequest({ [CARD]: { statementDay: 25, dueDay: 10 } }));

      const sources = harness.db!
        .prepare(`SELECT name, type, statement_day, due_day FROM payment_sources WHERE user_id = ? AND deleted_at IS NULL`)
        .all(USER) as { name: string; type: string; statement_day: number; due_day: number }[];
      expect(sources).toEqual([{ name: CARD, type: "credit_card", statement_day: 25, due_day: 10 }]);

      const plans = harness.db!
        .prepare(`SELECT title, kind, installment_count, monthly_amount_minor FROM installment_plans WHERE user_id = ? AND deleted_at IS NULL`)
        .all(USER) as { title: string; kind: string; installment_count: number; monthly_amount_minor: number }[];
      expect(plans).toEqual([{ title: "Robot Süpürge", kind: "card_installment", installment_count: 9, monthly_amount_minor: 2_777_67 }]);

      // Nine instalments, and the plan starts where the comment says: the cell
      // is February and it is the 3rd payment, so the first was December 2025.
      const rows = harness.db!
        .prepare(`SELECT effective_date FROM transactions WHERE user_id = ? AND installment_plan_id IS NOT NULL AND deleted_at IS NULL ORDER BY effective_date`)
        .all(USER) as { effective_date: string }[];
      expect(rows).toHaveLength(9);
      expect(rows[0]!.effective_date.slice(0, 7)).toBe("2025-12");
    });

    /**
     * The plan is structure, so a repeated replace must not leave two of it.
     * The batch record carries plan ids for exactly this reason.
     */
    it("does not stack a second copy of the plan on a repeated import", async () => {
      const req = planRequest({ [CARD]: { statementDay: 25, dueDay: 10 } });
      await importSheets(USER, req);
      await importSheets(USER, req);

      const plans = harness.db!
        .prepare(`SELECT COUNT(*) AS n FROM installment_plans WHERE user_id = ? AND deleted_at IS NULL`)
        .get(USER) as { n: number };
      expect(plans.n).toBe(1);
    });
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
      openingCandidates: [],
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
      openingCandidates: [],
    });
    expect(openingBalanceFromSheets([sheet(2026, 500_00), sheet(2025, 300_00)]))
      .toEqual({ month: "2025-01", minor: 300_00 });
    // A year the owner did not select cannot move the anchor.
    expect(openingBalanceFromSheets([sheet(2026, 500_00), sheet(2025, 300_00)], (year) => year === 2026))
      .toEqual({ month: "2026-01", minor: 500_00 });
    expect(openingBalanceFromSheets([{ ...sheet(2026, 0), openingBalance: null }])).toBeNull();
    expect(openingBalanceFromSheets([])).toBeNull();
  });

  /**
   * A heading is the one part of a personal spreadsheet nobody else wrote the
   * rules for. "Toplam", "Ay Sonu" and "Devreden" are all somebody's opening
   * balance and none of them is anybody else's, so the reading is a default
   * and the owner can name the column instead.
   */
  describe("when the owner names the column instead", () => {
    const sheet = (year: number): ParsedSheet => ({
      sheetName: String(year),
      year,
      months: [`${year}-01` as MonthKey],
      columns: [],
      cells: [[]],
      skippedColumns: ["Ay Başı", "Toplam"],
      openingBalance: { month: `${year}-01` as MonthKey, minor: 100_00 },
      openingCandidates: [
        { label: "Ay Başı", month: `${year}-01` as MonthKey, minor: 100_00 },
        { label: "Toplam", month: `${year}-01` as MonthKey, minor: 900_00 },
      ],
    });

    it("takes the figure out of the column that was named", () => {
      expect(openingBalanceFromSheets([sheet(2026)], () => true, "Toplam"))
        .toEqual({ month: "2026-01", minor: 900_00 });
    });

    it("still honours the year filter", () => {
      expect(openingBalanceFromSheets([sheet(2025), sheet(2026)], (year) => year === 2026, "Toplam"))
        .toEqual({ month: "2026-01", minor: 900_00 });
    });

    /**
     * A named column that is not in the workbook yields NOTHING rather than
     * falling back: a person who answered the question must not be quietly
     * overruled by the heading rule they were correcting.
     */
    it("refuses to fall back to the guess it was correcting", () => {
      expect(openingBalanceFromSheets([sheet(2026)], () => true, "Devreden")).toBeNull();
    });

    it("goes back to the heading rule when no column was named", () => {
      expect(openingBalanceFromSheets([sheet(2026)], () => true, null))
        .toEqual({ month: "2026-01", minor: 100_00 });
    });
  });
});
