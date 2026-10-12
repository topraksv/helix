/**
 * Fetches a public Binance quote for a device whose network cannot resolve
 * `data-api.binance.vision`; the client asks only after a direct request fails.
 * It carries no user data. Not an open proxy: it takes a symbol and an
 * interval from lists below and builds the URL itself.
 */

const UPSTREAM_HOST = "data-api.binance.vision";

const SYMBOLS = new Set(["PAXGTRY", "USDTTRY", "EURUSDT"]);

const INTERVALS = new Set(["1h", "4h", "1d", "1w"]);

/** The largest `limit` any range asks for, so a caller cannot ask for a year of minutes. */
const MAX_LIMIT = 60;

const UPSTREAM_TIMEOUT_MS = 8000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HEADERS = { ...CORS, "content-type": "application/json", "cache-control": "no-store" };

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });

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
      `?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  }

  return null;
}

Deno.serve(async (request: Request) => {
  // `supabase.functions.invoke` posts a JSON body; nothing else is a caller
  // this function was written for.
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
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
      headers: HEADERS,
    });
  } catch {
    return json({ error: "upstream" }, 502);
  } finally {
    clearTimeout(timer);
  }
});
