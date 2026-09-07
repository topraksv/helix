/**
 * Stop a spreadsheet cell being read as a formula, and undo it.
 *
 * Excel and Sheets evaluate a cell whose first NON-BLANK character is `=`, `+`,
 * `-` or `@`, so the guard looks past leading whitespace — a plain `^` test was
 * bypassed by `" =1+1"` when this lived on the CSV export, which is the bug
 * that made this boundary a unit-tested one. A note, a category or a person's
 * name can carry any of those, and on a synced workspace it can have been
 * written on another device.
 *
 * Every cell is already written as a string TYPE, which is what actually stops
 * Excel evaluating it; the apostrophe is the belt to that braces, for the other
 * readers a `.xlsx` gets opened in.
 *
 * App-generated numeric columns must NOT be routed through it: a negative
 * amount legitimately starts with `-`, and the money and date writers are
 * deliberately unguarded.
 *
 * It lives in its own file so `workbook-format.ts` can re-export it without the
 * two of them forming a cycle through the column helpers.
 */
export function neutralizeFormula(raw: string): string {
  return /^\s*[=+@-]/.test(raw) ? `'${raw}` : raw;
}

/**
 * The inverse, for the one place a guarded cell comes back: the ledger grid's
 * column headings are the owner's own category names, and they are re-read by
 * the import wizard. Without this a category called `=1+1` would gain an
 * apostrophe on every export-and-import round.
 */
export function deneutralizeFormula(cell: string): string {
  return /^'\s*[=+@-]/.test(cell) ? cell.slice(1) : cell;
}
