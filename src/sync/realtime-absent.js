/**
 * The Realtime transport, replaced by a statement that this app has none.
 *
 * `@supabase/supabase-js` builds a `RealtimeClient` in its constructor whether
 * or not anything subscribes, and re-exports the whole module besides. Metro
 * does not tree-shake, so `@supabase/realtime-js` and the `@supabase/phoenix`
 * socket it carries were 65_134 bytes of the entry chunk — 2.0% of it — for an
 * app that opens no socket at all. `metro.config.js` substitutes this file for
 * it, the way it already substitutes a stub for `expo-sqlite` on the server.
 *
 * Helix is offline-first and pulls on its own schedule: `sync/engine.ts` runs
 * a cursor-driven pass, and nothing anywhere calls `.channel()`. That is the
 * whole premise of this substitution, and it is checked rather than
 * remembered — `tests/release-config.test.ts` fails if a subscription appears.
 *
 * `setAuth` is the only method supabase-js calls by itself: once on
 * construction and again on every token change, with the result discarded. It
 * does nothing here. The four channel methods THROW rather than pretend,
 * because a channel that silently never delivers is the worst of the three
 * possible answers — the failure would surface as data that never arrives,
 * days later, on someone's phone.
 */

const UNAVAILABLE =
  "Supabase Realtime is not bundled in Helix. metro.config.js substitutes " +
  "src/sync/realtime-absent.js for @supabase/realtime-js because nothing here " +
  "opens a socket. To use channels, remove that substitution and re-measure " +
  "the web bundle budget.";

export class RealtimeClient {
  setAuth() {}
  /** Honest and empty: there are no channels, and asking is not an error. */
  getChannels() {
    return [];
  }
  channel() {
    throw new Error(UNAVAILABLE);
  }
  removeChannel() {
    throw new Error(UNAVAILABLE);
  }
  removeAllChannels() {
    throw new Error(UNAVAILABLE);
  }
}
