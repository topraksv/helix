/**
 * Spreadsheet (xlsx/xlsm/csv/ods) import: parses the user's historical budget
 * workbook into month × category aggregates that flow straight into the Mali
 * Tablo. Every sheet is parsed independently (one sheet per year is common), so
 * different years keep their own column sets. Pure parsing/mapping lives here
 * (unit-testable); the wizard screen only renders the preview and confirms.
 *
 * Rich cells: besides the computed value we capture the cell's *formula* (to
 * split a literal sum like "=500+300+700" into separate line items) and its
 * *comment* (to label those items or annotate the cell). Reading is cell-by-cell
 * over the sheet range so formulas (`.f`) and comments (`.c`) survive — SheetJS'
 * `sheet_to_json` would drop both.
 */

import type * as XLSXTypes from "xlsx";
import { tr } from "../i18n/tr";
import type { MonthKey } from "../domain/dates";
import { addMonthsToKey, yearOf } from "../domain/dates";
import { isSupportedMinorAmount, roundHalfAwayFromZero, type Minor } from "../domain/money";

export const MAX_WORKBOOK_BYTES = 15 * 1024 * 1024;
const MAX_WORKBOOK_SHEETS = 100;
const MAX_WORKBOOK_ROWS_PER_SHEET = 20_000;
const MAX_WORKBOOK_COLUMNS_PER_SHEET = 500;
const MAX_WORKBOOK_CELLS = 750_000;
const MAX_CELL_TEXT_LENGTH = 20_000;
const MAX_ZIP_ENTRIES = 2_048;
const MAX_ZIP_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_RATIO = 200;

type XlsxModule = typeof import("xlsx");

/** One spreadsheet cell, with its value plus any formula/comment metadata. */
export interface CellData {
  /** Computed value in minor units (null = empty). Includes negatives. */
  valueMinor: Minor | null;
  /** Literal-only formula ("500+300+700") split into signed parts; else null. */
  formulaParts: Minor[] | null;
  /** Full comment text (joined), or null. */
  comment: string | null;
  /** Comment lines parsed into "label (+ optional amount)"; null if no comment. */
  commentParts: { label: string; amountMinor: Minor | null }[] | null;
}

interface ParsedColumn {
  label: string;
  kindGuess: "expense" | "income";
  isInvestment: boolean;
  /** Payment day pulled off the header ("Elektrik 06" → 6); null if none. Used
   *  to place the month's row on its real due day instead of a flat 15th. */
  dueDay: number | null;
}

export interface ParsedSheet {
  sheetName: string;
  /** Dominant year of the month block (drives per-year column membership). */
  year: number;
  months: MonthKey[];
  columns: ParsedColumn[];
  /** cells[monthIndex][columnIndex]. */
  cells: CellData[][];
  /** Balance/derived column labels that were detected and skipped. */
  skippedColumns: string[];
  /** Earliest month's opening-balance cell ("Ay Başında Eldeki Para"), if any. */
  openingBalance: { month: MonthKey; minor: Minor } | null;
}

export interface UnparsedSheet {
  sheetName: string;
  reason: string;
}

export interface ParsedWorkbook {
  sheets: ParsedSheet[];
  unparsed: UnparsedSheet[];
  /** Card/section names the workbook marks "ℹ️ informational — not in totals"
   *  (e.g. a family member's card). Their installments are tracked but excluded
   *  from the ledger so they don't wrongly hit the balance. */
  informationalCards: string[];
}

/** Minimal cell shape mirroring SheetJS ({ v: value, f: formula, c: comments }). */
export interface RawCell {
  v: unknown;
  f?: string;
  c?: { t?: string }[];
}

const MONTH_NAMES = tr.months.map((m) => m.toLocaleLowerCase("tr-TR"));
const MONTH_ABBR = MONTH_NAMES.map((m) => m.slice(0, 3));

