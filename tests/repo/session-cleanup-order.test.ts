import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The route guard decides between sign-in and Quick Start from two live values:
 * the session's user id and the `onboarded` setting it reads out of the local
 * database. Wiping the workspace while a user id is still set collapses those
 * into the same answer an unfinished setup gives, so the guard sends a user who
 * just signed out to the welcome screen instead of sign-in.
 *
 * Every cleanup path therefore ends the session in the same turn as the wipe,
 * before any further await. On a device the remote revoke and the SecureStore
 * removals that used to sit in between took long enough to be visible.
 */

const source = readFileSync(join(process.cwd(), "src/auth/session.ts"), "utf8");

/** Body of a top-level cleanup path, from its name to the start of the next one. */
function body(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  expect(from, `${start} not found — rename the anchor, do not delete the check`).toBeGreaterThan(-1);
  expect(to, `${end} not found after ${start}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

const paths = [
  { name: "signOut", source: body("signOut: async (options) => {", "deleteAccount: async () => {") },
  { name: "deleteAccount", source: body("deleteAccount: async () => {", "verifyPassword: async (password)") },
  { name: "clearInvalidatedSession", source: body("async function clearInvalidatedSession", "function ensureAuthLifecycleSubscription") },
];

describe("session cleanup order", () => {
  for (const path of paths) {
    it(`${path.name} ends the session before it awaits anything else`, () => {
      const wipe = path.source.indexOf("resetLocalWorkspace()");
      const clear = path.source.indexOf("userId: null");
      expect(wipe, "path no longer wipes the workspace").toBeGreaterThan(-1);
      expect(clear, "path no longer ends the session").toBeGreaterThan(-1);
      expect(clear, "the session must be ended after the wipe succeeds").toBeGreaterThan(wipe);

      // Nothing may await between the wipe and the end of the session: each of
      // these was a frame in which the guard could route to Quick Start.
      const between = path.source.slice(wipe, clear);
      for (const call of ["kv.remove(", "signOutWithLocalFallback(", "supabase.auth.signOut("]) {
        expect(between, `${call} must run after the session ends, not before`).not.toContain(call);
      }
    });
  }
});
