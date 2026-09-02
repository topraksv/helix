import { ScrollViewStyleReset } from "expo-router/html";
import { type PropsWithChildren } from "react";
import { tr } from "../i18n/tr";
import { MARKET_DATA_HOST } from "../domain/market";
import { trustedSupabaseOrigin } from "../domain/web-security";

const supabaseOrigin = trustedSupabaseOrigin(process.env.EXPO_PUBLIC_SUPABASE_URL);

/** Where the built app actually lives. The trailing slash is part of it: every
 *  absolute asset URL below is this plus a path, and the deployed base is
 *  `/helix/` — the same base the service worker registration checks for. */
const SITE_URL = "https://topraksv.github.io/helix/";
/** Relative to `SITE_URL`. Expo copies `assets/` into the export under its own
 *  hashed path, so the card image is served from `public/` instead, where the
 *  name it is published under is the name written here.
 *
 *  JPEG rather than PNG: the card is a wordmark on one flat colour, which PNG
 *  stores at 99 kB and JPEG at 37 kB with nothing visible between them. Those
 *  bytes are deployed and counted by the release budget even though no user of
 *  the app ever downloads them — only a crawler does — so the cheapest honest
 *  encoding is the right one. */
const OG_IMAGE = "og-cover.jpg";

/** The splash colours from `app.json`, which are the app's own first frame. */
const LIGHT_BACKGROUND = "#E7ECEB";
const DARK_BACKGROUND = "#101315";

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
  return (
    <html lang="tr">
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
            // Brand marks: google.com/s2 301-redirects to t*.gstatic.com, so
            // the redirect target must be allowed too or every logo silently
            // falls back to the local chip. icons.duckduckgo.com and
            // icon.horse serve the domains they measured better than Google
            // (see `src/domain/brand-marks.ts`); both answer directly, with no
            // redirect to a fourth host.
            "img-src 'self' data: blob: https://www.google.com https://*.gstatic.com https://icons.duckduckgo.com https://icon.horse",
            "font-src 'self' data:",
            // The market host is READ from the feed's own module, never spelled
            // again here. It was a literal until the feed moved: the app then
            // asked a host the policy did not allow, the browser refused every
            // request, and the card went permanently empty in the web build
            // with the reason only visible in a console nobody had open.
            `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""} https://open.er-api.com https://${MARKET_DATA_HOST}`,
            "worker-src 'self' blob:",
            "frame-src 'none'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join("; ")}
        />
        {/* Zod otherwise probes `new Function` even though it catches the
            rejection. Strict-CSP browsers report that harmless probe as a
            page error; preselect its documented interpreter path before the
            application bundle loads. It stays after the CSP declaration and
            uses the inline policy the static Expo bootstrap already requires.
            Native keeps Zod's default fast path. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "globalThis.__zod_globalConfig={jitless:true};",
          }}
        />
        {/* No maximum-scale: locking pinch-zoom fails WCAG 1.4.4 and blocks
            low-vision users; the app's own scroll containers are unaffected
            by page zoom. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        {/* The title is set here AND by expo-router's <Head> in `_layout.tsx`,
            which replaces it on hydration with the same string. It is here as
            well because the export ships one static document, and a crawler
            that does not run JavaScript — which is most link-preview bots —
            saw a page with no title at all. */}
        <title>{tr.meta.title}</title>
        <meta
          name="description"
          content={tr.meta.description}
        />

        {/* Everything below describes the page to something that is not a
            browser: a search index, and the card a link turns into when it is
            pasted into a message. None of it changes what the app does, and all
            of it is static — the export is one document, so there is no route
            whose values would differ.

            `SITE_URL` is written once here and asserted against the link in
            `README.md` by `tests/release-config.test.ts`, because a canonical
            URL that has quietly stopped matching where the app lives is worse
            than none: it tells an index to attribute this page to somewhere
            else. */}
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

        {/* Two, one per scheme, so the browser chrome is already the right
            colour on the first paint instead of after hydration. The app
            overwrites both through `syncThemeColorMeta` once it knows whether
            the owner has chosen a theme explicitly — it has to overwrite rather
            than add, because the HTML spec takes the FIRST matching
            `theme-color` and a tag appended later would never be read. */}
        <meta name="theme-color" media="(prefers-color-scheme: light)" content={LIGHT_BACKGROUND} />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content={DARK_BACKGROUND} />

        {/* One SoftwareApplication, in the category that says what it is for.
            Serialised from an object rather than written as a string so a typo
            cannot produce JSON that parses as nothing — an invalid block is
            skipped in silence, which is the failure mode structured data is
            famous for. `JSON.stringify` also escapes the content, so no value
            here can close the script element. */}
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
              // Chrome is not selectable. Dragging to scroll a table or a list
              // painted a selection across every label it crossed, which reads
              // as a web page rather than an app and, on mobile web, pops the
              // copy menu over the thing being dragged. Fields keep their caret;
              // if a value ever needs to be copyable, it opts back in there and
              // not by loosening this.
              // Descendants, not just the container: react-native-web puts its
              // own `user-select:text` class on every Text it renders, and a
              // class beats inheritance — so `#root` alone changed nothing that
              // was actually selectable. `#root *` outranks that class, and
              // `#root input` outranks `#root *` so fields keep their caret.
              "#root,#root *{-webkit-user-select:none;user-select:none;}" +
              "#root input,#root textarea{-webkit-user-select:text;user-select:text;}" +
              // Keyboard focus, drawn by the app rather than left to the UA.
              //
              // `palette.focus` existed and reached exactly one control — a
              // text field's active border — so every button, row, card, tab
              // and table cell fell back to the browser's own ring: a colour
              // from no palette here, and one that `Card`'s `overflow:hidden`
              // clipped on the first and last row of every card.
              //
              // `:focus-visible` and not `:focus`, so a mouse press never
              // draws it; the browser is the only party that knows which
              // device moved focus. The offset is NEGATIVE so the ring is
              // painted inside its own box and cannot be clipped by an
              // ancestor that hides overflow. Reduced-transparency and
              // high-contrast users get the same ring; it is not decorative.
              "#root :focus-visible{outline:2px solid var(--helix-focus,#3C6F96);outline-offset:-2px;}" +
              // react-native-web sets `outline:none` on its own pressables in
              // some paths; this restores the ring for the elements that
              // actually take focus without touching anything else.
              "#root [tabindex]:focus-visible,#root [role=button]:focus-visible,#root [role=tab]:focus-visible," +
              "#root a:focus-visible,#root input:focus-visible,#root textarea:focus-visible," +
              "#root select:focus-visible{outline:2px solid var(--helix-focus,#3C6F96);outline-offset:-2px;}" +
              // Theme and palette changes cross-fade the real pixels through
              // the View Transitions API (see `ui/theme-transition.ts`). The
              // browser default is a 250ms fade; half a second reads as a
              // deliberate change of light rather than a repaint. Both layers
              // are drawn at once — the default `-old` on top would darken the
              // midpoint on a light-to-dark change.
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
      </head>
      <body>{children}</body>
    </html>
  );
}
