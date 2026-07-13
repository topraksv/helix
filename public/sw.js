/**
 * Helix web service worker — makes the app open on a cold start while offline
 * (the browser has no assets cached otherwise, so it showed a blank page).
 *
 * Strategy, chosen to NEVER serve stale app code:
 *   - Navigations (HTML): network-first, fall back to the cached shell only
 *     when offline. Online always gets the freshly deployed HTML, so OTA-style
 *     Pages deploys land immediately.
 *   - Same-origin static assets (JS/CSS/fonts/images): cache-first. Expo
 *     content-hashes these filenames, so a new build has new names — the cache
 *     can't shadow an update.
 *   - Cross-origin (Supabase, FX feeds, favicons): never intercepted or cached.
 */
const CACHE = "helix-v1";
// Absolute so the offline fallback matches regardless of the navigated path
// (a relative "./index.html" resolved against the request, not the shell).
const SHELL = "/helix/index.html";

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
          caches.open(CACHE).then((cache) => cache.put(SHELL, res.clone())).catch(() => {});
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
