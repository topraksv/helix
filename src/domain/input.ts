/** Shared product limits for every user-editable text surface. React Native's
 * `maxLength` and repository validation use the same values, so UI and data
 * callers cannot drift into different rules. */
export const INPUT_LIMITS = {
  text: 120,
  note: 1_000,
  email: 254,
  password: 128,
  numeric: 3,
  money: 64,
} as const;

type InputLimitKind = keyof typeof INPUT_LIMITS;

export function isInputWithinLimit(value: string | null | undefined, kind: InputLimitKind): boolean {
  return value == null || value.length <= INPUT_LIMITS[kind];
}

export function assertInputWithinLimit(value: string | null | undefined, kind: InputLimitKind): void {
  if (!isInputWithinLimit(value, kind)) throw new Error(`${kind} input exceeds its maximum length`);
}

/** Count UTF-8 bytes without allocating another encoded copy of a large input. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}
