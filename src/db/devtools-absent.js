/**
 * The Expo devtools client, replaced in release builds by a statement that there is none.
 *
 * `expo-sqlite` requires `expo/devtools` only behind `__DEV__`, but Metro collects the `require` before the
 * minifier drops the branch. `metro.config.js` substitutes this file outside dev. It throws rather than
 * returning a client that never connects: a release that reaches it has a false premise.
 */

export async function getDevToolsPluginClientAsync() {
  throw new Error(
    "expo/devtools is not bundled in release builds: metro.config.js substitutes " +
      "src/db/devtools-absent.js, and expo-sqlite calls it only under __DEV__.",
  );
}
