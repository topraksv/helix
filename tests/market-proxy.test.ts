import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MARKET_PAIRS, MARKET_RANGES } from "../src/domain/market";

/**
 * The proxy's boundary, read from its source.
 *
 * `supabase/functions/market-proxy` is a Deno function: it imports nothing this
 * toolchain can resolve and `tsconfig.json` excludes the directory on purpose,
 * so it cannot be imported and called here. What CAN be held is the thing that
 * actually matters — that the allowlists in it still match the app's, and that
 * it never builds a URL from what a caller sent.
 *
 * The hazard is specific. A function that fetches a URL a client chose is a way
 * to make arbitrary requests from Supabase's network, at this project's expense
 * and under its name. This one takes a symbol and an interval and builds the
 * URL itself; these assertions are what stop that quietly becoming a `url`
 * parameter later.
 */
const source = readFileSync(join(process.cwd(), "supabase/functions/market-proxy/index.ts"), "utf8");

describe("market proxy", () => {
  it("builds the upstream URL itself and never takes one", () => {
    // A caller-supplied URL is the whole hazard; there must be no way in.
    expect(source).not.toMatch(/body\.url|params\.get\("url"\)|searchParams\.get\("url"\)/);
    expect(source).toContain("const UPSTREAM_HOST = \"data-api.binance.vision\"");
    // Every fetch target is built from the constant host.
    for (const match of source.matchAll(/fetch\(([^)]*)\)/g)) {
      expect(match[1], "a fetch that does not go through upstreamUrl").toMatch(/\burl\b/);
    }
    expect(source, "the host is interpolated, not received").toContain("https://${UPSTREAM_HOST}");
  });

  it("allows exactly the books the app asks for, and no others", () => {
    const allowed = /const SYMBOLS = new Set\(\[([^\]]*)\]\)/.exec(source)?.[1] ?? "";
    const symbols = [...allowed.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(symbols, "the proxy's basket is the app's basket").toEqual([...MARKET_PAIRS].sort());
  });

  it("allows exactly the intervals the ranges use", () => {
    const allowed = /const INTERVALS = new Set\(\[([^\]]*)\]\)/.exec(source)?.[1] ?? "";
    const intervals = [...allowed.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    const used = [...new Set(Object.values(MARKET_RANGES).map((range) => range.interval))].sort();
    expect(intervals, "a range the app can ask for must be allowed, and nothing more").toEqual(used);
  });

  it("caps the candle count above what any range needs and below a year of minutes", () => {
    const cap = Number(/const MAX_LIMIT = (\d+)/.exec(source)?.[1]);
    const largest = Math.max(...Object.values(MARKET_RANGES).map((range) => range.limit));
    expect(cap, "every range must fit").toBeGreaterThanOrEqual(largest);
    expect(cap, "and nothing much beyond it").toBeLessThan(largest * 3);
  });

  it("refuses anything that is not the one shape it serves", () => {
    expect(source, "only POST, because that is what invoke sends").toContain('request.method !== "POST"');
    expect(source, "an unknown kind is refused rather than guessed").toContain('return json({ error: "unsupported" }, 400)');
    expect(source, "a body that will not parse is refused").toContain('return json({ error: "body" }, 400)');
    expect(source, "and the upstream gets a deadline").toContain("UPSTREAM_TIMEOUT_MS");
  });

  it("carries nothing of the owner's, and says so", () => {
    // The request is a public symbol name. Anything that looked like user data
    // crossing this boundary would be a privacy change, not a networking one.
    expect(source).not.toMatch(/user_id|userId|email|access_token|session/i);
    expect(source, "the reason is written down where the next reader is").toContain("carries no user data");
  });
});
