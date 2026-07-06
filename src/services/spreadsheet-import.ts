/**
 * Spreadsheet (xlsx/csv) import: parses the user's historical budget sheet
 * into month × category aggregates that flow straight into the Mali Tablo.
 * Pure parsing/mapping lives here (unit-testable); the wizard screen only
 * renders the preview and confirms.
 */

import * as XLSX from "xlsx";
import { tr } from "../i18n/tr";
import type { MonthKey } from "../domain/dates";

export interface ParsedSheet {
  /** Detected orientation after normalization: rows = months. */
  months: MonthKey[];
  columns: { label: string; kindGuess: "expense" | "income" }[];
  /** cells[rowIndex(month)][colIndex(column)] = minor units (null = empty). */
  cells: (number | null)[][];
  /** Column labels that looked like balance/derived fields and were skipped. */
  skippedColumns: string[];
}

const MONTH_NAMES = tr.months.map((m) => m.toLocaleLowerCase("tr-TR"));
const MONTH_ABBR = MONTH_NAMES.map((m) => m.slice(0, 3));

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
  m = /^([a-zçğıöşü]+)\s*['’]?\s*(\d{2,4})$/i.exec(s);
  if (m) {
    const name = m[1];
    let idx = MONTH_NAMES.indexOf(name);
    if (idx < 0) idx = MONTH_ABBR.indexOf(name.slice(0, 3));
    if (idx >= 0) {
      const year = Number(m[2].length === 2 ? `20${m[2]}` : m[2]);
      return `${year}-${String(idx + 1).padStart(2, "0")}`;
    }
  }
  return null;
}

/** Spreadsheet cell → minor units. Accepts numbers and TR/EN formatted text. */
export function parseSheetAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  const s = String(value ?? "").replace(/[₺\s]/g, "");
  if (s === "" || s === "-") return null;
  // TR "1.234,56" or EN "1,234.56" or plain "1234.56"
  const trLike = /^-?\d{1,3}(\.\d{3})*(,\d{1,2})?$|^-?\d+(,\d{1,2})?$/.test(s);
  const normalized = trLike ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const num = Number(normalized);
  return Number.isFinite(num) ? Math.round(num * 100) : null;
}

const BALANCE_HINTS = /bakiye|devir|kalan|toplam|net|eldeki|ay ba[sş]|birikim/i;
const INCOME_HINTS = /maa[sş]|gelir|prim|kira geliri|burs|ek gelir/i;

/**
 * Normalize an array-of-arrays sheet into months-as-rows. Months may be in
 * the first column or the first row; the other axis holds category labels.
 */
export function parseSheet(aoa: unknown[][]): ParsedSheet | null {
  if (aoa.length < 2) return null;
  const grid = aoa.map((row) => [...row]);

  const monthsInFirstColumn = grid.slice(1).filter((r) => parseMonthLabel(r[0]) != null).length;
  const monthsInFirstRow = grid[0].slice(1).filter((c) => parseMonthLabel(c) != null).length;
  const normalized = monthsInFirstRow > monthsInFirstColumn ? transpose(grid) : grid;

  const header = normalized[0].slice(1).map((c) => String(c ?? "").trim());
  const body = normalized.slice(1).filter((r) => parseMonthLabel(r[0]) != null);
  if (body.length === 0 || header.length === 0) return null;

  const keepIdx: number[] = [];
  const skippedColumns: string[] = [];
  header.forEach((label, i) => {
    if (label === "") return;
    if (BALANCE_HINTS.test(label)) skippedColumns.push(label);
    else keepIdx.push(i);
  });

  return {
    months: body.map((r) => parseMonthLabel(r[0])!),
    columns: keepIdx.map((i) => ({
      label: header[i],
      kindGuess: INCOME_HINTS.test(header[i]) ? "income" : "expense",
    })),
    cells: body.map((r) => keepIdx.map((i) => parseSheetAmount(r[i + 1]))),
    skippedColumns,
  };
}

function transpose(grid: unknown[][]): unknown[][] {
  const cols = Math.max(...grid.map((r) => r.length));
  return Array.from({ length: cols }, (_, c) => grid.map((r) => r[c]));
}

/** Decode an uploaded workbook (xlsx or csv bytes) to the first sheet's AOA. */
export function readWorkbook(data: Uint8Array): unknown[][] {
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];
}
