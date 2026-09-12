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
import { setOpeningBalance } from "../src/data/repo/onboarding";
import type { CellData, ParsedSheet } from "../src/services/spreadsheet-import";
import { currentBalance } from "../src/domain/balance";
import type { TxLike } from "../src/domain/types";
import type { ISODate, MonthKey } from "../src/domain/dates";
import { tr } from "../src/i18n/tr";
import { migrationStatements, required } from "./helpers";

const USER = "import-user";
const NOW = "2026-08-18T09:00:00.000Z";
const OPENING_MINOR = 10_000_00;


function seed(): void {
  harness.db!.prepare(
    `INSERT INTO persons (id, user_id, created_at, updated_at, deleted_at, tombstone_version, name, is_self)
     VALUES ('person-self', ?, ?, ?, NULL, 0, 'Ben', 1)`,
  ).run(USER, NOW, NOW);
}

const OPENING_LABEL = "Ay Başında Eldeki Para";
const money = (valueMinor: number | null): CellData => ({ valueMinor, formulaParts: null, comment: null, commentParts: null });

/** Two months, one expense column, and the opening-balance column beside it. */
function sheet(): ParsedSheet {
  return {
    sheetName: "2026",
    year: 2026,
    months: ["2026-01", "2026-02"],
    columns: [
      { label: "Market", kindGuess: "expense", isInvestment: false, balanceLike: false, dueDay: null },
      { label: OPENING_LABEL, kindGuess: "expense", isInvestment: false, balanceLike: true, dueDay: null },
    ],
    cells: [
      [money(1_500_00), money(OPENING_MINOR)],
      [money(2_500_00), money(null)],
    ],
    skippedColumns: [OPENING_LABEL],
    openingColumn: OPENING_LABEL,
    openingCandidates: [{ label: OPENING_LABEL, month: "2026-01", minor: OPENING_MINOR }],
  };
}

