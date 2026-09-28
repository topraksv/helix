/**
 * Helix web service worker — makes the app open on a cold start while offline
 * (the browser has no assets cached otherwise, so it showed a blank page).
 *
 * Strategy, chosen to NEVER serve stale app code:
 *   - Navigations (HTML): network-first, fall back to the cached shell only
 *     when offline. Online always gets the freshly deployed HTML, so OTA-style
 *     Pages deploys land immediately.
 *   - Same-origin files Expo names by their content (`hashed`): cache-first.
 *     A new build has new names, so the cache can't shadow an update.
 *   - Every other same-origin file (favicon, icons, manifest, social card):
 *     network-first, the cache only offline. Their names never change, so
 *     cache-first kept the first copy forever — the old mark's favicon outlived
 *     the new one's deploy (2026-09-28).
 *   - Cross-origin (Supabase, FX feeds, favicons): never intercepted or cached.
 */
// v2 drops any shell entry an older worker may have replaced with a navigated
// JS/image response before the content-type boundary below existed.
// v3 drops the icons v2 cached for good.
const CACHE = "helix-v3";
// Absolute so the offline fallback matches regardless of the navigated path
// (a relative "./index.html" resolved against the request, not the shell).
const SHELL = "/helix/index.html";

/** A path a build names by its content, which can be served from the cache without asking. */
function hashed(path) {
  return path.includes("/_expo/static/") || /\.[0-9a-f]{32}\.[a-z0-9]+$/i.test(path);
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave cross-origin to the network

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
          // A navigation can target any URL under the service-worker scope,
          // including a public JS/image asset. Never let that response replace
          // the offline HTML shell and persistently break the next cold start.
          if (res.ok && contentType.startsWith("text/html")) {
            caches
              .open(CACHE)
              .then(async (cache) => {
                await cache.put(SHELL, res.clone());
                // Prune: content-hashed asset names change every deploy and the
                // old ones are never requested again, so without a cap the cache
                // grows by one build per deploy, forever. We are online right
                // now (this navigation fetch succeeded), so dropping stale
                // assets is safe — live ones re-cache on their next request.
                const keys = await cache.keys();
                if (keys.length > 120) {
                  await Promise.all(
                    keys
                      .filter((cached) => new URL(cached.url).pathname !== SHELL)
                      .map((cached) => cache.delete(cached)),
                  );
                }
              })
              .catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match(SHELL)) ||
            (await cache.match(req, { ignoreSearch: true })) ||
            new Response("<!doctype html><meta charset=utf-8><title>Helix</title>", { headers: { "Content-Type": "text/html" } })
          );
        }),
    );
    return;
  }

  if (!hashed(url.pathname)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) || Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => cached),
    ),
  );
});
