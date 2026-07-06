/**
 * Tombstone. Earlier builds registered a service worker here to add COOP/COEP
 * headers for expo-sqlite's synchronous bridge. The app is async-only now and
 * needs neither; browsers that still have the old worker fetch this file on
 * navigation, install it as the update, and it removes itself.
 */

/* eslint-env serviceworker */

if (typeof window === "undefined") {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) => {
    event.waitUntil(self.registration.unregister());
  });
}
