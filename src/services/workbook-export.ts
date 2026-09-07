/**
 * The Helix workbook, written.
 *
 * `domain/workbook-format.ts` owns WHAT a row looks like on a sheet; this file
 * owns how those rows become bytes. It takes rows rather than a user id and
 * imports neither SQLite nor `react-native`, so the whole module runs in the
 * plain node test environment — which is what lets `tests/workbook-roundtrip`
 * prove the format against real `.xlsx` bytes rather than against a mock.
 * `export-import.ts` reads the rows and owns the file system.
 *
 * `xlsx` is imported dynamically for the same reason `spreadsheet-import` does
 * it: the module is large, and a person who never exports must not pay for it
 * in startup JS.
 */
import { UserFacingError } from "../domain/user-error";
import { tr } from "../i18n/tr";
import { writeMoney } from "../domain/workbook-format";
import {
  WORKBOOK_COLUMNS,
  WORKBOOK_SHEETS,
  type InvestmentRow,
  type SubscriptionRow,
  type WorkbookColumn,
} from "../domain/workbook-format";

/** The MIME every platform agrees names an `.xlsx`. */
export const WORKBOOK_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * How many data rows one workbook may carry, across all three sheets.
 *
 * The JSON backup has had a cap since it was written and this did not, which
 * is the kind of asymmetry that stays invisible until someone with eight years
 * of ledger presses the button. A workbook is worse than the backup there:
 * every cell becomes a JavaScript string, three passes run over the grid, and
 * SheetJS holds the whole book before a byte is written.
 *
 * Excel's own sheet limit is 1,048,576 rows, so this is not the format's
 * ceiling — it is the point past which the phone is the thing that breaks. It
 * is a quarter of `MAX_BACKUP_ROWS` on purpose: the backup streams a table at
 * a time under a byte cap and this cannot.
 *
 * The number is measured rather than guessed. A ledger row with a unique note
 * — the worst case, since unique strings cannot share the file's string table
 * — costs about 0.64 MB per thousand rows and a second per thirty thousand on
 * a laptop. 25,000 therefore lands near the backup's own 15 MB ceiling, which
 * is the largest file this app already asks a phone to hold.
 */
const MAX_WORKBOOK_ROWS = 25_000;

/** Header row plus one cell per column, in the order the contract declares. */
function sheetOf<Row>(columns: WorkbookColumn<Row>[], rows: readonly Row[]): string[][] {
  return [columns.map((column) => column.header), ...rows.map((row) => columns.map((column) => column.write(row)))];
}

/**
 * How wide a column is drawn, in characters.
 *
 * Sized to the widest thing IN it rather than to its heading, because a sheet
 * whose amounts open as `####` is not a table anyone can read, and a heading
 * is usually shorter than the money under it. Bounded at both ends: below the
 * floor a column is unclickable, and above the ceiling one long note pushes
 * every other column off the screen.
 */
const MIN_COL = 11;
const MAX_COL = 46;

function widthsOf(grid: readonly (readonly string[])[]): { wch: number }[] {
  const widths: number[] = [];
  for (const row of grid) {
    for (const [index, cell] of row.entries()) {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    }
  }
  return widths.map((width) => ({ wch: Math.min(MAX_COL, Math.max(MIN_COL, width + 2)) }));
}

/**
 * One grid as a sheet Excel treats as a table.
 *
 * Cell styling is a paid SheetJS feature and this is the community build, so a
 * bold header is not available — measured, not assumed: `!cols` and
 * `!autofilter` reach the file, `!freeze` and per-cell `s` do not. The filter
 * is what actually earns the "table" feeling, because Excel draws the header
 * row with dropdowns and treats the block below as one region to sort. Widths
 * do the rest.
 *
 * Every cell is written as TEXT on purpose — see `workbook-format.ts` on why
 * money and dates must not become Excel numbers. That needs no code here:
 * `WorkbookCell` is a string, `aoa_to_sheet` types a JS string as text
 * whatever it looks like (measured: "500" and "1234,56" both come out `t:"s"`),
 * and `tests/workbook-roundtrip` asserts it on the written file. A loop that
 * re-stamped every cell was removed once that was checked rather than assumed
 * — it was a full extra pass over the grid for a guarantee the type system and
 * the test already give.
 */
function toSheet(xlsx: typeof import("xlsx"), grid: string[][]): import("xlsx").WorkSheet {
  const sheet = xlsx.utils.aoa_to_sheet(grid);
  sheet["!cols"] = widthsOf(grid);
  const columns = grid[0]?.length ?? 0;
  if (columns > 0 && grid.length > 1) {
    sheet["!autofilter"] = { ref: xlsx.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: grid.length - 1, c: columns - 1 } }) };
  }
  return sheet;
}

