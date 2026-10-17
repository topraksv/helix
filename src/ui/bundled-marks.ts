/**
 * Marks shipped with the app, for the domains whose favicon no service has at
 * a size that stays sharp in a 46pt tile on a 3x screen (138px). The owner
 * rejected pixelated logos; a soft 16px mark from Google is what these replace.
 *
 * Each file is 144px WebP, rendered in Chromium from the best source found —
 * the brand's App Store icon, its site's manifest icon or header logo, Simple
 * Icons, Wikimedia Commons — and, where only a raster lockup existed, traced to
 * vectors first. A mark that is a bare wordmark or symbol sits on a plate of its
 * own brand colour or white, so dark mode never puts navy ink on near-black.
 *
 * `bleed` marks fill the tile edge to edge: they are app icons whose corners are
 * opaque, and shrinking them to the favicon fill would frame them twice.
 */
export const BUNDLED_MARKS: Record<string, { source: number; bleed: boolean }> = {
  "akbank.com.tr": { source: require("../../assets/marks/akbank.com.tr.webp"), bleed: true }, // site logo
  "albaraka.com.tr": { source: require("../../assets/marks/albaraka.com.tr.webp"), bleed: true }, // App Store icon
  "amazon.com": { source: require("../../assets/marks/amazon.com.webp"), bleed: true }, // App Store icon
  "anadolubank.com.tr": { source: require("../../assets/marks/anadolubank.com.tr.webp"), bleed: true }, // App Store icon
  "apple.com": { source: require("../../assets/marks/apple.com.webp"), bleed: true }, // site icon
  "atlassian.com": { source: require("../../assets/marks/atlassian.com.webp"), bleed: false }, // site icon
  "axess.com.tr": { source: require("../../assets/marks/axess.com.tr.webp"), bleed: true }, // site logo
  "bankkart.com.tr": { source: require("../../assets/marks/bankkart.com.tr.webp"), bleed: true }, // App Store icon
  "bkm.com.tr": { source: require("../../assets/marks/bkm.com.tr.webp"), bleed: true }, // traced from the site logo
  "blinkist.com": { source: require("../../assets/marks/blinkist.com.webp"), bleed: true }, // App Store icon
  "cloudflare.com": { source: require("../../assets/marks/cloudflare.com.webp"), bleed: true }, // Simple Icons (CC0)
  "crunchyroll.com": { source: require("../../assets/marks/crunchyroll.com.webp"), bleed: true }, // App Store icon
  "digiturk.com.tr": { source: require("../../assets/marks/digiturk.com.tr.webp"), bleed: true }, // site logo
  "drive.google.com": { source: require("../../assets/marks/drive.google.com.webp"), bleed: true }, // App Store icon
  "dropbox.com": { source: require("../../assets/marks/dropbox.com.webp"), bleed: true }, // App Store icon
  "dsmart.com.tr": { source: require("../../assets/marks/dsmart.com.tr.webp"), bleed: true }, // site logo
  "enpara.com": { source: require("../../assets/marks/enpara.com.webp"), bleed: true }, // site logo
  "epicgames.com": { source: require("../../assets/marks/epicgames.com.webp"), bleed: true }, // App Store icon
  "evernote.com": { source: require("../../assets/marks/evernote.com.webp"), bleed: false }, // site icon
  "gain.tv": { source: require("../../assets/marks/gain.tv.webp"), bleed: true }, // App Store icon
  "grammarly.com": { source: require("../../assets/marks/grammarly.com.webp"), bleed: true }, // App Store icon
  "headspace.com": { source: require("../../assets/marks/headspace.com.webp"), bleed: true }, // App Store icon
  "hepsiburada.com": { source: require("../../assets/marks/hepsiburada.com.webp"), bleed: true }, // App Store icon
  "ing.com.tr": { source: require("../../assets/marks/ing.com.tr.webp"), bleed: true }, // App Store icon
  "ininal.com": { source: require("../../assets/marks/ininal.com.webp"), bleed: true }, // site logo
  "isbank.com.tr": { source: require("../../assets/marks/isbank.com.tr.webp"), bleed: true }, // App Store icon
  "iyzico.com": { source: require("../../assets/marks/iyzico.com.webp"), bleed: true }, // App Store icon
  "kaspersky.com": { source: require("../../assets/marks/kaspersky.com.webp"), bleed: true }, // App Store icon
  "lastpass.com": { source: require("../../assets/marks/lastpass.com.webp"), bleed: true }, // App Store icon
  "linkedin.com": { source: require("../../assets/marks/linkedin.com.webp"), bleed: true }, // App Store icon
  "marti.tech": { source: require("../../assets/marks/marti.tech.webp"), bleed: true }, // App Store icon
  "maximum.com.tr": { source: require("../../assets/marks/maximum.com.tr.webp"), bleed: true }, // site logo
  "microsoft365.com": { source: require("../../assets/marks/microsoft365.com.webp"), bleed: true }, // App Store icon
  "muud.com.tr": { source: require("../../assets/marks/muud.com.tr.webp"), bleed: true }, // App Store icon
  "netflix.com": { source: require("../../assets/marks/netflix.com.webp"), bleed: true }, // App Store icon
  "nkolay.com.tr": { source: require("../../assets/marks/nkolay.com.tr.webp"), bleed: true }, // App Store icon
  "odeabank.com.tr": { source: require("../../assets/marks/odeabank.com.tr.webp"), bleed: true }, // raster inside the site logo
  "office.com": { source: require("../../assets/marks/microsoft365.com.webp"), bleed: true }, // microsoft365.com's mark
  "one.google.com": { source: require("../../assets/marks/one.google.com.webp"), bleed: true }, // App Store icon
  "param.com.tr": { source: require("../../assets/marks/param.com.tr.webp"), bleed: true }, // App Store icon
  "qnb.com.tr": { source: require("../../assets/marks/qnb.com.tr.webp"), bleed: true }, // Wikimedia Commons, public domain
  "scribd.com": { source: require("../../assets/marks/scribd.com.webp"), bleed: true }, // App Store icon
  "sekerbank.com.tr": { source: require("../../assets/marks/sekerbank.com.tr.webp"), bleed: true }, // App Store icon
  "slack.com": { source: require("../../assets/marks/slack.com.webp"), bleed: true }, // App Store icon
  "sokmarket.com.tr": { source: require("../../assets/marks/sokmarket.com.tr.webp"), bleed: true }, // App Store icon
  "spotify.com": { source: require("../../assets/marks/spotify.com.webp"), bleed: false }, // site manifest icon
  "superonline.net": { source: require("../../assets/marks/turkcell.com.tr.webp"), bleed: true }, // turkcell.com.tr's mark
  "tbank.com.tr": { source: require("../../assets/marks/tbank.com.tr.webp"), bleed: true }, // traced from the site logo
  "teb.com.tr": { source: require("../../assets/marks/teb.com.tr.webp"), bleed: true }, // App Store icon
  "tidal.com": { source: require("../../assets/marks/tidal.com.webp"), bleed: true }, // Simple Icons (CC0)
  "tivibu.com.tr": { source: require("../../assets/marks/tivibu.com.tr.webp"), bleed: true }, // App Store icon
  "todoist.com": { source: require("../../assets/marks/todoist.com.webp"), bleed: false }, // site manifest icon
  "troyodeme.com": { source: require("../../assets/marks/troyodeme.com.webp"), bleed: true }, // site manifest icon
  "turkcell.com.tr": { source: require("../../assets/marks/turkcell.com.tr.webp"), bleed: true }, // App Store icon
  "turktelekom.com.tr": { source: require("../../assets/marks/turktelekom.com.tr.webp"), bleed: true }, // App Store icon
  "twitch.tv": { source: require("../../assets/marks/twitch.tv.webp"), bleed: true }, // site icon
  "vakifbank.com.tr": { source: require("../../assets/marks/vakifbank.com.tr.webp"), bleed: true }, // App Store icon
  "visa.com.tr": { source: require("../../assets/marks/visa.com.tr.webp"), bleed: true }, // Simple Icons (CC0)
  "whatsapp.com": { source: require("../../assets/marks/whatsapp.com.webp"), bleed: true }, // App Store icon
  "wings.com.tr": { source: require("../../assets/marks/wings.com.tr.webp"), bleed: true }, // site icon
  "worldcard.com.tr": { source: require("../../assets/marks/worldcard.com.tr.webp"), bleed: true }, // App Store icon
  "ziraatbank.com.tr": { source: require("../../assets/marks/ziraatbank.com.tr.webp"), bleed: true }, // App Store icon
  "ziraatkatilim.com.tr": { source: require("../../assets/marks/ziraatkatilim.com.tr.webp"), bleed: false }, // site manifest icon
  "zoom.us": { source: require("../../assets/marks/zoom.us.webp"), bleed: true }, // App Store icon
};
