// Drizzle's migrations import .sql files; expo-sqlite's web driver ships a wasm asset.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push("sql");
config.resolver.assetExts.push("wasm");

/**
 * The environments `@expo/metro-config` renders to a string rather than to a
 * screen: "node" for the static HTML pass, "react-server" for RSC.
 */
const SERVER_ENVIRONMENTS = new Set(["node", "react-server"]);

const SERVER_SQLITE_STUB = path.resolve(__dirname, "src/db/expo-sqlite.server.js");

/**
 * No realtime in an offline-first app: `createClient` builds a socket client
 * whether or not anything subscribes, and Metro does not tree-shake. Unscoped
 * by platform; the stub says what happens if that changes.
 */
const REALTIME_STUB = path.resolve(__dirname, "src/sync/realtime-absent.js");

/** Local reminders do not exist on the web; the phone uses the real module. */
const NOTIFICATIONS_STUB = path.resolve(__dirname, "src/services/notifications-absent.js");

/** `expo-sqlite` requires the devtools client behind `__DEV__`; a release need not carry it. */
const DEVTOOLS_STUB = path.resolve(__dirname, "src/db/devtools-absent.js");

/**
 * A server render has no database, so its bundle does not carry the driver.
 * `web.output` is "static": every route is rendered once in Node. This does not
 * fix Expo's web dev server (upstream; `docs/ARCHITECTURE.md` records it).
 */
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === "expo-sqlite" &&
    SERVER_ENVIRONMENTS.has(context.customResolverOptions?.environment)
  ) {
    return { type: "sourceFile", filePath: SERVER_SQLITE_STUB };
  }
  if (moduleName === "@supabase/realtime-js") {
    return { type: "sourceFile", filePath: REALTIME_STUB };
  }
  if (moduleName === "expo/devtools" && !context.dev) {
    return { type: "sourceFile", filePath: DEVTOOLS_STUB };
  }
  if (moduleName === "expo-notifications" && platform === "web") {
    return { type: "sourceFile", filePath: NOTIFICATIONS_STUB };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
