/**
 * supabase-js's Realtime transport, replaced by a statement that it has none.
 *
 * supabase-js builds a `RealtimeClient` in its constructor whether or not anything subscribes, and Metro
 * does not tree-shake. `metro.config.js` substitutes this file for that import alone. Sync pulls on its own
 * cursor and nothing calls `.channel()` (`tests/repo/release-config.test.ts` fails if a subscription
 * appears). `setAuth`, which supabase-js calls by itself, does nothing; the channel methods throw, since a
 * channel that silently never delivers would surface as data that never arrives.
 */

const UNAVAILABLE =
  "supabase.channel() is not bundled: metro.config.js substitutes " +
  "src/sync/realtime-absent.js for @supabase/realtime-js because nothing here " +
  "opens a socket. To use channels, remove that substitution.";

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
