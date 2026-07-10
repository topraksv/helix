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

import * as XLSX from "xlsx";
import { tr } from "../i18n/tr";
import type { MonthKey } from "../domain/dates";
import { yearOf } from "../domain/dates";
import { roundHalfAwayFromZero, type Minor } from "../domain/money";

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

export interface ParsedColumn {
  label: string;
  kindGuess: "expense" | "income";
  isInvestment: boolean;
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

/** "Ocak 2025" | "Oca 25" | "2025-01" | "01.2025" | Date → "2025-01" | null */
export function parseMonthLabel(value: unknown): MonthKey | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
  }
  const s = String(value ?? "").trim().toLocaleLowerCase("tr-TR");
  if (s === "") return null;
  let m = /^(\d{4})[-/.](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}`;
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return `${m[2]}-${String(Number(m[1])).padStart(2, "0")}`;
  // "2025 Ocak" | "Ocak 2025" | "Oca'25" — a month name with a nearby year.
  const nameMatch = /([a-zçğıöşü]{3,})/.exec(s);
  const yearMatch = /(\d{2,4})/.exec(s);
  if (nameMatch && yearMatch) {
    const name = nameMatch[1];
    let idx = MONTH_NAMES.indexOf(name);
    if (idx < 0) idx = MONTH_ABBR.indexOf(name.slice(0, 3));
    if (idx >= 0) {
      const raw = yearMatch[1];
      const year = Number(raw.length === 2 ? `20${raw}` : raw);
      return `${year}-${String(idx + 1).padStart(2, "0")}`;
    }
  }
  return null;
}

/** Spreadsheet cell → minor units. Accepts numbers and TR/EN formatted text. */
export function parseSheetAmount(value: unknown): Minor | null {
  if (typeof value === "number" && Number.isFinite(value)) return roundHalfAwayFromZero(value * 100);
  const s = String(value ?? "").replace(/[₺\s]/g, "");
  if (s === "" || s === "-") return null;
  // TR "1.234,56" or EN "1,234.56" or plain "1234.56"
  const trLike = /^-?\d{1,3}(\.\d{3})*(,\d{1,2})?$|^-?\d+(,\d{1,2})?$/.test(s);
  const normalized = trLike ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const num = Number(normalized);
  return Number.isFinite(num) ? roundHalfAwayFromZero(num * 100) : null;
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
  return terms.map((t) => roundHalfAwayFromZero(Number(t) * 100));
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
      const amount = m ? parseSheetAmount(m[2]) : null;
      return amount != null ? { label: m![1].trim(), amountMinor: amount } : { label: line, amountMinor: null };
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
  if (grid.length < 2) return fail(tr.importer.reasonTooSmall);

  const firstColMonths = grid.filter((r) => parseMonthLabel(r[0]?.v) != null).length;
  const firstRowMonths = (grid[0] ?? []).filter((c) => parseMonthLabel(c?.v) != null).length;
  const normalized = firstRowMonths > firstColMonths ? transpose(grid) : grid;

  const firstMonthRow = normalized.findIndex((r) => parseMonthLabel(r[0]?.v) != null);
  if (firstMonthRow < 1) return fail(tr.importer.reasonNoMonths); // need a header row above

  // Contiguous month block: stop at the first blank / non-month row.
  let endRow = firstMonthRow;
  while (endRow < normalized.length && !rowIsBlank(normalized[endRow]) && parseMonthLabel(normalized[endRow][0]?.v) != null) {
    endRow++;
  }
  const body = normalized.slice(firstMonthRow, endRow);
  const headerRow = normalized[firstMonthRow - 1] ?? [];
  const header = headerRow.slice(1).map((c) => String(c?.v ?? "").trim());
  if (body.length === 0 || header.every((h) => h === "")) return fail(tr.importer.reasonNoColumns);

  const months = body.map((r) => parseMonthLabel(r[0]?.v)!);

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

  const columns: ParsedColumn[] = keepIdx.map((i) => ({
    label: header[i],
    kindGuess: INCOME_HINTS.test(header[i]) ? "income" : "expense",
    isInvestment: INVESTMENT_HINTS.test(header[i]),
  }));
  const cells: CellData[][] = body.map((r) => keepIdx.map((i) => toCellData(r[i + 1])));

  let openingBalance: ParsedSheet["openingBalance"] = null;
  if (openingColIdx >= 0) {
    const minor = parseSheetAmount(body[0]?.[openingColIdx + 1]?.v);
    if (minor != null) openingBalance = { month: months[0], minor };
  }

  return {
    sheetName,
    year: yearOf(months[0]),
    months,
    columns,
    cells,
    skippedColumns,
    openingBalance,
  };
}

export interface ImportItem {
  amountMinor: Minor;
  note: string | null;
  /** true = one opaque monthly total; false = a real itemized part. */
  isAggregate: boolean;
}
export interface CellPlan {
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
    return { items: fp.map((amt, i) => ({ amountMinor: amt, note: cp[i].label || null, isAggregate: false })), cellNote: null };
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

/** Convert a SheetJS worksheet into a dense grid of RawCells over its range. */
export function worksheetToRawGrid(ws: XLSX.WorkSheet): RawCell[][] {
  const ref = ws["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const grid: RawCell[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: RawCell[] = [];
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: col })] as
        | { v?: unknown; f?: string; c?: { t?: string }[] }
        | undefined;
      row.push(cell ? { v: cell.v ?? null, f: cell.f, c: cell.c } : { v: null });
    }
    grid.push(row);
  }
  return grid;
}

/** Parse every sheet in a workbook; unparseable sheets are reported, not dropped. */
export function parseWorkbook(wb: XLSX.WorkBook): ParsedWorkbook {
  const sheets: ParsedSheet[] = [];
  const unparsed: UnparsedSheet[] = [];
  for (const name of wb.SheetNames) {
    const result = parseSheet(worksheetToRawGrid(wb.Sheets[name]), name);
    if ("year" in result) sheets.push(result);
    else unparsed.push(result);
  }
  return { sheets, unparsed };
}

/** Decode uploaded bytes (xlsx/xlsm/csv/ods) and parse all sheets. */
export function parseWorkbookBytes(data: Uint8Array): ParsedWorkbook {
  const wb = XLSX.read(data, { type: "array", cellDates: true, cellFormula: true, sheetStubs: true });
  return parseWorkbook(wb);
}