async function writeWorkbook(sheets: [name: string, grid: string[][]][]): Promise<Uint8Array<ArrayBuffer>> {
  const xlsx = await import("xlsx");
  const book = xlsx.utils.book_new();
  // A named workbook rather than an anonymous one: the owner sees this in
  // Excel's properties and in a file manager's preview.
  book.Props = { Title: "Helix", Application: "Helix" };
  for (const [name, grid] of sheets) xlsx.utils.book_append_sheet(book, toSheet(xlsx, grid), name);
  return new Uint8Array(xlsx.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer);
}

/**
 * The owner's whole workspace: a year of Mali Tablo per sheet, then the two
 * records.
 *
 * The ledger arrives as grids rather than rows because the import wizard reads
 * a month grid — see `ledgerGridsByYear`. One sheet per year, named by the
 * year, because a sheet carries ONE dominant year and two years in one sheet
 * would be assigned to whichever had more months.
 */
export async function composeWorkbook(rows: {
  years: readonly [year: number, grid: string[][]][];
  subscriptions: readonly SubscriptionRow[];
  investments: readonly InvestmentRow[];
}): Promise<Uint8Array<ArrayBuffer>> {
  const ledgerRows = rows.years.reduce((sum, [, grid]) => sum + Math.max(0, grid.length - 1), 0);
  const total = ledgerRows + rows.subscriptions.length + rows.investments.length;
  if (total > MAX_WORKBOOK_ROWS) throw new UserFacingError(tr.errors.workbookTooLarge);
  return writeWorkbook([
    ...rows.years.map(([year, grid]) => [`${WORKBOOK_SHEETS.ledger} ${year}`, grid] as [string, string[][]]),
    [WORKBOOK_SHEETS.subscriptions, sheetOf(WORKBOOK_COLUMNS.subscriptions, rows.subscriptions)],
    [WORKBOOK_SHEETS.investments, sheetOf(WORKBOOK_COLUMNS.investments, rows.investments)],
  ]);
}

/**
 * A blank budget year, in the ONE shape the import wizard can read.
 *
 * This was three sheets of transaction rows, and it did not import: the wizard
 * parses a month GRID — months down the first column, item names on the header
 * row above them, an amount where the two meet — and it answered the template
 * with "Ay adlarını bulamadık", which is the correct answer to a file that has
 * no months in it. A template the importer refuses is worse than no template,
 * because it teaches a shape the app rejects.
 *
 * So the template is now the wizard's own format, and `tests/workbook-roundtrip`
 * proves it by running the generated bytes back through `parseWorkbookBytes`.
 * That test is the whole point of this function existing rather than a file
 * checked into the repository: a template nobody re-parses drifts the first
 * time the parser is touched.
 *
 * ONE sheet, deliberately. Every extra sheet is another thing the wizard reports
 * as unreadable, and the owner's verdict on the previous version was that it was
 * too complex for anyone but its author.
 *
 * The export (`composeWorkbook`) is a different file with a different job: a
 * readable record of everything, which the wizard does not read back. The two
 * are not the same document and pretending otherwise is what produced a
 * template that could not be imported.
 */
const TEMPLATE_YEAR = 2026;

/** The columns a household actually keeps, in the order one is usually kept. */
const TEMPLATE_ITEMS: [label: string, amounts: (number | null)[]][] = [
  ["Maaş", [65000, 65000, 65000, 68000, 68000, 68000, 68000, 68000, 72000, 72000, 72000, 72000]],
  ["Ek Gelir", [null, 4500, null, null, 3200, null, null, 5000, null, null, 2800, null]],
  ["Kira", [18000, 18000, 18000, 18000, 18000, 18000, 19500, 19500, 19500, 19500, 19500, 19500]],
  ["Market", [9200, 8800, 9600, 10100, 9400, 9900, 10400, 10800, 10200, 9800, 10500, 12000]],
  ["Faturalar", [3100, 3400, 2900, 2400, 2100, 2300, 2800, 3000, 2600, 2500, 2900, 3300]],
  ["Ulaşım", [2200, 2200, 2400, 2400, 2500, 2500, 2600, 2600, 2700, 2700, 2800, 2800]],
  ["Abonelikler", [850, 850, 850, 850, 900, 900, 900, 900, 900, 950, 950, 950]],
];

export async function buildTemplateBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const months = tr.months.map((name) => `${name} ${TEMPLATE_YEAR}`);
  const grid: string[][] = [
    // The corner cell is empty on purpose: the wizard reads the header row
    // above the months, and a label there would become an eighth item column.
    ["", ...TEMPLATE_ITEMS.map(([label]) => label)],
    ...months.map((month, index) => [
      month,
      ...TEMPLATE_ITEMS.map(([, amounts]) => {
        const amount = amounts[index];
        return amount == null ? "" : writeMoney(amount * 100);
      }),
    ]),
  ];
  return writeWorkbook([[String(TEMPLATE_YEAR), grid]]);
}
