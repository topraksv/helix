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

/** Applies only when choosing a new password. Existing accounts may still
 * have a legacy 6–7 character password and must be able to sign in once so
 * they can replace it. */
export const MIN_NEW_PASSWORD_LENGTH = 8;

type InputLimitKind = keyof typeof INPUT_LIMITS;

/** PostgreSQL char_length counts Unicode code points, not UTF-16 code units. */
export function textLength(value: string): number {
  let length = 0;
  const characters = value[Symbol.iterator]();
  while (!characters.next().done) length += 1;
  return length;
}

export function isValidNewPassword(value: string): boolean {
  const length = textLength(value);
  return length >= MIN_NEW_PASSWORD_LENGTH && length <= INPUT_LIMITS.password;
}

export function isInputWithinLimit(value: string | null | undefined, kind: InputLimitKind): boolean {
  return value == null || textLength(value) <= INPUT_LIMITS[kind];
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
