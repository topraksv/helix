/**
 * Who the welcome tour is for.
 *
 * It was gated on a device-local flag alone, and a flag on the device cannot
 * answer a question about the account. A workspace with years of records in it
 * still looks brand new to a browser profile that has never held that key — a
 * second browser, a private window, cleared site data, a new phone — so
 * someone who had been using Helix for months was introduced to it again on
 * every one of those. The flag is still how "already seen" is remembered; what
 * it no longer does is decide on its own.
 *
 * A source check rather than a render one, deliberately: the component is a
 * `Modal` over a mounted dashboard, and the rule is which SIGNAL it reads.
 * `tests/session-store` already proves when `isNewSignup` is true — only for
 * the session that created the account, cleared by both bootstrap and sign-in
 * — so holding the tour to that signal is the whole of this rule.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const tour = readFileSync(join(process.cwd(), "src/ui/tour.tsx"), "utf8");
const gate = tour.slice(tour.indexOf("export function FirstRunTour("), tour.indexOf("export function TourModal("));

describe("the welcome tour opens once, for a new account", () => {
  it("reads the session's own answer, not only the device's", () => {
    expect(gate).toContain("isNewSignup");
    expect(gate).toContain("isSupabaseConfigured");
    // The device flag survives as the "already seen" half.
    expect(gate).toContain("kv.get(TOUR_KEY)");
    expect(gate).toContain('kv.set(TOUR_KEY, "true")');
  });

  it("does not even ask the device when the account is not new", () => {
    // The early return is the point: a signed-in account that has been used
    // for years must not depend on what this browser profile happens to
    // remember, so the flag is never consulted for it.
    expect(gate).toMatch(/if \(!firstRunOfAnAccount\) return;/);
  });

  it("keeps a local-only workspace's first run a first run", () => {
    // There is no sign-up to key on without a cloud account, so the device
    // flag is the only honest signal there — and it is the right one, because
    // that workspace cannot exist on a second device.
    expect(gate).toMatch(/isNewSignup \|\| !isSupabaseConfigured/);
  });
});
