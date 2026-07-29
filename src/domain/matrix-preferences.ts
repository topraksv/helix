export type MatrixMode = "cards" | "rows" | "columns";

export function resolveMatrixMode(value: string | null): MatrixMode {
  return value === "cards" || value === "rows" || value === "columns" ? value : "rows";
}
