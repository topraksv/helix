import { ScrollViewStyleReset } from "expo-router/html";
import { type PropsWithChildren } from "react";

/**
 * Root HTML shell for web (dev + static export).
 * `children` already contains the root <div id="root" />.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        {/* Tab title comes from expo-router <Head> in _layout.tsx. */}
        <meta
          name="description"
          content="Local-first personal finance: monthly cash flow, installments, subscriptions."
        />
        {/* GitHub Pages can't send COOP/COEP headers, so a service worker adds
            them (SharedArrayBuffer for expo-sqlite). Dev server sets the real
            headers in metro.config.js, so this only ships in production.
            Path is absolute because exported HTML lives at nested routes too;
            keep it in sync with experiments.baseUrl in app.json. */}
        {process.env.NODE_ENV === "production" && (
          <script src="/helix/coi-serviceworker.js" />
        )}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
