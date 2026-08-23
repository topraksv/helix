/**
 * Turn a feedback report into an email to the owner (spec §4.1).
 *
 * This runs on Supabase Edge Functions (Deno), not in the app bundle, for two
 * reasons that both matter:
 *
 *   - the Resend API key must never reach a client. The web build is a static
 *     export served from GitHub Pages, so anything the client holds is public;
 *   - the app is offline-first and its CSP pins `connect-src` to a short list.
 *     The Supabase origin is already on that list, so calling our own function
 *     needs no CSP change, while calling a mail provider directly would.
 *
 * It trusts nothing the client sends. The same rules `src/domain/feedback.ts`
 * states are re-checked here, because the client that posts is the one thing a
 * server may not assume is the client we shipped.
 *
 * Deployment (owner, once):
 *   supabase secrets set RESEND_API_KEY=...
 *   supabase functions deploy send-feedback
 */

// A remote module specifier, which is how Deno imports. `tsconfig.json` and
// `eslint.config.js` both exclude this directory precisely so the app's
// toolchain never tries to resolve it — which is also why there is no
// `@ts-expect-error` here: under Deno the import resolves fine, and the
// directive itself became the only error `deno check` reported.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OWNER_EMAIL = "topraksavli@hotmail.com";

/**
 * Resend refuses an unverified `from` domain, and this project owns none — so
 * the report is sent from Resend's shared sandbox sender and carries the
 * reporter's address in `reply_to`, which is the field a reply actually uses.
 */
const FROM_ADDRESS = "Helix Geri Bildirim <onboarding@resend.dev>";

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

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json({ error: "not_configured" }, 503);

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

  const attachments: { filename: string; content: string }[] = [];
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
    // Resend keys attachments by filename; two screenshots a phone named the
    // same thing would otherwise arrive as one.
    attachments.push({
      filename: attachments.some((existing) => existing.filename === name) ? `${attachments.length + 1}-${name}` : name,
      content: base64,
    });
  }

  const subjectSummary = message.replace(/\s+/g, " ").slice(0, 60);
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55">
      <p style="margin:0 0 4px"><strong>Kategori:</strong> ${escapeHtml(CATEGORY_LABEL[category] ?? category)}</p>
      <p style="margin:0 0 4px"><strong>Gönderen:</strong> ${escapeHtml(user.email ?? user.id)}</p>
      <p style="margin:0 0 4px"><strong>Platform:</strong> ${escapeHtml(platform)} · <strong>Sürüm:</strong> ${escapeHtml(appVersion)}</p>
      <p style="margin:0 0 4px"><strong>Tarih:</strong> ${new Date().toISOString()}</p>
      <p style="margin:0 0 16px"><strong>Ek:</strong> ${attachments.length} görsel</p>
      <hr style="border:0;border-top:1px solid #ddd;margin:0 0 16px" />
      <p style="white-space:pre-wrap;margin:0">${escapeHtml(message)}</p>
    </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [OWNER_EMAIL],
      reply_to: user.email ? [user.email] : undefined,
      subject: `[Helix/${category}] ${subjectSummary}`,
      html,
      attachments: attachments.length > 0 ? attachments : undefined,
    }),
  });

  if (!response.ok) {
    // The provider's body can carry the reporter's own text back; log the
    // status only, and tell the client nothing it could not already infer.
    console.error("resend rejected the report", response.status);
    return json({ error: "send_failed" }, 502);
  }

  return json({ ok: true }, 200);
});