// `\bnet\b` so "İnternet Abonelikleri" is NOT mistaken for a balance column.
const BALANCE_HINTS = /bakiye|devir|kalan|toplam|\bnet\b|eldeki|ay ba[sş]|birikim/i;
const OPENING_HINTS = /ay ba[sş]|eldeki|devir|a[çc][ıi]l[ıi][sş]/i;
const INCOME_HINTS = /maa[sş]|gelir|prim|kira geliri|burs|ek gelir/i;
const INVESTMENT_HINTS = /yat[ıi]r[ıi]m/i;

/**
 * Pull a trailing payment day (or a range → its deadline) off a column header:
 *   "Elektrik 06"        → { label: "Elektrik", dueDay: 6 }
 *   "Kira 05-15"         → { label: "Kira", dueDay: 15 }
 *   "Abonelik (15-20)"   → { label: "Abonelik", dueDay: 20 }
 *   "Ev Kredisi"         → unchanged, dueDay null
 * Conservative: only fires when the number is a valid day (1–31) AND the
 * remaining label still contains a letter, so a label that merely ends in a
 * number is never mangled.
 */
export function extractDueDay(label: string): { label: string; dueDay: number | null } {
  const trimmed = label.trim();
  const hasLetter = (s: string) => /[a-zçğıöşü]/i.test(s);
  // range "05-15" / "(15-20)" → the later day is the deadline
  let m = /^(.+?)\s+\(?(\d{1,2})\s*[-–]\s*(\d{1,2})\)?$/.exec(trimmed);
  if (m) {
    const [, rawLabel, rawA, rawB] = m;
    const a = Number(rawA);
    const b = Number(rawB);
    if (rawLabel && rawA && rawB && a >= 1 && a <= 31 && b >= 1 && b <= 31 && hasLetter(rawLabel)) {
      return { label: rawLabel.trim(), dueDay: Math.max(a, b) };
    }
  }
  // single trailing day, optionally parenthesised
  m = /^(.+?)\s+\(?(\d{1,2})\)?$/.exec(trimmed);
  if (m) {
    const [, rawLabel, rawDay] = m;
    const day = Number(rawDay);
    if (rawLabel && rawDay && day >= 1 && day <= 31 && hasLetter(rawLabel)) {
      return { label: rawLabel.trim(), dueDay: day };
    }
  }
  return { label: trimmed, dueDay: null };
}

/** "Ocak 2025" | "Oca 25" | "2025-01" | "01.2025" | Date → "2025-01" | null */
export function parseMonthLabel(value: unknown): MonthKey | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
  }
  const s = String(value ?? "").trim().toLocaleLowerCase("tr-TR");
  if (s === "") return null;
  let m = /^(\d{4})[-/.](\d{1,2})$/.exec(s);
  if (m?.[1] && m[2] && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}`;
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m?.[1] && m[2] && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${String(Number(m[1])).padStart(2, "0")}`;
  // "2025 Ocak" | "Ocak 2025" | "Oca'25" — a month name with a nearby year.
  const nameMatch = /([a-zçğıöşü]{3,})/.exec(s);
  const yearMatch = /(\d{2,4})/.exec(s);
  if (nameMatch && yearMatch) {
    const name = nameMatch[1];
    const raw = yearMatch[1];
    if (!name || !raw) return null;
    let idx = MONTH_NAMES.indexOf(name);
    if (idx < 0) idx = MONTH_ABBR.indexOf(name.slice(0, 3));
    if (idx >= 0) {
      const year = Number(raw.length === 2 ? `20${raw}` : raw);
      return `${year}-${String(idx + 1).padStart(2, "0")}`;
    }
  }
  return null;
}

