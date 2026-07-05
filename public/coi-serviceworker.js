/**
 * Cross-origin isolation shim for static hosts that can't set response headers
 * (GitHub Pages). expo-sqlite's web driver needs SharedArrayBuffer, which the
 * browser only enables when the document is served with COOP/COEP headers —
 * the same ones metro.config.js injects for the dev server.
 *
 * The file runs in two contexts:
 *  - as a page script it registers itself as a service worker, then reloads
 *    the page once so the document is re-served through the worker;
 *  - as the service worker it re-emits every response with COOP/COEP added.
 */

/* eslint-env browser, serviceworker */

if (typeof window === "undefined") {
  // ---- service worker context ----
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

  self.addEventListener("fetch", (event) => {
    const request = event.request;
    // Chrome bug workaround: only-if-cached requests fail when proxied.
    if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;

    event.respondWith(
      fetch(request).then((response) => {
        if (response.status === 0) return response; // opaque — can't touch headers
        const headers = new Headers(response.headers);
        headers.set("Cross-Origin-Embedder-Policy", "require-corp");
        headers.set("Cross-Origin-Opener-Policy", "same-origin");
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      })
    );
  });
} else {
  // ---- page context ----
  (() => {
    if (window.crossOriginIsolated) return; // headers already present
    if (!("serviceWorker" in navigator)) return; // nothing we can do

    // One reload is expected (the first response predates the worker); a
    // session flag stops a loop on browsers where isolation still fails.
    const RELOADED_KEY = "coi-reloaded";
    if (window.sessionStorage.getItem(RELOADED_KEY)) return;

    const scriptUrl = document.currentScript && document.currentScript.src;
    if (!scriptUrl) return;

    navigator.serviceWorker
      .register(scriptUrl)
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        window.sessionStorage.setItem(RELOADED_KEY, "1");
        window.location.reload();
      })
      .catch((error) => console.error("coi-serviceworker registration failed:", error));
  })();
}
