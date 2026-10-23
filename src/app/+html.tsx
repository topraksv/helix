import { ScrollViewStyleReset, useServerDocumentContext } from "expo-router/html";
import type { PropsWithChildren } from "react";
import { tr } from "../i18n/tr";
import { darkPalette, lightPalette } from "../ui/theme";
import { MARKET_DATA_HOST } from "../domain/market";
import { trustedSupabaseOrigin } from "../domain/web-security";

const supabaseOrigin = trustedSupabaseOrigin(process.env.EXPO_PUBLIC_SUPABASE_URL);

/** Where the built app actually lives. The trailing slash is part of it: every
 *  absolute asset URL below is this plus a path, and the deployed base is
 *  `/helix/` — the same base the service worker registration checks for. */
const SITE_URL = "https://topraksv.github.io/helix/";
/** Relative to `SITE_URL`. Served from `public/` because Expo hashes `assets/` names; JPEG because the flat card costs fewer deployed bytes. */
const OG_IMAGE = "og-cover.jpg";

/** The splash colours in `app.json`: the default palette's ground, which the
 *  launch screen keeps for anyone who has not chosen another. */
const LIGHT_BACKGROUND = lightPalette.background;
const DARK_BACKGROUND = darkPalette.background;

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: tr.app.name,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web, iOS, Android",
  url: SITE_URL,
  image: `${SITE_URL}${OG_IMAGE}`,
  description: tr.meta.social,
  inLanguage: "tr-TR",
  // Stated rather than left out: "no price given" and "free" are different
  // claims, and a finance app that says nothing about cost invites the worse
  // assumption.
  offers: { "@type": "Offer", price: "0", priceCurrency: "TRY" },
};

/**
 * Root HTML shell for web (dev + static export).
 * `children` already contains the root <div id="root" />.
 */