/** Spreadsheet cell → minor units. Accepts numbers and TR/EN formatted text. */
export function parseSheetAmount(value: unknown): Minor | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const minor = roundHalfAwayFromZero(value * 100);
    return isSupportedMinorAmount(minor) ? minor : null;
  }
  const s = String(value ?? "").replace(/[₺\s]/g, "");
  if (s === "" || s === "-") return null;
  // TR "1.234,56" or EN "1,234.56" or plain "1234.56"
  const trLike = /^-?\d{1,3}(\.\d{3})*(,\d{1,2})?$|^-?\d+(,\d{1,2})?$/.test(s);
  const normalized = trLike ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const num = Number(normalized);
  const minor = Number.isFinite(num) ? roundHalfAwayFromZero(num * 100) : Number.NaN;
  return isSupportedMinorAmount(minor) ? minor : null;
}

/**
 * Split a stored formula into signed literal parts, e.g. "500+300+700" →
 * [50000, 30000, 70000]. Stored xlsx formulas are locale-independent (decimal
 * dot), so we parse with dots. Returns null if the formula references any cell,
 * calls a function, or is otherwise not a pure literal sum — in that case the
 * caller keeps the single computed value (still faithful to the total).
 */
export function parseFormulaLiterals(formula: string): Minor[] | null {
  const compact = formula.replace(/\s/g, "").replace(/^=/, "");
  if (compact === "") return null;
  if (!/^[+-]?\d+(\.\d+)?([+-]\d+(\.\d+)?)+$/.test(compact)) return null; // needs 2+ terms, digits/dots only
  const terms = compact.match(/[+-]?\d+(?:\.\d+)?/g);
  if (!terms) return null;
  const minors = terms.map((t) => roundHalfAwayFromZero(Number(t) * 100));
  return minors.every((minor) => isSupportedMinorAmount(minor)) ? minors : null;
}

function commentText(c?: { t?: string }[]): string | null {
  if (!c || c.length === 0) return null;
  const text = c.map((x) => x?.t ?? "").join("\n").trim();
  return text === "" ? null : text;
}

/** "Ocak Kira Geliri 12.000" → { label: "Ocak Kira Geliri", amountMinor: 1200000 }. */
function parseCommentParts(comment: string): { label: string; amountMinor: Minor | null }[] {
  return comment
    .split(/[\n;]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^(.*\S)[\s:=]+([₺]?\s*-?\d[\d.,]*)\s*(?:tl|₺)?$/i.exec(line);
      const label = m?.[1];
      const amount = m?.[2] ? parseSheetAmount(m[2]) : null;
      return amount != null && label ? { label: label.trim(), amountMinor: amount } : { label: line, amountMinor: null };
    });
}

function toCellData(cell: RawCell | undefined): CellData {
  const comment = commentText(cell?.c);
  return {
    valueMinor: parseSheetAmount(cell?.v),
    formulaParts: cell?.f ? parseFormulaLiterals(cell.f) : null,
    comment,
    commentParts: comment ? parseCommentParts(comment) : null,
  };
}

function transpose(grid: RawCell[][]): RawCell[][] {
  const cols = Math.max(0, ...grid.map((r) => r.length));
  return Array.from({ length: cols }, (_, c) => grid.map((r) => r[c] ?? { v: null }));
}

function rowIsBlank(row: RawCell[]): boolean {
  return row.every((cell) => cell?.v == null || String(cell.v).trim() === "");
}

/**
 * Parse one sheet's raw grid into a month × category block. Months may be down
 * the first column or across the header row; the block is the *contiguous* run
 * of month rows starting at the first one (so a trailing summary table below a
 * blank row is excluded), with the header taken from the row just above it.
 */
