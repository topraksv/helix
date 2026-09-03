/**
 * What `expo-sqlite` resolves to while a page is being rendered on the server.
 *
 * WHY THIS EXISTS. `app.json` sets `web.output: "static"`, so every route is
 * rendered once in Node to produce its HTML — during `expo export` and, more
 * visibly, on every request to `expo start --web`. That render pulls the route
 * tree, the route tree pulls `src/db/client.ts`, and that pulls `expo-sqlite`,
 * whose web build registers a Web Worker. Metro's serializer then asserts a
 * worker chunk it never emits for a server bundle, and the whole dev server
 * answers 500 with "Worker chunk not found for: expo-sqlite/web/worker.ts".
 *
 * The fix is not a shim for the assert — it is that a SERVER RENDER HAS NO
 * DATABASE. There is no OPFS, no origin, and no user; the root layout gates
 * every screen behind `dbReady`, which is set from an effect that server
 * rendering never runs. So the driver is not merely unusable there, it is
 * unreachable, and resolving it to nothing is the accurate description.
 *
 * These three are the only runtime imports the app makes from `expo-sqlite`
 * (everything else it takes is a type, which erases). Each THROWS rather than
 * returning an empty value: if server rendering ever does reach the database,
 * that is a real defect about where data is being read, and it should fail
 * loudly at the call instead of silently producing a page built from nothing.
 *
 * `metro.config.js` owns the substitution and names the environments it
 * applies to. `tests/release-config.test.ts` holds the pair together.
 *
 * NOTHING IMPORTS THIS FILE, and nothing ever will: Metro's resolver hands it
 * back in place of a package name, which no static analysis can see. `npm run
 * audit:unused` therefore reported it as an unused file — accurately, and with
 * exactly the wrong conclusion — so `knip.json` ignores it by name. Deleting it
 * does not fail a build; it puts the SQLite driver back into every server
 * render, which is the 500 above.
 */

function unavailable(name) {
  return () => {
    throw new Error(
      `expo-sqlite.${name} was called during server rendering, where there is no database. ` +
        "A screen is reading data outside the `dbReady` gate.",
    );
  };
}

export const openDatabaseAsync = unavailable("openDatabaseAsync");
export const deleteDatabaseAsync = unavailable("deleteDatabaseAsync");

/**
 * The one exception, and it is not a shortcut.
 *
 * `useAllTransactionsState` and its siblings subscribe on mount. React does not
 * run effects while rendering to a string, but a subscription that threw would
 * turn a future refactor into a blank page rather than a stale one — and there
 * is nothing to listen to on a server anyway. It returns the same handle shape
 * the real one does so a caller can always unsubscribe.
 */
export function addDatabaseChangeListener() {
  return { remove() {} };
}
