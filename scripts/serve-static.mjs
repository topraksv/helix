import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? "dist-e2e");
const port = Number(process.argv[3] ?? 4173);
const base = `/${(process.argv[4] ?? "helix").replace(/^\/+|\/+$/g, "")}`;

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function safeFile(relative) {
  const candidate = resolve(root, relative.replace(/^\/+/, ""));
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null;
}

function resolveRequest(pathname) {
  if (pathname === base || pathname === `${base}/`) return safeFile("index.html");
  if (!pathname.startsWith(`${base}/`)) return null;
  const relative = decodeURIComponent(pathname.slice(base.length + 1));
  for (const name of [relative, `${relative}.html`, `${relative}/index.html`]) {
    const file = safeFile(name);
    if (file && existsSync(file) && statSync(file).isFile()) return file;
  }
  return safeFile("404.html");
}

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`).pathname;
  const file = resolveRequest(pathname);
  if (!file || !existsSync(file)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(file.endsWith("404.html") ? 404 : 200, {
    "Cache-Control": "no-store",
    "Content-Type": types[extname(file)] ?? "application/octet-stream",
    "Cross-Origin-Opener-Policy": "same-origin",
  });
  if (request.method === "HEAD") response.end();
  else createReadStream(file).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Helix E2E server: http://127.0.0.1:${port}${base}/\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