export function parseSheet(grid: RawCell[][], sheetName: string): ParsedSheet | UnparsedSheet {
  const fail = (reason: string): UnparsedSheet => ({ sheetName, reason });
  // An "Yatırım" (investment) sheet holds holdings/quantities ("24gr altın",
  // "760$"), not income/expense rows. Parsing it as a ledger produces junk
  // columns ("Altın", "*Üstteki tabloda…*") and inflates a year's month count.
  // It is skipped here; investments get their own home later.
  if (/^\s*yat[ıi]r[ıi]m/i.test(sheetName)) return fail(tr.importer.reasonInvestmentSheet);
  if (grid.length < 2) return fail(tr.importer.reasonTooSmall);

  const firstColMonths = grid.filter((r) => parseMonthLabel(r[0]?.v) != null).length;
  const firstRowMonths = (grid[0] ?? []).filter((c) => parseMonthLabel(c?.v) != null).length;
  const normalized = firstRowMonths > firstColMonths ? transpose(grid) : grid;

  const firstMonthRow = normalized.findIndex((r) => parseMonthLabel(r[0]?.v) != null);
  if (firstMonthRow < 1) return fail(tr.importer.reasonNoMonths); // need a header row above

  // Contiguous month block: stop at the first blank / non-month row.
  let endRow = firstMonthRow;
  while (endRow < normalized.length) {
    const row = normalized[endRow];
    if (!row || rowIsBlank(row) || parseMonthLabel(row[0]?.v) == null) break;
    endRow++;
  }
  const body = normalized.slice(firstMonthRow, endRow);
  const headerRow = normalized[firstMonthRow - 1] ?? [];
  const header = headerRow.slice(1).map((c) => String(c?.v ?? "").trim());
  if (body.length === 0 || header.every((h) => h === "")) return fail(tr.importer.reasonNoColumns);

  const parsedMonths = body.map((r) => parseMonthLabel(r[0]?.v));
  if (parsedMonths.some((month) => month == null)) return fail(tr.importer.reasonNoMonths);
  const months = parsedMonths.filter((month): month is MonthKey => month != null);
  const firstMonth = months[0];
  if (!firstMonth) return fail(tr.importer.reasonNoMonths);

  const keepIdx: number[] = [];
  const skippedColumns: string[] = [];
  let openingColIdx = -1;
  header.forEach((label, i) => {
    if (label === "") return;
    if (BALANCE_HINTS.test(label)) {
      skippedColumns.push(label);
      if (openingColIdx < 0 && OPENING_HINTS.test(label)) openingColIdx = i;
    } else {
      keepIdx.push(i);
    }
  });

  const columns: ParsedColumn[] = keepIdx.map((i) => {
    const { label, dueDay } = extractDueDay(header[i] ?? "");
    return {
      label,
      kindGuess: INCOME_HINTS.test(label) ? "income" : "expense",
      isInvestment: INVESTMENT_HINTS.test(label),
      dueDay,
    };
  });
  const cells: CellData[][] = body.map((r) => keepIdx.map((i) => toCellData(r[i + 1])));

  let openingBalance: ParsedSheet["openingBalance"] = null;
  if (openingColIdx >= 0) {
    const minor = parseSheetAmount(body[0]?.[openingColIdx + 1]?.v);
    if (minor != null) openingBalance = { month: firstMonth, minor };
  }

  return {
    sheetName,
    year: yearOf(firstMonth),
    months,
    columns,
    cells,
    skippedColumns,
    openingBalance,
  };
}

interface ImportItem {
  amountMinor: Minor;
  note: string | null;
  /** true = one opaque monthly total; false = a real itemized part. */
  isAggregate: boolean;
}
interface CellPlan {
  items: ImportItem[];
  /** Comment to attach to the (month, category) cell, if it wasn't itemized. */
  cellNote: string | null;
}

/**
 * Decide how one cell becomes ledger rows: split a literal formula and/or a
 * labeled comment into itemized line items, else keep one aggregate total and
 * park any comment on the cell note. Returns null for empty/zero cells.
 */
