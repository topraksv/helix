/**
 * The subject line a feedback report arrives under.
 *
 * It lives in the edge function rather than in `src/domain/` because this is
 * the only place it runs: the client never sends a subject, and it must not —
 * the subject is an email header, and a header a client can dictate is a
 * header a client can inject into. There WAS a `feedbackSubject` in the domain
 * carrying this rule, and it was dead: the function built its own subject with
 * a hard `slice(0, 60)`, so the better implementation was the unused one.
 *
 * Its own file, with no Deno global in it, so the behaviour below is asserted
 * by `tests/feedback.test.ts` rather than by reading this text back.
 *
 * Collapsing whitespace is doing two jobs at once and both matter: it is what
 * keeps a subject on one line, and it is what stops a CR or LF in a person's
 * message from starting a header of its own.
 */
const SUBJECT_LIMIT = 60;

/** Below this, stepping back to a word boundary would throw the subject away. */
const MIN_KEPT = 20;

export function feedbackSubject(category: string, message: string): string {
  const trimmed = message.trim().replace(/\s+/g, " ");
  if (trimmed.length <= SUBJECT_LIMIT) return `[Helix/${category}] ${trimmed}`;
  const cut = trimmed.slice(0, SUBJECT_LIMIT);
  const lastSpace = cut.lastIndexOf(" ");
  return `[Helix/${category}] ${(lastSpace > MIN_KEPT ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
