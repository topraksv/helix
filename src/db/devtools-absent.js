/**
 * The Expo devtools client, replaced in release builds by a statement that
 * there is none.
 *
 * `expo-sqlite` requires `expo/devtools` only behind `__DEV__`, which is false
 * in a release — but Metro collects the `require` before the minifier drops
 * the branch, so every release carried @expo/devtools (14_832 bytes of the web
 * entry chunk, measured) for a call it can never make. `metro.config.js`
 * substitutes this file when it is not building for dev; the inspector still
 * works in development.
 *
 * It throws rather than returning a client that never connects: if a release
 * ever reaches it, the premise is wrong and should be loud.
 */

export async function getDevToolsPluginClientAsync() {
  throw new Error(
    "expo/devtools is not bundled in release builds. metro.config.js substitutes " +
      "src/db/devtools-absent.js for it because expo-sqlite calls it only under __DEV__.",
  );
}
