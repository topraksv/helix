// Drizzle migrations import .sql files; expo-sqlite web ships a wasm asset.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push("sql");
config.resolver.assetExts.push("wasm");

/**
 * Environments that render to a string rather than to a screen.
 *
 * `@expo/metro-config` sets this on both the resolver and the transformer, and
 * these are the two values it uses — "node" for the static HTML pass and
 * "react-server" for RSC. Anything else is a client bundle.
 */
const SERVER_ENVIRONMENTS = new Set(["node", "react-server"]);

const SERVER_SQLITE_STUB = path.resolve(__dirname, "src/db/expo-sqlite.server.js");

/**
 * `expo-sqlite` does not exist on the server, so the server bundle stops
 * carrying it.
 *
 * `web.output` is "static", so every route is rendered once in Node to produce
 * its HTML. That pass was pulling the whole SQLite driver — a database the
 * render can never open, behind a `dbReady` gate no server effect ever sets.
 *
 * It does NOT make Expo's web dev server work: that failure is upstream and in
 * the client bundle, and `docs/ARCHITECTURE.md` records it together with what
 * was ruled out. The substitution is scoped to the server environments and
 * leaves the client bundle — the one that actually opens a database —
 * untouched. `src/db/expo-sqlite.server.js` explains what it answers with.
 */
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === "expo-sqlite" &&
    SERVER_ENVIRONMENTS.has(context.customResolverOptions?.environment)
  ) {
    return { type: "sourceFile", filePath: SERVER_SQLITE_STUB };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
