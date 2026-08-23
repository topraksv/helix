/**
 * Where a key press moves the cursor inside Mali Tablo's grid.
 *
 * Outside React and outside `sticky-table.tsx` for the same reason
 * `responsive.ts` is: this is arithmetic with edges, and arithmetic with edges
 * is what a regression test can hold. The component around it needs a DOM and
 * a renderer; these rules need neither.
 */

export interface GridPosition {
  row: number;
  column: number;
}

/**
 * Where one key press moves the cursor in a grid.
 *
 * Pure and exported so the navigation rules can be tested without a DOM: the
 * clamping at the four edges, the page size, and the difference between Home
 * (start of row) and Ctrl+Home (first cell) are the parts that are easy to get
 * subtly wrong and impossible to see in a screenshot.
 *
 * Returns null for a key this grid does not claim, so the event keeps its
 * default behaviour instead of being swallowed.
 */
export function nextGridPosition(
  press: { key: string; toEnds: boolean },
  at: GridPosition,
  size: { rows: number; columns: number },
): GridPosition | null {
  if (size.rows <= 0 || size.columns <= 0) return null;
  // A page is a screenful, bounded so a short table still moves and a very
  // long one does not jump from the first row to the last.
  const page = Math.max(1, Math.min(10, size.rows - 1));
  let { row, column } = at;
  switch (press.key) {
    case "ArrowUp": row -= 1; break;
    case "ArrowDown": row += 1; break;
    case "ArrowLeft": column -= 1; break;
    case "ArrowRight": column += 1; break;
    case "PageUp": row -= page; break;
    case "PageDown": row += page; break;
    case "Home":
      column = 0;
      if (press.toEnds) row = 0;
      break;
    case "End":
      column = size.columns - 1;
      if (press.toEnds) row = size.rows - 1;
      break;
    default: return null;
  }
  return {
    row: Math.max(0, Math.min(size.rows - 1, row)),
    column: Math.max(0, Math.min(size.columns - 1, column)),
  };
}