export function planImportCell(cell: CellData): CellPlan | null {
  const value = cell.valueMinor;
  if (value == null || value === 0) return null;
  const fp = cell.formulaParts;
  const cp = cell.commentParts;
  const labeled = cp && cp.every((p) => p.amountMinor != null) ? cp : null;

  // 1) literal formula whose part count matches the comment lines → labeled items
  if (fp && cp && cp.length === fp.length) {
    return {
      items: fp.map((amt, i) => ({ amountMinor: amt, note: cp[i]?.label || null, isAggregate: false })),
      cellNote: null,
    };
  }
  // 2) literal formula only → itemize (unlabeled); keep any comment as cell note
  if (fp) {
    return { items: fp.map((amt) => ({ amountMinor: amt, note: null, isAggregate: false })), cellNote: cell.comment };
  }
  // 3) labeled comment amounts that reconcile to the value → labeled items
  if (labeled && labeled.reduce((s, p) => s + (p.amountMinor ?? 0), 0) === value) {
    return { items: labeled.map((p) => ({ amountMinor: p.amountMinor!, note: p.label || null, isAggregate: false })), cellNote: null };
  }
  // 4) opaque monthly total → one aggregate row, comment (if any) → cell note
  return { items: [{ amountMinor: value, note: null, isAggregate: true }], cellNote: cell.comment };
}

// --- installment comment parsing -------------------------------------------
// A "…Taksitli…" column can store each month's active card installments in the
// cell COMMENT, grouped by card under a banner line and one line per item:
// "<name>   <monthly amount>   <paid>/<total>". Two banner styles occur — an
// "═══ Card ═══" box and a "----- Card -----" rule — and the paid/total may be
// parenthesised "(6/9)". We reconstruct real installment plans from these so
// they schedule themselves instead of landing as one opaque monthly total.

/** One installment line recovered from a card-grouped comment. */
export interface InstallmentNote {
  /** Card / bank section it sits under (becomes a payment source). "" if none. */
  card: string;
  /** Item label. */
  name: string;
  /** Per-installment (monthly) amount in minor units, always positive. */
  monthlyMinor: Minor;
  /** This month's installment number (1-based) and the plan's total count. */
  paidNo: number;
  total: number;
}

const SECTION_BANNER = /^[═=\-–—_*·•]{2,}\s*(.+?)\s*[═=\-–—_*·•]{2,}$/;
// Trailing "(paid)/(total)" — anchored at the end, parens optional.
const INSTALLMENT_TAIL = /\(?\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*\)?\.?\s*$/;

/**
 * Split a card-grouped installment comment into its individual installment
 * lines. Parsing is done by anchored-tail match + a whitespace split (NOT one
 * greedy regex) — a real workbook has long, irregular comment lines and a
 * backtracking pattern ("<name>\s{2,}<amt>\s+<n>/<m>") caused catastrophic
 * ReDoS on them, hanging the whole import.
 */
export function parseInstallmentComment(comment: string): InstallmentNote[] {
  const notes: InstallmentNote[] = [];
  let card = "";
  for (const raw of comment.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    const sec = SECTION_BANNER.exec(line);
    if (sec?.[1]) {
      card = sec[1].replace(/ℹ️|ℹ/g, "").trim();
      continue;
    }
    const tail = INSTALLMENT_TAIL.exec(line);
    if (!tail) continue;
    const paidNo = Number(tail[1]);
    const total = Number(tail[2]);
    if (!tail[1] || !tail[2]) continue;
    if (total < 1 || total > 600 || paidNo < 1 || paidNo > total) continue;
    // Everything before the "n/m": "<name>  <amount>" — amount is the last token.
    const parts = line.slice(0, tail.index).trim().split(/\s+/);
    if (parts.length < 2) continue;
    const amountToken = parts.at(-1);
    if (!amountToken) continue;
    const amount = parseSheetAmount(amountToken);
    if (amount == null || amount <= 0) continue; // skip refunds/negatives + unparseable
    const name = parts.slice(0, -1).join(" ").trim();
    if (name === "") continue;
    notes.push({ card, name, monthlyMinor: amount, paidNo, total });
  }
  return notes;
}

/** A deduplicated installment plan ready to materialize (card → payment source,
 *  columnLabel → the ledger category it belongs under). */
