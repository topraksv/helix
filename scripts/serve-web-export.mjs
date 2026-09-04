/**
 * Serve a production web export the way GitHub Pages does.
 *
 * WHY THIS EXISTS RATHER THAN `expo start --web`. On SDK 57 the web dev server
 * cannot bundle this app at all: `MetroBundlerDevServer` sets
 * `splitChunks: isExporting && …`, so chunk splitting is off in development,
 * while `serializeChunks` still sends a Web Worker down the standalone-chunk
 * path and asserts a chunk that was therefore never produced. `expo-sqlite`'s
 * web driver is a worker, so every page answers 500 with "Worker chunk not
 * found". Exporting takes the other branch and works, which is why the shipped
 * site and the E2E suite were never affected.
 *
 * So this serves the real artifact instead of a development one. What that
 * costs is fast refresh; what it buys is that the thing being looked at is the
 * thing that deploys — same minification, same chunk boundaries, same
 * `baseUrl`. Re-run it after a change.
 *
 * The routing mirrors Pages deliberately: `experiments.baseUrl` is "/helix", a
 * directory falls back to its `index.html`, an extensionless path tries
 * `<path>.html` first, and anything unresolved falls through to the app shell
 * so a deep link opens the app rather than a 404 page. Getting that wrong
 * locally is how a deep-link bug reaches production unnoticed.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? "dist");
const port = Number(process.env.PORT ?? 4599);
const baseUrl = "/helix";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

const exists = async (path) => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

/** Refuse anything that climbs out of the export directory. */
function withinRoot(candidate) {
  const full = resolve(root, `.${normalize(candidate)}`);
  return full === root || full.startsWith(root + sep) ? full : null;
}

async function resolveFile(pathname) {
  let requested = pathname;
  if (requested.startsWith(baseUrl)) requested = requested.slice(baseUrl.length) || "/";
  const safe = withinRoot(requested);
  if (!safe) return null;
  if (await exists(safe)) return safe;
  if (await exists(`${safe}.html`)) return `${safe}.html`;
  const asIndex = join(safe, "index.html");
  if (await exists(asIndex)) return asIndex;
  // The shell, so a deep link opens the app the way Pages serves it.
  const shell = join(root, "index.html");
  return (await exists(shell)) ? shell : null;
}

if (!(await exists(join(root, "index.html")))) {
  console.error(
    `No export at ${root}. Build one first:\n  npx expo export -p web --clear\nthen: npm run web:preview`,
  );
  process.exit(1);
}

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const file = await resolveFile(pathname);
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(await readFile(file));
  } catch (error) {
    // The detail goes to whoever started the server, not down the socket. A
    // stack trace in a response body names absolute paths, module layout and
    // Node internals to anyone who can reach the port — and this one binds a
    // port on a developer machine, which is not always only that machine.
    // CodeQL flags the pattern rather than this instance, and it is right to:
    // the difference between a preview server and a real one is a habit.
    console.error("serve-web-export: request failed", error);
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Internal error");
  }
}).listen(port, () => {
  console.log(`Helix web export on http://localhost:${port}${baseUrl}/`);
});
