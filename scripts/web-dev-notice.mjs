/**
 * Explain, once, why `npm run web` does not start Expo's web dev server.
 *
 * The dev server cannot bundle this app. `expo-sqlite`'s web driver runs in a
 * Web Worker, a worker import is only loadable when the serializer has emitted
 * the split-bundle path map, and the dev server hard-codes bundle splitting to
 * off outside an export (`splitChunks: isExporting && …`). The two failures it
 * produces are the same cause seen from different sides: the serializer first
 * asserts "Worker chunk not found", and with the worker forced into the graph
 * the runtime refuses with "Bundle splitting is required for Web Worker
 * imports". Neither `EXPO_NO_METRO_LAZY` nor `--no-dev --minify` reaches a
 * working page, and forcing the option through the serializer means editing
 * Expo's internals rather than configuring them.
 *
 * So this prints the reason and hands over to the export preview, which serves
 * the same artifact that deploys. The alternative — starting a server that
 * answers 500, or worse one that renders a shell whose database never opens —
 * costs whoever runs it the time it takes to rediscover all of the above.
 *
 * Delete this script and restore `expo start --web` once the dev server splits
 * bundles on its own; `docs/ARCHITECTURE.md` records what to re-test.
 */

const lines = [
  "",
  "  Expo's web dev server cannot bundle this app on the current SDK:",
  "  the SQLite web driver needs a Web Worker, and workers need bundle",
  "  splitting, which the dev server disables outside an export.",
  "",
  "  Starting the export preview instead — same artifact that deploys,",
  "  no fast refresh. Re-run after a change.",
  "",
];

console.log(lines.join("\n"));
