/**
 * What each favicon service actually returns for every domain `logo.tsx` names.
 *
 * Evidence, not runtime data. `brand-marks.ts` carries the one conclusion the
 * app acts on — the handful of domains DuckDuckGo serves better — and this
 * file carries the measurements that conclusion was drawn from, so the app's
 * web bundle does not ship 7KB of hashes no screen ever reads.
 * `tests/brand-domains.test.ts` and `scripts/audit-brand-marks.mjs` are its
 * only readers.
 *
 * `sz=256` in the Google URL is not a resize instruction. Measured, the
 * service returns the best size the site publishes and never upscales, so
 * asking for more than the site has costs nothing and asking for less would
 * throw detail away.
 *
 * Re-run `scripts/audit-brand-marks.mjs` to refresh it. A domain that has
 * since stopped publishing a mark shows up as a failing test rather than as a
 * grey globe in someone's payment list.
 */

import type { MarkProvider } from "./brand-marks";

/**
 * The best mark found for a domain: how wide it is, who serves it, and the
 * first twelve hex of its SHA-256.
 *
 * The hash is what catches a brand wearing another brand's logo, which no size
 * check can see. `naysapp.com.tr` returned İş Bankası's file byte for byte, so
 * a person who chose Nays saw a different institution's mark; the hash makes
 * that a listed collision instead of a thing nobody noticed. Three collisions
 * are real and stay: Advantage is HSBC's card programme, BluTV became Max in
 * Turkey, and Microsoft 365 is Office.
 */
export type BrandMark = { px: number; provider: MarkProvider; sha: string };

/**
 * What each service sends for a domain it has never indexed: Google a 16x16
 * 726-byte grey globe, DuckDuckGo a 48x48 grey letter tile. Both are valid
 * images, so a browser's `<img>` draws them whatever the status line said,
 * while native falls back correctly — one wrong picture, and two different
 * ones on the two platforms.
 *
 * The DuckDuckGo tile is the more dangerous of the two because it is larger
 * than most genuine marks: scored on pixels alone it beats the real thing.
 * `scripts/audit-brand-marks.mjs` scores both as nothing, which is why a
 * domain that gets only these ends up in `UNMARKED_INSTITUTIONS` rather than
 * in a table.
 */
export const PLACEHOLDER_MARK_SHA = ["59bfe9bc385a", "e5db88ea2322"] as const;

