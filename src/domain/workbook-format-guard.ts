/**
 * A cell whose first non-blank character is = + - @ is a formula in Excel and
 * Sheets; a ^ test is bypassed by a leading space. Do not guard numeric
 * columns: a negative amount starts with -. Its own file so `workbook-format.ts`
 * can re-export it without a cycle.
 */
export function neutralizeFormula(raw: string): string {
  return /^\s*[=+@-]/.test(raw) ? `'${raw}` : raw;
}

/** The inverse, for the ledger grid's headings the import wizard re-reads: else `=1+1` gains an apostrophe each round. */
export function deneutralizeFormula(cell: string): string {
  return /^'\s*[=+@-]/.test(cell) ? cell.slice(1) : cell;
}
