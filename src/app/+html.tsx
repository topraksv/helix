import { ScrollViewStyleReset } from "expo-router/html";
import { type PropsWithChildren } from "react";
import { tr } from "../i18n/tr";
import { trustedSupabaseOrigin } from "../domain/web-security";

const supabaseOrigin = trustedSupabaseOrigin(process.env.EXPO_PUBLIC_SUPABASE_URL);

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
            // falls back to the local chip. icons.duckduckgo.com serves the
            // five domains it measured better than Google (see
            // `src/domain/brand-marks.ts`) and answers directly, no redirect.
            "img-src 'self' data: blob: https://www.google.com https://*.gstatic.com https://icons.duckduckgo.com",
            "font-src 'self' data:",
            `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""} https://open.er-api.com wss://hrmsocketonly.haremaltin.com`,
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
        {/* Tab title comes from expo-router <Head> in _layout.tsx. */}
        <meta
          name="description"
          content={tr.meta.description}
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