export interface ImportInstallmentPlanSpec {
  card: string;
  name: string;
  monthlyMinor: Minor;
  total: number;
  startMonth: MonthKey;
  columnLabel: string;
}

/**
 * Reconstruct the distinct installment plans across a workbook's "…Taksitli…"
 * columns. Pure (no DB) so it is thoroughly unit-testable:
 *  - a plan appears once per month it is active → deduped by
 *    (name, monthly, count, start), NOT by card, so a purchase tracked under a
 *    card's renamed forms collapses to one plan instead of double-counting.
 *  - the start month is derived from paid/total and is invariant across mentions.
 *  - the first mention wins the card (earliest processed sheet/month).
 *  - cards flagged informational ("ℹ️ not in totals") are excluded.
 *  - excluded columns and non-selected years are skipped.
 */
export function collectInstallmentPlans(
  sheets: ParsedSheet[],
  opts: { excludedLabels?: string[]; informationalCards?: string[]; yearAllowed?: (y: number) => boolean } = {},
): ImportInstallmentPlanSpec[] {
  const excluded = new Set(opts.excludedLabels ?? []);
  const informational = new Set((opts.informationalCards ?? []).map((n) => n.toLocaleLowerCase("tr-TR")));
  const allow = opts.yearAllowed ?? (() => true);
  const byKey = new Map<string, ImportInstallmentPlanSpec>();
  for (const sheet of sheets) {
    sheet.columns.forEach((col, index) => {
      if (excluded.has(col.label) || !/taksit/i.test(col.label)) return;
      for (const [r, month] of sheet.months.entries()) {
        if (!allow(yearOf(month))) continue;
        const comment = sheet.cells[r]?.[index]?.comment;
        if (!comment) continue;
        for (const note of parseInstallmentComment(comment)) {
          if (!note.card || informational.has(note.card.toLocaleLowerCase("tr-TR"))) continue;
          const startMonth = addMonthsToKey(month, -(note.paidNo - 1));
          const key = `${note.name.toLocaleLowerCase("tr-TR")}|${note.monthlyMinor}|${note.total}|${startMonth}`;
          if (!byKey.has(key)) {
            byKey.set(key, { card: note.card, name: note.name, monthlyMinor: note.monthlyMinor, total: note.total, startMonth, columnLabel: col.label });
          }
        }
      }
    });
  }
  return [...byKey.values()];
}

/** True when a "…Taksitli…" cell carries reconstructable installment lines (so
 *  the importer materializes plans from it instead of one opaque aggregate). */
export function isInstallmentCell(columnLabel: string, comment: string | null): boolean {
  return /taksit/i.test(columnLabel) && comment != null && parseInstallmentComment(comment).length > 0;
}

/** Convert a SheetJS worksheet into a dense grid of RawCells over its range. */
function worksheetToRawGrid(ws: XLSXTypes.WorkSheet, xlsx: XlsxModule): RawCell[][] {
  const ref = ws["!ref"];
  if (!ref) return [];
  const range = xlsx.utils.decode_range(ref);
  const grid: RawCell[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: RawCell[] = [];
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cell = ws[xlsx.utils.encode_cell({ r, c: col })] as
        | { v?: unknown; f?: string; c?: { t?: string }[] }
        | undefined;
      if (
        (typeof cell?.v === "string" && cell.v.length > MAX_CELL_TEXT_LENGTH) ||
        (cell?.f && cell.f.length > MAX_CELL_TEXT_LENGTH) ||
        cell?.c?.some((comment) => (comment.t?.length ?? 0) > MAX_CELL_TEXT_LENGTH)
      ) {
        throw new Error(tr.importer.workbookTooComplex);
      }
      row.push(cell ? { v: cell.v ?? null, f: cell.f, c: cell.c } : { v: null });
    }
    grid.push(row);
  }
  return grid;
}

