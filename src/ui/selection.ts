import type { LucideIcon } from "lucide-react-native";

export interface SelectionOption<T extends string = string> {
  value: T;
  label: string;
  /**
   * The tile's mark. A component, like every other mark in the app — it used
   * to be the raw stored emoji string, which is why a template tile and the
   * lucide icon in the row beside it were drawn by two different engines.
   */
  icon?: LucideIcon | null;
}

const normalizeSelectionText = (value: string) => value.trim().toLocaleLowerCase("tr-TR");

export function filterSelectionOptions<T extends SelectionOption>(
  options: readonly T[],
  query: string,
): T[] {
  const normalizedQuery = normalizeSelectionText(query);
  if (!normalizedQuery) return [...options];
  return options.filter((option) =>
    normalizeSelectionText(option.label).includes(normalizedQuery),
  );
}