/** The best available mark per domain, by measurement. */
export const BRAND_MARK_AUDIT: Record<string, BrandMark> = {
  "1password.com": { px: 180, provider: "google", sha: "46f310796fcb" },
  "a101.com.tr": { px: 128, provider: "google", sha: "6127cf7587c2" },
  "adabank.com.tr": { px: 16, provider: "google", sha: "cc8ae67d64f1" },
  "adobe.com": { px: 180, provider: "google", sha: "8359fa4d7fc4" },
  "advantage.com.tr": { px: 196, provider: "google", sha: "a7bc07e89437" },
  "akbank.com.tr": { px: 32, provider: "google", sha: "e676ccaa3b78" },
  "aktifbank.com.tr": { px: 152, provider: "google", sha: "58401b582048" },
  "albaraka.com.tr": { px: 48, provider: "google", sha: "45a4e2d456d1" },
  "alternatifbank.com.tr": { px: 152, provider: "iconhorse", sha: "4f09f18d0139" },
  "amazon.com": { px: 48, provider: "google", sha: "7e67fb8e6c43" },
  "anadolubank.com.tr": { px: 64, provider: "duckduckgo", sha: "93cb66b41198" },
  "anthropic.com": { px: 256, provider: "google", sha: "b1f8535fdf5a" },
  "apple.com": { px: 64, provider: "google", sha: "eb7f4b32c3d7" },
  "atlassian.com": { px: 48, provider: "google", sha: "9f049b383d89" },
  "audible.com": { px: 192, provider: "google", sha: "e7ba1901b03a" },
  "axess.com.tr": { px: 48, provider: "google", sha: "82d51ecef4ac" },
  "bankkart.com.tr": { px: 48, provider: "google", sha: "2d5b0c473de6" },
  "beinconnect.com.tr": { px: 180, provider: "google", sha: "f6e45955b34e" },
  "bim.com.tr": { px: 256, provider: "google", sha: "f33468852a12" },
  "bitwarden.com": { px: 256, provider: "google", sha: "2cb748006922" },
  "bkm.com.tr": { px: 16, provider: "google", sha: "a4644dba0e3c" },
  "bkmexpress.com.tr": { px: 192, provider: "google", sha: "eb2d118aeca7" },
  "blinkist.com": { px: 16, provider: "google", sha: "8352c7ec6d3a" },
  "blutv.com": { px: 196, provider: "google", sha: "0bdfd009549f" },
  "bolt.eu": { px: 256, provider: "google", sha: "650779651cd6" },
  "bonus.com.tr": { px: 44, provider: "google", sha: "8fe9b8bcfabe" },
  "booking.com": { px: 256, provider: "google", sha: "bfe6b748eccd" },
  "bumble.com": { px: 180, provider: "google", sha: "869e305ab594" },
  "burgan.com.tr": { px: 192, provider: "iconhorse", sha: "fd63c1f15e8a" },
  "calm.com": { px: 256, provider: "google", sha: "271c1741fd3f" },
  "canva.com": { px: 180, provider: "google", sha: "e594c19501bd" },
  "cardfinans.com.tr": { px: 256, provider: "google", sha: "ce9df18af9ca" },
  "carrefoursa.com": { px: 152, provider: "google", sha: "c1ce9d2b394b" },
  "claude.ai": { px: 248, provider: "google", sha: "d3b0828f7050" },
  "cloudflare.com": { px: 99, provider: "google", sha: "9cd748335f60" },
  "colendi.com": { px: 134, provider: "google", sha: "a349bb62cd4c" },
  "coursera.org": { px: 194, provider: "iconhorse", sha: "5fb454fbf3ee" },
  "crunchyroll.com": { px: 120, provider: "google", sha: "302312c2c33c" },
  "cursor.com": { px: 256, provider: "google", sha: "9b8f6b31011b" },
  "deezer.com": { px: 240, provider: "iconhorse", sha: "d01b2dd9d705" },
  "digiturk.com.tr": { px: 256, provider: "iconhorse", sha: "440b2a85b4a4" },
  "discord.com": { px: 256, provider: "google", sha: "439d4394c97f" },
  "disneyplus.com": { px: 180, provider: "google", sha: "b58d06685518" },
  "drive.google.com": { px: 32, provider: "iconhorse", sha: "16640c06f624" },
  "dropbox.com": { px: 32, provider: "google", sha: "ad716eb686f0" },
  "dsmart.com.tr": { px: 16, provider: "google", sha: "6d99ec1565b2" },
  "duolingo.com": { px: 180, provider: "google", sha: "fa7acc1c24e7" },
  "ea.com": { px: 256, provider: "iconhorse", sha: "f91662fcf936" },
  "enpara.com": { px: 64, provider: "google", sha: "5184739e5cef" },
  "epicgames.com": { px: 48, provider: "google", sha: "8d0eff1ea31e" },
  "evernote.com": { px: 32, provider: "google", sha: "9b7ab9023325" },
  "expressvpn.com": { px: 152, provider: "google", sha: "75ab8626903d" },
  "exxen.com": { px: 200, provider: "google", sha: "1747cdc012ce" },
  "fibabanka.com.tr": { px: 180, provider: "google", sha: "e5010c972f9b" },
  "figma.com": { px: 256, provider: "google", sha: "83361d722cc6" },
  "fizy.com": { px: 180, provider: "google", sha: "0c2eb91d3965" },
  "gain.tv": { px: 48, provider: "google", sha: "d446a38b8fd5" },
  "garantibbva.com.tr": { px: 180, provider: "google", sha: "5d6190a2bbf3" },
  "gemini.google.com": { px: 512, provider: "duckduckgo", sha: "5e7cfecaa53f" },
  "getir.com": { px: 180, provider: "google", sha: "864ab110fa57" },
  "getirfinans.com": { px: 192, provider: "google", sha: "d7446cc9937d" },
  "github.com": { px: 512, provider: "iconhorse", sha: "1bedd6a19489" },
  "google.com": { px: 144, provider: "google", sha: "4befa9a14ca9" },
  "grammarly.com": { px: 48, provider: "google", sha: "938a776c9fe8" },
  "halkbank.com.tr": { px: 180, provider: "iconhorse", sha: "1eadc7d13050" },
  "headspace.com": { px: 32, provider: "google", sha: "316b61c8bb0d" },
  "hepsiburada.com": { px: 48, provider: "iconhorse", sha: "9fe6cd74a293" },
  "hsbc.com.tr": { px: 196, provider: "google", sha: "a7bc07e89437" },
  "icbc.com.tr": { px: 16, provider: "google", sha: "5da2fad09a79" },
  "icloud.com": { px: 180, provider: "google", sha: "3beac2c87756" },
  "ing.com.tr": { px: 57, provider: "duckduckgo", sha: "68adfa341331" },
  "ininal.com": { px: 32, provider: "google", sha: "42829a02d4e6" },
  "instagram.com": { px: 180, provider: "google", sha: "ef3538f3cc49" },
  "isbank.com.tr": { px: 57, provider: "google", sha: "bdde5c78236e" },
  "iyzico.com": { px: 96, provider: "google", sha: "8a9de46d2bd6" },
  "kaspersky.com": { px: 16, provider: "google", sha: "00918943e335" },
  "kuveytturk.com.tr": { px: 32, provider: "google", sha: "19ebddc329c3" },
  "lastpass.com": { px: 64, provider: "google", sha: "c5ad7e7a1279" },
  "linkedin.com": { px: 64, provider: "google", sha: "eda6fe05a863" },
  "macfit.com.tr": { px: 192, provider: "google", sha: "4e672f5c2728" },
  "malwarebytes.com": { px: 192, provider: "google", sha: "bd694e4063cf" },
  "marti.tech": { px: 32, provider: "google", sha: "1439afef96bd" },
  "mastercard.com.tr": { px: 180, provider: "google", sha: "d865e11e64a4" },
  "max.com": { px: 196, provider: "google", sha: "0bdfd009549f" },
  "maximiles.com.tr": { px: 192, provider: "iconhorse", sha: "333d9555f304" },
  "maximum.com.tr": { px: 48, provider: "google", sha: "675247f5d4e9" },
  "medium.com": { px: 180, provider: "google", sha: "f02c809652f2" },
  "mega.nz": { px: 256, provider: "google", sha: "33d4ce7fbf42" },
  "meta.com": { px: 180, provider: "google", sha: "595972e8a42f" },
  "microsoft.com": { px: 128, provider: "google", sha: "b6ba5811173d" },
  "microsoft365.com": { px: 48, provider: "google", sha: "391d10b75dd5" },
  "midjourney.com": { px: 180, provider: "google", sha: "cd52c233e2b3" },
  "migros.com.tr": { px: 152, provider: "iconhorse", sha: "b1d5b92947aa" },
  "moka.com": { px: 180, provider: "google", sha: "ad79b480e419" },
  "mubi.com": { px: 180, provider: "google", sha: "4aeca3b1b215" },
  "music.apple.com": { px: 180, provider: "google", sha: "618123f27ecf" },
  "muud.com.tr": { px: 60, provider: "google", sha: "3d1f1adaf0b3" },
  "netflix.com": { px: 64, provider: "google", sha: "330ddc5f685c" },
  "nike.com": { px: 192, provider: "google", sha: "0d6619c65975" },
  "nintendo.com": { px: 180, provider: "google", sha: "b933f4e3fc9a" },
  "nkolay.com.tr": { px: 48, provider: "google", sha: "8fa9e8939c03" },
  "nordvpn.com": { px: 180, provider: "google", sha: "843a7d64e39d" },
  "norton.com": { px: 180, provider: "google", sha: "3477c2e83343" },
  "notion.so": { px: 512, provider: "iconhorse", sha: "483846a85e43" },
  "odeabank.com.tr": { px: 16, provider: "google", sha: "68d59ea734be" },
  "office.com": { px: 48, provider: "google", sha: "391d10b75dd5" },
  "one.google.com": { px: 32, provider: "google", sha: "9a0a24405ee0" },
  "openai.com": { px: 256, provider: "iconhorse", sha: "1b78547bad2f" },
  "papara.com": { px: 256, provider: "google", sha: "f746f450516f" },
  "paraf.com.tr": { px: 256, provider: "google", sha: "746836ba36e9" },
  "param.com.tr": { px: 32, provider: "google", sha: "8cbebe19aa1f" },
  "paramountplus.com": { px: 256, provider: "google", sha: "bed630af4b66" },
  "paratika.com.tr": { px: 192, provider: "google", sha: "d4870e35416f" },
  "patreon.com": { px: 256, provider: "google", sha: "18e61865ff83" },
  "paycell.com.tr": { px: 256, provider: "google", sha: "4a48855a3409" },
  "perplexity.ai": { px: 256, provider: "google", sha: "f297b81d6575" },
  "pinterest.com": { px: 144, provider: "google", sha: "0f7c5b495c16" },
  "playstation.com": { px: 256, provider: "google", sha: "b3b0dd0ad8c2" },
  "podimo.com": { px: 192, provider: "iconhorse", sha: "a7cca11f2d2f" },
  "primevideo.com": { px: 152, provider: "google", sha: "67215ac6d68b" },
  "proton.me": { px: 180, provider: "google", sha: "024c522ecdb7" },
  "puhutv.com": { px: 192, provider: "iconhorse", sha: "a98ef8fdb8c8" },
  "qnb.com.tr": { px: 16, provider: "google", sha: "e46552b6a182" },
  "roblox.com": { px: 180, provider: "google", sha: "3270a8fc3c66" },
  "scribd.com": { px: 48, provider: "google", sha: "4cb19bdbac03" },
  "sekerbank.com.tr": { px: 16, provider: "google", sha: "faceef561669" },
  "shazam.com": { px: 180, provider: "google", sha: "4f3db738f196" },
  "sipay.com.tr": { px: 256, provider: "google", sha: "fe95995b624e" },
  "skillshare.com": { px: 256, provider: "google", sha: "9ff6bb647530" },
  "slack.com": { px: 35, provider: "google", sha: "def38d7f0e93" },
  "sokmarket.com.tr": { px: 64, provider: "duckduckgo", sha: "ef26d3a77a4e" },
  "soundcloud.com": { px: 180, provider: "google", sha: "79cf06e2acde" },
  "spotify.com": { px: 48, provider: "google", sha: "221c12256905" },
  "ssportplus.com": { px: 192, provider: "google", sha: "5ebd22536db6" },
  "steampowered.com": { px: 256, provider: "google", sha: "663b30a62613" },
  "storytel.com": { px: 180, provider: "google", sha: "d19d29b9810e" },
  "strava.com": { px: 192, provider: "iconhorse", sha: "8c02b9e60690" },
  "substack.com": { px: 64, provider: "google", sha: "5516d36a191d" },
  "superonline.net": { px: 16, provider: "google", sha: "06e44b09c025" },
  "surfshark.com": { px: 192, provider: "google", sha: "7f8c0bd73dea" },
  "tabii.com": { px: 256, provider: "google", sha: "2f983dc08e2a" },
  "tami.com.tr": { px: 192, provider: "google", sha: "ce091d9acd23" },
  "tbank.com.tr": { px: 16, provider: "google", sha: "8fe54e3dbef5" },
  "teb.com.tr": { px: 16, provider: "google", sha: "007a33f392fc" },
  "telegram.org": { px: 180, provider: "google", sha: "70a451c02e28" },
  "tidal.com": { px: 48, provider: "google", sha: "156fc04e5db0" },
  "tinder.com": { px: 180, provider: "google", sha: "d94cd72726a8" },
  "tivibu.com.tr": { px: 48, provider: "google", sha: "f78e09a7f18f" },
  "todoist.com": { px: 48, provider: "google", sha: "628d80986fbd" },
  "todtv.com.tr": { px: 256, provider: "iconhorse", sha: "aab3aec07be0" },
  "trello.com": { px: 256, provider: "google", sha: "753dc4c2a1db" },
  "trendyol.com": { px: 180, provider: "google", sha: "aa4ee5350719" },
  "troyodeme.com": { px: 48, provider: "google", sha: "962a64775376" },
  "turk.net": { px: 180, provider: "google", sha: "f10a2c74a5c7" },
  "turkcell.com.tr": { px: 16, provider: "google", sha: "b04874e25872" },
  "turkishbank.com": { px: 512, provider: "duckduckgo", sha: "da35192e2942" },
  "turktelekom.com.tr": { px: 16, provider: "google", sha: "3e03a409f0f9" },
  "tv.apple.com": { px: 180, provider: "google", sha: "152181258972" },
  "tvplus.com.tr": { px: 256, provider: "google", sha: "43a870b3fb18" },
  "twitch.tv": { px: 32, provider: "google", sha: "3f04d2286200" },
  "uber.com": { px: 180, provider: "google", sha: "b3452019f0d5" },
  "ubisoft.com": { px: 150, provider: "google", sha: "6770e15fb706" },
  "udemy.com": { px: 180, provider: "google", sha: "879ec1ef72bb" },
  "vakifbank.com.tr": { px: 16, provider: "google", sha: "35cc29e28e70" },
  "vakifkatilim.com.tr": { px: 180, provider: "google", sha: "3d6dac80a398" },
  "vercel.com": { px: 256, provider: "iconhorse", sha: "004f0e08cdba" },
  "visa.com.tr": { px: 48, provider: "google", sha: "f9e3d3ad57ae" },
  "vodafone.com.tr": { px: 180, provider: "iconhorse", sha: "fa240f949305" },
  "wetransfer.com": { px: 180, provider: "iconhorse", sha: "c3e35baef9f7" },
  "whatsapp.com": { px: 23, provider: "google", sha: "5fb89c248e8e" },
  "wings.com.tr": { px: 50, provider: "google", sha: "aaa7dc6d7f7c" },
  "worldcard.com.tr": { px: 16, provider: "google", sha: "c068ff07642f" },
  "x.com": { px: 1024, provider: "iconhorse", sha: "a83542eb0563" },
  "xbox.com": { px: 512, provider: "iconhorse", sha: "c61fe4888935" },
  "yapikredi.com.tr": { px: 180, provider: "google", sha: "c539fb2ceadc" },
  "yemeksepeti.com": { px: 256, provider: "iconhorse", sha: "cc3ebfc3b801" },
  "youtube.com": { px: 144, provider: "google", sha: "cb6adb19843b" },
  "ziraatbank.com.tr": { px: 48, provider: "google", sha: "c1fe5b49e973" },
  "ziraatkatilim.com.tr": { px: 96, provider: "google", sha: "4c5024d488d5" },
  "zoom.us": { px: 32, provider: "google", sha: "16d249967f50" },
};