/** Parse every sheet in a workbook; unparseable sheets are reported, not dropped. */
export function parseWorkbook(wb: XLSXTypes.WorkBook, xlsx: XlsxModule): ParsedWorkbook {
  if (wb.SheetNames.length > MAX_WORKBOOK_SHEETS) throw new Error(tr.importer.workbookTooComplex);
  const sheets: ParsedSheet[] = [];
  const unparsed: UnparsedSheet[] = [];
  const informational = new Set<string>();
  let totalCells = 0;
  for (const name of wb.SheetNames) {
    const worksheet = wb.Sheets[name];
    if (!worksheet) throw new Error(tr.importer.workbookTooComplex);
    const ref = worksheet?.["!fullref"] ?? worksheet?.["!ref"];
    if (ref) {
      const range = xlsx.utils.decode_range(ref);
      const rows = range.e.r - range.s.r + 1;
      const columns = range.e.c - range.s.c + 1;
      totalCells += rows * columns;
      if (
        rows > MAX_WORKBOOK_ROWS_PER_SHEET ||
        columns > MAX_WORKBOOK_COLUMNS_PER_SHEET ||
        totalCells > MAX_WORKBOOK_CELLS
      ) {
        throw new Error(tr.importer.workbookTooComplex);
      }
    }
    const grid = worksheetToRawGrid(worksheet, xlsx);
    for (const row of grid) {
      for (const cell of row) {
        const s = typeof cell?.v === "string" ? cell.v : "";
        if (s.includes("ℹ️") || s.includes("ℹ")) {
          const label = s.replace(/ℹ️|ℹ/g, "").trim();
          if (label) informational.add(label);
        }
      }
    }
    const result = parseSheet(grid, name);
    if ("year" in result) sheets.push(result);
    else unparsed.push(result);
  }
  return { sheets, unparsed, informationalCards: [...informational] };
}

/**
 * Inspect ZIP central-directory sizes before SheetJS inflates OOXML/ODS data.
 * This blocks tiny compressed files that claim hundreds of MB of XML. Legacy
 * binary XLS and CSV are not ZIP containers and continue to the normal parser.
 */
export function validateWorkbookContainer(data: Uint8Array): void {
  if (data.byteLength > MAX_WORKBOOK_BYTES) throw new Error(tr.importer.fileTooLarge);
  if (data.byteLength < 4) return;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50 && view.getUint32(0, true) !== 0x06054b50) return;

  const searchStart = Math.max(0, data.byteLength - 65_557);
  let eocd = -1;
  for (let offset = data.byteLength - 22; offset >= searchStart; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error(tr.importer.workbookTooComplex);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (
    entryCount > MAX_ZIP_ENTRIES ||
    centralOffset + centralSize > eocd ||
    centralOffset + centralSize > data.byteLength
  ) {
    throw new Error(tr.importer.workbookTooComplex);
  }

  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > data.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(tr.importer.workbookTooComplex);
    }
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    totalUncompressed += uncompressed;
    const ratio = compressed === 0 ? (uncompressed === 0 ? 1 : Number.POSITIVE_INFINITY) : uncompressed / compressed;
    if (
      uncompressed > MAX_ZIP_ENTRY_BYTES ||
      totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES ||
      ratio > MAX_ZIP_RATIO
    ) {
      throw new Error(tr.importer.workbookTooComplex);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize) throw new Error(tr.importer.workbookTooComplex);
}

/** Decode uploaded bytes on demand; the heavy XLSX module is not in startup JS. */
export async function parseWorkbookBytes(data: Uint8Array): Promise<ParsedWorkbook> {
  validateWorkbookContainer(data);
  const xlsx = await import("xlsx");
  const workbook = xlsx.read(data, {
    type: "array",
    cellDates: true,
    cellFormula: true,
    sheetStubs: true,
    sheetRows: MAX_WORKBOOK_ROWS_PER_SHEET + 1,
  });
  return parseWorkbook(workbook, xlsx);
}