const request = (mode: "replace" | "add") => ({
  sheets: [sheet()],
  excludedLabels: [OPENING_LABEL],
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

/** What one month's imported rows do to the balance, income positive. */
const monthTotal = (month: string): number =>
  liveRows()
    .filter((row) => row.effective_date.startsWith(month))
    .reduce((sum, row) => sum + (row.type === "income" ? row.amount_try_minor : -row.amount_try_minor), 0);

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
  const adjustments = harness.db!
    .prepare(`SELECT date, amount_minor FROM balance_adjustments WHERE user_id = ? AND deleted_at IS NULL`)
    .all(USER) as { date: string; amount_minor: number }[];
  return currentBalance({
    openingBalanceMinor: Number(setting("opening_balance_minor") ?? 0),
    transactions,
    adjustments: adjustments.map((row) => ({ date: row.date as ISODate, amountMinor: row.amount_minor })),
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
    });
    const forYear = (year: number) => ({
      sheets: [yearSheet(year)],
      excludedLabels: [OPENING_LABEL],
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
            ? [{ ...row[0]!, comment: "Market + eczane, fişler kayıp" }, ...row.slice(1)]
            : row),
      };
    };

    await importSheets(USER, { sheets: [noted()], excludedLabels: [OPENING_LABEL], selfId: "person-self", mode: "replace" });

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
      excludedLabels: [OPENING_LABEL],
      selfId: "person-self",
      mode: "replace" as const,
      ...(cardCycles ? { cardCycles } : {}),
    });

    /**
     * A cycle is optional.
     *
     * A workbook names every card a comment mentions — a partner's, a shop
     * card, one that turns out to be a debit card — and demanding a statement
     * and a due day for each before anything can be imported asks the owner to
     * invent dates for cards they do not hold. Without one the card is created
     * without a cycle and the instalment falls on its own month, which is where
     * every other imported row falls anyway.
     */
    it("imports a card whose cycle nobody supplied, on the instalment's own month", async () => {
      await importSheets(USER, planRequest());

      const source = harness.db!
        .prepare(`SELECT statement_day, due_day FROM payment_sources WHERE user_id = ? AND deleted_at IS NULL`)
        .all(USER) as { statement_day: number | null; due_day: number | null }[];
      expect(source).toEqual([{ statement_day: null, due_day: null }]);
      const rows = harness.db!
        .prepare(`SELECT effective_date FROM transactions WHERE user_id = ? AND installment_plan_id IS NOT NULL AND deleted_at IS NULL ORDER BY effective_date`)
        .all(USER) as { effective_date: string }[];
      expect(required(rows[0]).effective_date).toBe("2025-12-01");
    });

    /**
     * The cell and its instalments are the same money when they add up, so the
     * plan's rows ARE the cell: the month carries the card and the payment
     * number instead of one opaque total, and the column total is unchanged.
     */
    it("creates the card, the plan and the whole schedule when the cell adds up to it", async () => {
      await importSheets(USER, planRequest({ [CARD]: { statementDay: 25, dueDay: 10 } }));

      const sources = harness.db!
        .prepare(`SELECT name, type, statement_day, due_day FROM payment_sources WHERE user_id = ? AND deleted_at IS NULL`)
        .all(USER) as { name: string; type: string; statement_day: number; due_day: number }[];
      expect(sources).toEqual([{ name: CARD, type: "credit_card", statement_day: 25, due_day: 10 }]);

      const plans = harness.db!
        .prepare(`SELECT title, kind, installment_count, monthly_amount_minor FROM installment_plans WHERE user_id = ? AND deleted_at IS NULL`)
        .all(USER) as { title: string; kind: string; installment_count: number; monthly_amount_minor: number }[];
      expect(plans).toEqual([{ title: "Robot Süpürge", kind: "card_installment", installment_count: 9, monthly_amount_minor: 2_777_67 }]);

      // The plan starts where the comment says: the cell is February and it is
      // the 3rd payment, so the first was December 2025.
      const rows = harness.db!
        .prepare(`SELECT effective_date FROM transactions WHERE user_id = ? AND installment_plan_id IS NOT NULL AND deleted_at IS NULL ORDER BY effective_date`)
        .all(USER) as { effective_date: string }[];
      expect(rows).toHaveLength(9);
      expect(required(rows[0]).effective_date.slice(0, 7)).toBe("2025-12");
      // Once, not twice: the cell's own aggregate gave way to the plan rows.
      expect(monthTotal("2026-01")).toBe(-(1_500_00 + 2_777_67));
    });

    /**
     * A column the owner keeps NET of the column beside it.
     *
     * The owner's file writes the whole card statement into "Kredi Kartı
     * Taksitler" and subtracts the single-charge column from it, so the cell
     * holds less than the instalments its own comment lists. Every instalment
     * is still written — the Taksitler screen is the whole point of
     * reconstructing them — and the cell keeps the difference, which here is
     * negative. The column totals what the workbook says either way.
     */
    it("writes every instalment and leaves the cell holding the difference", async () => {
      const netSheet = (): ParsedSheet => {
        const base = planSheet();
        return {
          ...base,
          // The column carries 1.000,00 where its comment reconstructs 2.777,67.
          cells: base.cells.map((row) => [...row.slice(0, -1), { ...row.at(-1)!, valueMinor: 1_000_00 }]),
        };
      };
      await importSheets(USER, { ...planRequest({ [CARD]: { statementDay: 25, dueDay: 10 } }), sheets: [netSheet()] });

      // 1.000,00 in the column, whichever way it is made up.
      expect(monthTotal("2026-01")).toBe(-(1_500_00 + 1_000_00));
      expect(monthTotal("2026-02")).toBe(-(2_500_00 + 1_000_00));
      // The whole schedule is there, including the two months the sheet states.
      const months = (harness.db!
        .prepare(`SELECT effective_date FROM transactions WHERE user_id = ? AND installment_plan_id IS NOT NULL AND deleted_at IS NULL ORDER BY effective_date`)
        .all(USER) as { effective_date: string }[]).map((row) => row.effective_date.slice(0, 7));
      expect(months).toHaveLength(9);
      expect(months).toContain("2026-01");
      // And the difference is one row that says what it is.
      const remainder = harness.db!
        .prepare(`SELECT amount_try_minor v, note FROM transactions WHERE user_id = ? AND note IS NOT NULL AND installment_plan_id IS NULL AND effective_date LIKE '2026-01%' AND deleted_at IS NULL`)
        .all(USER) as { v: number; note: string }[];
      expect(remainder).toEqual([{ v: 1_000_00 - 2_777_67, note: tr.importer.columnRemainder }]);
    });

    /**
     * A card the owner watches rather than pays.
     *
     * The owner's file keeps two of their partner's cards under her own name,
     * tracked on purpose and deliberately outside the table — which is what a
     * non-self person IS here: rows that are recorded and never counted.
     * Landing them on the balance is the same mistake as double-counting, in
     * the other direction.
     */
    it("gives a card named after a tracked person that person's rows, out of the balance", async () => {
      harness.db!.prepare(
        `INSERT INTO persons (id, user_id, created_at, updated_at, deleted_at, tombstone_version, name, is_self)
         VALUES ('person-betul', ?, ?, ?, NULL, 0, 'Betül', 0)`,
      ).run(USER, NOW, NOW);
      const watched = (): ParsedSheet => {
        const base = planSheet();
        return {
          ...base,
          cells: base.cells.map((row, index) => [
            ...row.slice(0, -1),
            { ...row.at(-1)!, comment: index === 1 ? "══ Betül Axess ══\nRobot Süpürge  2.777,67  3/9" : null },
          ]),
        };
      };
      await importSheets(USER, { ...planRequest({ "Betül Axess": { statementDay: 25, dueDay: 10 } }), sheets: [watched()] });

      const rows = harness.db!
        .prepare(`SELECT person_id, COUNT(*) n FROM transactions WHERE user_id = ? AND installment_plan_id IS NOT NULL AND deleted_at IS NULL GROUP BY person_id`)
        .all(USER) as { person_id: string; n: number }[];
      // The whole schedule, because none of it can be inside a column total.
      expect(rows).toEqual([{ person_id: "person-betul", n: 9 }]);
      const source = harness.db!
        .prepare(`SELECT person_id FROM payment_sources WHERE user_id = ? AND deleted_at IS NULL`)
        .all(USER) as { person_id: string }[];
      expect(source).toEqual([{ person_id: "person-betul" }]);
      // The cell is untouched — a watched card is not inside the owner's column
      // total, so it can neither add up to the cell nor be counted twice by it.
      // The month therefore holds both, and only one of them is the owner's.
      expect(monthTotal("2026-01")).toBe(-(1_500_00 + 2_777_67 + 2_777_67));
      expect(balanceNow()).toBe(OPENING_MINOR - (1_500_00 + 2_500_00) - 2_777_67 * 2);
    });

    /**
     * An empty cell is not a statement of zero.
     *
     * A month the sheet has reached in its other columns may still have the
     * card column blank — the current month, before the statement arrives. The
     * instalments due in it are not cancelled by that blank: treating it as a
     * figure of zero wrote a negative correction the size of the whole
     * schedule, while the months after it, blank in EVERY column, showed
     * theirs. Same fact, opposite answers, one month apart.
     */
    it("leaves a blank cell's instalments alone in a month the sheet otherwise states", async () => {
      const blankCell = (): ParsedSheet => {
        const base = planSheet();
        return {
          ...base,
          cells: base.cells.map((row, index) => [
            ...row.slice(0, -1),
            { ...row.at(-1)!, valueMinor: index === 0 ? null : 2_777_67 },
          ]),
        };
      };
      await importSheets(USER, { ...planRequest({ [CARD]: { statementDay: 25, dueDay: 10 } }), sheets: [blankCell()] });

      // January's own instalment, and nothing taken back out of it.
      expect(monthTotal("2026-01")).toBe(-(1_500_00 + 2_777_67));
      const remainders = harness.db!
        .prepare(`SELECT COUNT(*) n FROM transactions WHERE user_id = ? AND note = ? AND deleted_at IS NULL`)
        .get(USER, tr.importer.columnRemainder) as { n: number };
      expect(remainders.n).toBe(0);
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

  /**
   * A workbook kept by hand does not chain across its own sheets: the owner
   * reconciles against the bank and types what was really there. Carrying our
   * own sum across that point reproduces the drift they had already corrected,
   * in a ledger that then disagrees with every balance in the file from there
   * on — measured at 24.592,14 out by Ağustos 2022 and 37.416,25 by 2024.
   */
  it("restates the balance where the workbook restarts its own", async () => {
    const second: ParsedSheet = {
      ...sheet(),
      sheetName: "2026-2",
      months: ["2026-03"],
      // 1.000,00 spent, and the sheet says the month opened on 500,00 — which
      // the two months before it do not add up to.
      cells: [[money(1_000_00), money(500_00)]],
    };
    await importSheets(USER, { ...request("replace"), sheets: [sheet(), second] });

    const adjustments = harness.db!
      .prepare(`SELECT date, amount_minor FROM balance_adjustments WHERE user_id = ? AND deleted_at IS NULL`)
      .all(USER) as { date: string; amount_minor: number }[];
    // 10.000,00 − 1.500,00 − 2.500,00 = 6.000,00 at the end of February; the
    // sheet says March opened on 500,00, so 5.500,00 is taken back out.
    expect(adjustments).toEqual([{ date: "2026-02-28", amount_minor: -5_500_00 }]);
    // Nothing to restate when the sheets chain: the balance is the balance.
    expect(balanceNow()).toBe(500_00 - 1_000_00);
  });

  /**
   * Re-importing the same workbook converges, restatements included.
   *
   * The second run moves no anchor — it is already this workbook's — and the
   * corrections used to be written only by a run that DID move one. Replace
   * mode had meanwhile tombstoned the first run's, so every second import
   * silently handed back the drift the file had already corrected.
   */
  it("keeps the restatement when the same workbook is imported again", async () => {
    const second: ParsedSheet = { ...sheet(), sheetName: "2026-2", months: ["2026-03"], cells: [[money(1_000_00), money(500_00)]] };
    const both = { ...request("replace"), sheets: [sheet(), second] };
    await importSheets(USER, both);
    const first = balanceNow();

    await importSheets(USER, both);

    const adjustments = harness.db!
      .prepare(`SELECT date, amount_minor FROM balance_adjustments WHERE user_id = ? AND deleted_at IS NULL`)
      .all(USER) as { date: string; amount_minor: number }[];
    expect(adjustments).toEqual([{ date: "2026-02-28", amount_minor: -5_500_00 }]);
    expect(balanceNow()).toBe(first);
  });

  /** An earlier workbook may move the anchor back; a later one may not. */
  it("moves the anchor only when the workbook genuinely starts earlier", async () => {
    await importSheets(USER, request("replace"));
    const earlier: ParsedSheet = {
      ...sheet(),
      sheetName: "2025",
      year: 2025,
      months: ["2025-12"],
      cells: [[money(100_00), money(5_000_00)]],
    };
    await importSheets(USER, { ...request("add"), sheets: [earlier] });
    expect(setting("start_month")).toBe("2025-12");
    expect(setting("opening_balance_minor")).toBe(5_000_00);

    const later: ParsedSheet = sheet();
    await importSheets(USER, { ...request("add"), sheets: [later] });
    expect(setting("start_month")).toBe("2025-12");
    expect(setting("opening_balance_minor")).toBe(5_000_00);
  });

  /**
   * History reaching back before the anchor brings the anchor with it, whether
   * or not the workbook names an opening figure.
   *
   * The balance is the opening plus every row, with no regard for whether a row
   * predates the anchor — so leaving the anchor where it was adds the whole
   * imported history on top of a figure that described a later moment. Measured
   * on the owner's file: a first run that opened at 50.000,00 for Eylül 2026 and
   * then imported from Ağustos 2021 read 70.953,72 where the same workbook into
   * an empty workspace read −16.462,53.
   */
  it("moves the anchor back even when the workbook states no opening figure", async () => {
    await setOpeningBalance(USER, "2026-06", 50_000_00);
    const noOpeningColumn = (): ParsedSheet => {
      const base = sheet();
      return {
        ...base,
        columns: base.columns.slice(0, 1),
        cells: base.cells.map((row) => row.slice(0, 1)),
        skippedColumns: [],
        openingColumn: null,
        openingCandidates: [],
      };
    };
    await importSheets(USER, { ...request("replace"), sheets: [noOpeningColumn()], excludedLabels: [] });

    expect(setting("start_month")).toBe("2026-01");
    expect(setting("opening_balance_minor")).toBe(0);
    expect(balanceNow()).toBe(-(1_500_00 + 2_500_00));
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
  const anchorSheet = (year: number, minor: number | null): ParsedSheet => ({
    sheetName: String(year),
    year,
    months: [`${year}-01` as MonthKey],
    columns: [{ label: OPENING_LABEL, kindGuess: "expense", isInvestment: false, balanceLike: true, dueDay: null }],
    cells: [[money(minor)]],
    skippedColumns: [OPENING_LABEL],
    openingColumn: OPENING_LABEL,
    openingCandidates: [],
  });

  it("reads the opening cell of the earliest month being imported", () => {
    expect(openingBalanceFromSheets([anchorSheet(2026, 500_00), anchorSheet(2025, 300_00)]))
      .toEqual({ month: "2025-01", minor: 300_00 });
    // A year the owner did not select cannot move the anchor.
    expect(openingBalanceFromSheets([anchorSheet(2026, 500_00), anchorSheet(2025, 300_00)], (year) => year === 2026))
      .toEqual({ month: "2026-01", minor: 500_00 });
    expect(openingBalanceFromSheets([])).toBeNull();
  });

  /**
   * The first month opens at zero when nothing states otherwise, and the
   * anchor still lands ON it.
   *
   * A workbook whose earliest year has no opening column — the owner's 2021
   * sheet is exactly that — used to anchor at the first year that DID carry
   * one, and the chain then back-computed the years before it and opened them
   * thousands in the red. Where the data starts is where the ledger starts.
   */
  it("anchors at the earliest month even when no column states a figure there", () => {
    expect(openingBalanceFromSheets([{ ...anchorSheet(2026, null), openingColumn: null }]))
      .toEqual({ month: "2026-01", minor: null });
    expect(openingBalanceFromSheets([anchorSheet(2026, null)]))
      .toEqual({ month: "2026-01", minor: null });
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
      columns: [
        { label: "Ay Başı", kindGuess: "expense", isInvestment: false, balanceLike: true, dueDay: null },
        { label: "Toplam", kindGuess: "expense", isInvestment: false, balanceLike: true, dueDay: null },
      ],
      cells: [[money(100_00), money(900_00)]],
      skippedColumns: ["Ay Başı", "Toplam"],
      openingColumn: "Ay Başı",
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
     * A named column that is not in the workbook opens at zero rather than
     * falling back to the heading rule: a person who answered the question
     * must not be quietly overruled by the guess they were correcting. The
     * anchor MONTH is still where the data starts — that part is not a guess.
     */
    it("refuses to fall back to the guess it was correcting", () => {
      expect(openingBalanceFromSheets([sheet(2026)], () => true, "Devreden"))
        .toEqual({ month: "2026-01", minor: null });
    });

    it("goes back to the heading rule when no column was named", () => {
      expect(openingBalanceFromSheets([sheet(2026)], () => true, null))
        .toEqual({ month: "2026-01", minor: 100_00 });
    });
  });
});
