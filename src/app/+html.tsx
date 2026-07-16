import { ScrollViewStyleReset } from "expo-router/html";
import { type PropsWithChildren } from "react";
import { tr } from "../i18n/tr";

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
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, shrink-to-fit=no, viewport-fit=cover"
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
              "*{box-sizing:border-box;}",
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
