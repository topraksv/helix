import type { LucideIcon } from "lucide-react-native";

export interface SelectionOption<T extends string = string> {
  value: T;
  label: string;
  /** The tile's mark, as a component. */
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
