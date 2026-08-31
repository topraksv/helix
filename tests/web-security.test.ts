import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MARKET_DATA_HOST } from "../src/domain/market";
import { trustedSupabaseOrigin } from "../src/domain/web-security";

describe("web network trust boundary", () => {
  it("pins CSP to the configured HTTPS Supabase project origin", () => {
    expect(trustedSupabaseOrigin("https://project-ref.supabase.co"))
      .toBe("https://project-ref.supabase.co");
    expect(trustedSupabaseOrigin("https://other.supabase.co/rest/v1"))
      .toBeNull();
    expect(trustedSupabaseOrigin("http://project-ref.supabase.co"))
      .toBeNull();
    expect(trustedSupabaseOrigin("https://supabase.co.attacker.example"))
      .toBeNull();
    expect(trustedSupabaseOrigin("https://user@project-ref.supabase.co"))
      .toBeNull();
  });

  /**
   * The policy has to name every host the app actually calls.
   *
   * It named a socket the app no longer opens while the live prices were being
   * fetched from somewhere else entirely: on the web build the browser refused
   * every request and the market card was permanently empty, with the reason
   * only in a console nobody had open. The literal is gone — the document now
   * reads the host from the feed's own module — and this holds the two together
   * so the next move cannot leave the policy behind.
   */
  it("lets the document reach the market feed it is built to read", () => {
    const html = readFileSync(join(process.cwd(), "src/app/+html.tsx"), "utf8");
    // The directive itself, which is a template literal — not the paragraph
    // above it that happens to explain what `connect-src` is for.
    // To the end of its LINE: the directive interpolates a nested template
    // literal, so a backtick-delimited match stops halfway through it.
    const connect = /`connect-src.*$/m.exec(html)?.[0] ?? "";
    expect(connect).toContain("MARKET_DATA_HOST");
    expect(connect).not.toContain("haremaltin");
    // Interpolated, not spelled out a second time under a different name.
    expect(html).toContain('import { MARKET_DATA_HOST } from "../domain/market";');
    expect(html).not.toContain(MARKET_DATA_HOST);
  });
});
