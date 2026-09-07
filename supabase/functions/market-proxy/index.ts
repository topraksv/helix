/**
 * Fetch a public market quote on the app's behalf, from a network that can.
 *
 * `data-api.binance.vision` is the app's only source for live quotes and for
 * the candles a chart is drawn from. It is unreachable from some networks —
 * reported by the owner on two devices and two connections, while the same
 * requests succeeded from elsewhere — and the app has no way around a name that
 * does not resolve. What it does have is this: a request that leaves Supabase
 * instead of the phone.
 *
 * The client asks here only AFTER a direct request has failed, so a device that
 * can reach the source never pays for the hop.
 *
 * It carries no user data. The whole request is a symbol name and, for candles,
 * an interval — the same public figures the app draws on a card anyone can see.
 * There is nothing here to redact and nothing to log.
 *
 * ## Not an open proxy
 *
 * The one real hazard in a function like this is becoming a way to make
 * arbitrary requests from Supabase's network, at Supabase's expense, wearing
 * this project's name. So it does not take a URL. It takes a symbol and an
 * interval, checks both against lists this repository controls, and builds the
 * URL itself. A caller cannot reach a host, a path or a parameter that is not
 * written below.
 *
 * Deployment (owner, once):
 *   supabase functions deploy market-proxy
 *
 * No secret to set: the upstream is a public, keyless endpoint.
 */

const UPSTREAM_HOST = "data-api.binance.vision";

/** Exactly the books `src/domain/market.ts` names, and nothing else. */
const SYMBOLS = new Set(["PAXGTRY", "USDTTRY", "EURUSDT"]);

/** Exactly the four ranges `MARKET_RANGES` offers. */
const INTERVALS = new Set(["1h", "4h", "1d", "1w"]);

/** The largest `limit` any range asks for, so a caller cannot ask for a year of minutes. */
const MAX_LIMIT = 60;

const UPSTREAM_TIMEOUT_MS = 8000;

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

function upstreamUrl(body: Record<string, unknown>): string | null {
  const kind = body.kind;

  if (kind === "ticker") {
    // The client does not choose the basket: it is the same three books every
    // time, so there is no parameter here for a caller to widen.
    const symbols = JSON.stringify([...SYMBOLS]);
    return `https://${UPSTREAM_HOST}/api/v3/ticker/bookTicker?symbols=${encodeURIComponent(symbols)}`;
  }

  if (kind === "klines") {
    const symbol = String(body.symbol ?? "");
    const interval = String(body.interval ?? "");
    const limit = Number(body.limit);
    if (!SYMBOLS.has(symbol) || !INTERVALS.has(interval)) return null;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return null;
    return `https://${UPSTREAM_HOST}/api/v3/klines` +
      `?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  }

  return null;
}

Deno.serve(async (request: Request) => {
  // `supabase.functions.invoke` posts a JSON body; nothing else is a caller
  // this function was written for.
  if (request.method !== "POST") return json({ error: "method" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "body" }, 400);
  }

  const url = upstreamUrl(body ?? {});
  if (!url) return json({ error: "unsupported" }, 400);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return json({ error: "upstream" }, 502);
    // Passed through as text: the client already parses and validates this
    // shape, and re-serialising it here would be a second place for the two to
    // disagree about what a candle is.
    return new Response(await response.text(), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    return json({ error: "upstream" }, 502);
  } finally {
    clearTimeout(timer);
  }
});