export default function Root({ children }: PropsWithChildren) {
  // From SDK 58 the export renders this document through React and hands the
  // bundle's scripts and react-native-web's styles to it here; a root that
  // drops them exports a page that never boots.
  const { htmlAttributes, bodyAttributes, headNodes, bodyNodes } = useServerDocumentContext();
  return (
    <html lang="tr" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* Recovery codes must not be repeated in same-origin asset request
            referrers before supabase-js exchanges and removes them. */}
        <meta name="referrer" content="no-referrer" />
        {/* Defense-in-depth for the static Pages deployment (no server headers
            there). connect-src pins the only legitimate network peers, which
            blocks XSS exfiltration targets even though script-src must stay
            'unsafe-inline' (the export emits per-build inline bootstrap
            scripts, so hashes cannot be static). 'wasm-unsafe-eval' + worker
            entries keep the sqlite WASM worker booting. */}
        <meta
          httpEquiv="Content-Security-Policy"
          content={[
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            // google.com/s2 redirects to *.gstatic.com, so both are allowed or every logo falls back to the local chip.
            "img-src 'self' data: blob: https://www.google.com https://*.gstatic.com https://icons.duckduckgo.com https://icon.horse",
            "font-src 'self' data:",
            // Read from the feed's module so the policy cannot drift from the host the app asks.
            `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""} https://open.er-api.com https://${MARKET_DATA_HOST}`,
            "worker-src 'self' blob:",
            "frame-src 'none'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join("; ")}
        />
        {/* No maximum-scale: locking pinch-zoom fails WCAG 1.4.4 and blocks
            low-vision users; the app's own scroll containers are unaffected
            by page zoom. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        {/* Also set by `_layout.tsx`'s Head; crawlers that do not run JavaScript read only this static document. */}
        <title>{tr.meta.title}</title>
        {/* Installing to the home screen: the brand kit's icons, with the
            maskable one drawn inside the safe zone a launcher never cuts. */}
        <link rel="manifest" href="/helix/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/helix/icons/apple-touch-icon.png" />
        <meta
          name="description"
          content={tr.meta.description}
        />

        {/* Static metadata for indexes and link previews; `SITE_URL` is asserted against README by tests/repo/release-config.test.ts. */}
        <link rel="canonical" href={SITE_URL} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={tr.app.name} />
        <meta property="og:locale" content="tr_TR" />
        <meta property="og:title" content={tr.meta.title} />
        <meta property="og:description" content={tr.meta.social} />
        <meta property="og:url" content={SITE_URL} />
        <meta property="og:image" content={`${SITE_URL}${OG_IMAGE}`} />
        <meta property="og:image:type" content="image/jpeg" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content={tr.app.name} />
        {/* `summary_large_image` rather than `summary`: the cover is a 1200x630
            wordmark, and the small card would crop it to a square that shows
            about a third of it. */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={tr.meta.title} />
        <meta name="twitter:description" content={tr.meta.social} />
        <meta name="twitter:image" content={`${SITE_URL}${OG_IMAGE}`} />

        {/* One per scheme so the first paint is right; `_layout.tsx` overwrites them because the first matching tag wins. */}
        <meta name="theme-color" media="(prefers-color-scheme: light)" content={LIGHT_BACKGROUND} />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content={DARK_BACKGROUND} />
        {/* Meta and CSS both: Chromium's computed style reflects only the CSS rule. Covers the boot screens before `RootLayoutInner` sets the stored scheme. */}
        <meta name="color-scheme" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: ":root{color-scheme:light dark}" }} />

        {/* Serialised from an object: an invalid JSON-LD block is skipped silently, and JSON.stringify escapes the content. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />
        <ScrollViewStyleReset />
        {/* Lock the page frame: the app scrolls inside its own ScrollViews, so
            the document itself must never pan (that revealed white gutters and
            shifted the footer on mobile web). */}
        <style
          dangerouslySetInnerHTML={{
            __html:
              "html,body,#root{height:100%;width:100%;max-width:100%;overflow:hidden;overscroll-behavior:none;}" +
              "body{position:fixed;top:0;left:0;right:0;bottom:0;margin:0;}" +
              "*{box-sizing:border-box;}" +
              // Chrome is not selectable; `#root *` outranks react-native-web's per-Text user-select class, and fields opt back in.
              "#root,#root *{-webkit-user-select:none;user-select:none;}" +
              "#root input,#root textarea{-webkit-user-select:text;user-select:text;}" +
              // `:focus-visible` so mouse presses draw no ring; negative offset so overflow:hidden ancestors cannot clip it.
              "#root :focus-visible{outline:2px solid var(--helix-focus,#3C6F96);outline-offset:-2px;}" +
              // react-native-web sets `outline:none` on its own pressables in
              // some paths; this restores the ring for the elements that
              // actually take focus without touching anything else.
              "#root [tabindex]:focus-visible,#root [role=button]:focus-visible,#root [role=tab]:focus-visible," +
              "#root a:focus-visible,#root input:focus-visible,#root textarea:focus-visible," +
              "#root select:focus-visible{outline:2px solid var(--helix-focus,#3C6F96);outline-offset:-2px;}" +
              // Both layers drawn: the default `-old` on top darkens the midpoint of a light-to-dark change.
              "::view-transition-old(root),::view-transition-new(root){animation-duration:520ms;animation-timing-function:cubic-bezier(0.4,0,0.2,1);mix-blend-mode:normal;}" +
              "@media (prefers-reduced-motion:reduce){::view-transition-old(root),::view-transition-new(root){animation-duration:1ms;}}",
          }}
        />
        {/* Register the offline service worker only under the deployed /helix/
            base (skips the dev server at the root). Network-first for HTML, so
            updates always land online; the cache only rescues a cold offline start. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if('serviceWorker' in navigator && location.pathname.indexOf('/helix/')===0){" +
              "window.addEventListener('load',function(){navigator.serviceWorker.register('/helix/sw.js',{scope:'/helix/'}).catch(function(){});});}",
          }}
        />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
