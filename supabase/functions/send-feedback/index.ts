/**
 * Turn a feedback report into an email to the owner (spec §4.1).
 *
 * This runs on Supabase Edge Functions (Deno), not in the app bundle, for two
 * reasons that both matter:
 *
 *   - the mail account's app password must never reach a client. The web build
 *     is a static export served from GitHub Pages, so anything the client holds
 *     is public;
 *   - the app is offline-first and its CSP pins `connect-src` to a short list.
 *     The Supabase origin is already on that list, so calling our own function
 *     needs no CSP change, while calling a mail provider directly would.
 *
 * It trusts nothing the client sends. The same rules `src/domain/feedback.ts`
 * states are re-checked here, because the client that posts is the one thing a
 * server may not assume is the client we shipped.
 *
 * Deployment (owner, once):
 *   supabase secrets set SMTP_USER=<gmail address> SMTP_PASS=<app password>
 *   supabase functions deploy send-feedback
 */

// Remote module specifiers, which is how Deno imports. `tsconfig.json` and
// `eslint.config.js` both exclude this directory precisely so the app's
// toolchain never tries to resolve them — which is also why there is no
// `@ts-expect-error` here: under Deno the imports resolve fine, and the
// directive itself became the only error `deno check` reported.
import { feedbackSubject } from "./subject.ts";
// Exact versions, the client's own supabase-js among them: nothing locks or
// audits what Deno fetches here, so a range would be whatever the registry
// served on the day of the deploy.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";
import nodemailer from "npm:nodemailer@9.1.1";

const OWNER_EMAIL = "topraksavli@hotmail.com";

/**
 * One mail account sends everything Helix sends: Auth's reset and
 * confirmation messages through the project's custom SMTP setting, and this
 * report through the same account here. Gmail, because the project owns no
 * domain, and every provider that sends to arbitrary addresses wants one.
 *
 * Port 465 with implicit TLS is not a preference. Edge Functions refuse
 * outgoing connections to 25 and 587, which leaves 465 as Gmail's only open
 * door. Gmail also rewrites any `from` that is not the signed-in account, so
 * the sender is the account itself and the reporter goes in `replyTo`, the
 * field a reply actually uses. `SMTP_HOST` exists so a later move to a domain
 * and a transactional provider changes a secret rather than this file.
 */
const SMTP_PORT = 465;
const FROM_NAME = "Helix Geri Bildirim";

const FEEDBACK_CATEGORIES = [
  "visual", "functional", "performance", "data", "suggestion", "other",
] as const;
const FEEDBACK_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;
const FEEDBACK_MESSAGE_MIN = 10;
const FEEDBACK_MESSAGE_MAX = 4000;
const MAX_FEEDBACK_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FEEDBACK_IMAGES = 4;
const MAX_FEEDBACK_TOTAL_IMAGE_BYTES = 7 * 1024 * 1024;

/** Base64 carries 3 bytes in every 4 characters, so the decoded bound is 4/3. */
const BASE64_LENGTH_RATIO = 4 / 3;
const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_FEEDBACK_IMAGE_BYTES * BASE64_LENGTH_RATIO) + 4;
const MAX_TOTAL_BASE64_LENGTH = Math.ceil(MAX_FEEDBACK_TOTAL_IMAGE_BYTES * BASE64_LENGTH_RATIO) + 16;

