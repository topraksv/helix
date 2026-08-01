import { tr } from "../i18n/tr";

const EXAMPLE_PREFIX = /^Ör\.\s*/i;

/** Every editable field presents its placeholder as an example, without
 * duplicating the prefix already supplied by rotating placeholder pools. */
export function examplePlaceholder(placeholder?: string): string | undefined {
  if (!placeholder) return placeholder;
  const trimmed = placeholder.trim();
  if (!trimmed || EXAMPLE_PREFIX.test(trimmed)) return trimmed;
  return tr.placeholders.example(trimmed);
}

/** Numeric examples must read as guidance rather than pre-filled values. */
export function numericPlaceholderColor(textSecondary: string): string {
  return `${textSecondary}66`;
}