const CATEGORY_LABEL: Record<string, string> = {
  visual: "Görsel hata",
  functional: "Çalışmayan özellik",
  performance: "Yavaşlık",
  data: "Yanlış veri veya hesap",
  suggestion: "Öneri",
  other: "Diğer",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** HTML-escape, because the message is a person's prose going into an email. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]*={0,2}$/.test(value) && value.length % 4 === 0;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const smtpUser = Deno.env.get("SMTP_USER");
  const smtpPass = Deno.env.get("SMTP_PASS");
  if (!smtpUser || !smtpPass) return json({ error: "not_configured" }, 503);

  /**
   * Only a signed-in account may post. The function runs with the caller's own
   * bearer token rather than the service role, so an anonymous or expired
   * session is rejected by Supabase itself rather than by a check here.
   */
  const authorization = request.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authorization } } },
  );
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json({ error: "unauthorized" }, 401);

  /**
   * One send, claimed before anything is read.
   *
   * The limit lives in the database (migration 37) rather than here: this
   * function is a public HTTP endpoint, so a bound it enforced in its own
   * memory would last exactly as long as one isolate and would be shared by
   * none of them. The RPC counts and records in one statement under the
   * caller's own identity, and the table it writes is unreachable by any
   * other path.
   *
   * Claimed BEFORE the body is parsed and the attachments are decoded, so a
   * caller who is already over the limit cannot make this function do the
   * expensive part anyway. The cost of that is that a report refused later for
   * being malformed still spends its slot, which is the right way round: a
   * client sending malformed bodies at speed is exactly what the limit is for.
   */
  const { data: allowed, error: limitError } = await supabase.rpc("record_feedback_send");
  if (limitError) {
    console.error("feedback rate check failed", limitError.code ?? limitError.message);
    return json({ error: "send_failed" }, 502);
  }
  if (allowed !== true) return json({ error: "rate_limited" }, 429);

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const category = String(payload.category ?? "");
  if (!(FEEDBACK_CATEGORIES as readonly string[]).includes(category)) {
    return json({ error: "invalid_category" }, 400);
  }

  const message = String(payload.message ?? "").trim();
  if (message.length < FEEDBACK_MESSAGE_MIN || message.length > FEEDBACK_MESSAGE_MAX) {
    return json({ error: "invalid_message" }, 400);
  }

  const platform = String(payload.platform ?? "bilinmiyor").slice(0, 40);
  const appVersion = String(payload.appVersion ?? "bilinmiyor").slice(0, 40);

  /**
   * Screenshots, plural.
   *
   * A single `image` was the shape this function shipped with; a client on an
   * older build may still send it, so both are accepted and normalised to one
   * list before anything is checked. Nothing here trusts the count, the size or
   * the encoding the client claims.
   */
  const rawImages: unknown[] = Array.isArray(payload.images)
    ? payload.images
    : payload.image
      ? [payload.image]
      : [];
  if (rawImages.length > MAX_FEEDBACK_IMAGES) return json({ error: "too_many_images" }, 400);

  const attachments: { filename: string; content: string; encoding: "base64"; contentType: string }[] = [];
  let totalBase64 = 0;
  for (const entry of rawImages) {
    const image = entry as { mimeType?: unknown; base64?: unknown; filename?: unknown };
    const mimeType = String(image?.mimeType ?? "");
    const base64 = String(image?.base64 ?? "");
    if (!(FEEDBACK_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
      return json({ error: "invalid_image_type" }, 400);
    }
    // Bound the STRING before decoding it: the point of the limit is to refuse
    // an oversized body without first allocating it.
    if (base64.length === 0 || base64.length > MAX_IMAGE_BASE64_LENGTH || !isBase64(base64)) {
      return json({ error: "invalid_image" }, 400);
    }
    totalBase64 += base64.length;
    if (totalBase64 > MAX_TOTAL_BASE64_LENGTH) return json({ error: "images_too_large" }, 400);
    const extension = mimeType.split("/")[1] ?? "png";
    const rawName = String(image?.filename ?? "").replace(/[^\w.-]/g, "").slice(0, 60);
    const fallbackName = `ekran-goruntusu-${attachments.length + 1}.${extension}`;
    const name = rawName || fallbackName;
    // Two screenshots a phone named the same thing still arrive as two files a
    // mail client can tell apart.
    attachments.push({
      filename: attachments.some((existing) => existing.filename === name) ? `${attachments.length + 1}-${name}` : name,
      content: base64,
      encoding: "base64",
      contentType: mimeType,
    });
  }

  // Categories carry a colour the owner can scan an inbox by: a broken screen
  // and a suggestion should not look the same at a glance. Inline styles and
  // tables only — mail clients drop <style> blocks and flexbox.
  const CATEGORY_TONE: Record<string, { bg: string; fg: string; mark: string }> = {
    visual: { bg: "#EED8CC", fg: "#7B3A28", mark: "🎨" },
    functional: { bg: "#F6D5D1", fg: "#8A2A22", mark: "🛠️" },
    performance: { bg: "#EDDFC5", fg: "#775624", mark: "⏱️" },
    data: { bg: "#F6D5D1", fg: "#8A2A22", mark: "📊" },
    suggestion: { bg: "#E2E1C9", fg: "#555937", mark: "💡" },
    other: { bg: "#E7DFD7", fg: "#3A3028", mark: "💬" },
  };
  const tone = CATEGORY_TONE[category] ?? CATEGORY_TONE.other;
  const sentAt = new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "long", timeStyle: "short", timeZone: "Europe/Istanbul",
  }).format(new Date());
  const font = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const serif = "'IBM Plex Serif', Georgia, 'Times New Roman', serif";
  const metaRow = (label: string, value: string) => `
    <tr>
      <td style="padding:7px 0; font-family:${font}; font-size:13px; color:#6D6157; width:96px; vertical-align:top;">${label}</td>
      <td style="padding:7px 0; font-family:${font}; font-size:14px; color:#2A211B; vertical-align:top;">${value}</td>
    </tr>`;
  const reporter = escapeHtml(user.email ?? user.id);

  const html = `<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0; padding:0; background-color:#F1EDE8;">
  <div style="display:none; max-height:0; overflow:hidden; font-size:1px; color:#F1EDE8;">${escapeHtml(message.slice(0, 120))}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#F1EDE8;">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;">
        <tr><td align="center" style="padding:0 0 18px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
            <td width="36" height="36" align="center" valign="middle" style="width:36px; height:36px; background-color:#A55335; border-radius:10px; font-family:${serif}; font-size:20px; font-weight:600; line-height:36px; color:#FBF4EF;">H</td>
            <td style="padding-left:10px; font-family:${serif}; font-size:20px; font-weight:600; color:#2A211B;">Helix <span style="font-family:${font}; font-size:13px; font-weight:500; color:#6D6157;">· Geri bildirim</span></td>
          </tr></table>
        </td></tr>
        <tr><td style="background-color:#FFFDFB; border:1px solid #E7DFD7; border-radius:18px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr><td style="height:6px; line-height:6px; font-size:0; background-color:#A55335; border-radius:18px 18px 0 0;">&nbsp;</td></tr>
            <tr><td style="padding:28px 32px 0 32px;">
              <span style="display:inline-block; padding:6px 12px; border-radius:999px; background-color:${tone.bg}; color:${tone.fg}; font-family:${font}; font-size:13px; font-weight:600;">${tone.mark}&nbsp; ${escapeHtml(CATEGORY_LABEL[category] ?? category)}</span>
              <h1 style="margin:16px 0 0 0; font-family:${serif}; font-size:24px; line-height:30px; font-weight:600; color:#2A211B;">Yeni bir geri bildirim geldi</h1>
            </td></tr>
            <tr><td style="padding:20px 32px 0 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#F7F3EF; border-left:4px solid #A55335; border-radius:10px;">
                <tr><td style="padding:18px 20px; font-family:${font}; font-size:16px; line-height:26px; color:#2A211B; white-space:pre-wrap;">${escapeHtml(message)}</td></tr>
              </table>
            </td></tr>
            <tr><td style="padding:22px 32px 0 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #E7DFD7;">
                ${metaRow("Gönderen", `<a href="mailto:${reporter}" style="color:#A55335; text-decoration:none;">${reporter}</a>`)}
                ${metaRow("Tarih", escapeHtml(sentAt))}
                ${metaRow("Cihaz", `${escapeHtml(platform)} · sürüm ${escapeHtml(appVersion)}`)}
                ${metaRow("Ekler", attachments.length === 0 ? "Ekran görüntüsü yok" : `📎 ${attachments.length} ekran görüntüsü`)}
              </table>
            </td></tr>
            <tr><td style="padding:22px 32px 30px 32px; font-family:${font}; font-size:13px; line-height:20px; color:#62564C;">
              ↩️ Bu maili yanıtladığında cevabın doğrudan <strong style="color:#3A3028;">${reporter}</strong> adresine gider.
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:18px 16px 4px 16px; font-family:${font}; font-size:12px; color:#6D6157;">Helix uygulamasındaki Geri Bildirim ekranından gönderildi.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const transport = nodemailer.createTransport({
    host: Deno.env.get("SMTP_HOST") ?? "smtp.gmail.com",
    port: SMTP_PORT,
    secure: true,
    auth: { user: smtpUser, pass: smtpPass },
    // Inside the function's wall clock, with room to answer the client.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  try {
    await transport.sendMail({
      from: { name: FROM_NAME, address: smtpUser },
      to: OWNER_EMAIL,
      replyTo: user.email ?? undefined,
      subject: feedbackSubject(category, message),
      html,
      attachments,
    });
  } catch (error) {
    // The server's reply can quote the reporter's own text back; log the codes
    // only, and tell the client nothing it could not already infer.
    const failure = error as { code?: string; responseCode?: number };
    console.error("smtp rejected the report", failure.code ?? "unknown", failure.responseCode ?? "");
    return json({ error: "send_failed" }, 502);
  }

  return json({ ok: true }, 200);
});
