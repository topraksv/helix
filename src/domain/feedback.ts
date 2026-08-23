/**
 * What a feedback report is allowed to be (spec §4.1).
 *
 * Pure, and in the domain layer, because three parties have to agree about the
 * same rules and none of them can see the others: the form that enables its
 * send button, the service that refuses to post, and the edge function that
 * receives it and must not trust either. A rule that lives only in the form is
 * a rule a replayed request walks straight around.
 *
 * The categories are deliberately the SHARED vocabulary — they are the words
 * the person reporting and the person fixing have to mean the same thing by.
 * "Görsel hata" and "Çalışmayan özellik" are different repairs by different
 * people on different days, which is the whole reason to ask.
 */

export const FEEDBACK_CATEGORIES = [
  /** It looks wrong: alignment, colour, overlap, clipped text. */
  "visual",
  /** It does not work: a control that refuses, a screen that will not open. */
  "functional",
  /** It works but it is slow, stutters, or drains the battery. */
  "performance",
  /** The number is wrong: a total, a date, a balance, an import. */
  "data",
  /** Nothing is broken; this would be better. */
  "suggestion",
  /** None of the above, said in the person's own words. */
  "other",
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

/**
 * Short enough that "buton çalışmıyor" gets through, long enough that an
 * accidental tap on the send button does not.
 */
export const FEEDBACK_MESSAGE_MIN = 10;

/**
 * A ceiling rather than a limit anyone will meet. It exists so a paste of an
 * entire log cannot become an email nobody can open, and so the edge function
 * has a bound it can check before it allocates.
 */
export const FEEDBACK_MESSAGE_MAX = 4000;

/** Screenshots. A PDF is not what "ekran görüntüsü" means, so it is refused. */
export const FEEDBACK_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export type FeedbackImageMimeType = (typeof FEEDBACK_IMAGE_MIME_TYPES)[number];

/**
 * 5 MB, not the 25 MB an attachment may be.
 *
 * This one leaves the device as a base64 email attachment, which inflates it
 * by a third, and common mail hosts reject a message over about 10 MB whole.
 * A screenshot from any phone sold this decade is well under 5.
 */
export const MAX_FEEDBACK_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * How many screenshots one report may carry.
 *
 * One was not enough: a person showing a flow that goes wrong needs the screen
 * before and the screen after, and "Görseli değiştir" asked them to choose
 * which half of the evidence to throw away.
 */
export const MAX_FEEDBACK_IMAGES = 4;

/**
 * What every attachment on ONE report may weigh together.
 *
 * The per-image cap alone does not bound the email: four 5 MB screenshots are
 * 20 MB, and base64 makes that about 27 — several times what a mail host will
 * accept, so the report would be refused after it was written rather than
 * before. Seven decoded megabytes inflate to about 9.3, which clears the
 * common 10 MB ceiling with room for the message and the headers.
 */
export const MAX_FEEDBACK_TOTAL_IMAGE_BYTES = 7 * 1024 * 1024;

export type FeedbackMessageRejection = "empty" | "tooShort" | "tooLong";
export type FeedbackImageRejection = "type" | "size" | "count" | "total";

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return typeof value === "string" && (FEEDBACK_CATEGORIES as readonly string[]).includes(value);
}

export function isFeedbackImageMimeType(value: unknown): value is FeedbackImageMimeType {
  return typeof value === "string" && (FEEDBACK_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Why this message cannot be sent, or `null` when it can.
 *
 * Length is measured on the TRIMMED message, so twenty spaces is empty rather
 * than long enough.
 */
export function feedbackMessageRejection(message: string): FeedbackMessageRejection | null {
  const trimmed = message.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.length < FEEDBACK_MESSAGE_MIN) return "tooShort";
  if (trimmed.length > FEEDBACK_MESSAGE_MAX) return "tooLong";
  return null;
}

/** Why this image cannot be attached ON ITS OWN, or `null` when it can. */
export function feedbackImageRejection(
  mimeType: string,
  byteLength: number,
): "type" | "size" | null {
  if (!isFeedbackImageMimeType(mimeType)) return "type";
  if (byteLength <= 0 || byteLength > MAX_FEEDBACK_IMAGE_BYTES) return "size";
  return null;
}

/**
 * Why this image cannot JOIN the ones already attached, or `null` when it can.
 *
 * Ordered the way a person meets the limits: what the file is, then how big it
 * is, then how many there already are, then what they weigh together. Each
 * answer names a different remedy — pick a different file, shrink it, remove
 * one, or remove a big one — so they are separate answers and not one "geçersiz
 * görsel".
 */
export function feedbackAttachmentRejection(
  attached: readonly { byteLength: number }[],
  candidate: { mimeType: string; byteLength: number },
): FeedbackImageRejection | null {
  const own = feedbackImageRejection(candidate.mimeType, candidate.byteLength);
  if (own) return own;
  if (attached.length >= MAX_FEEDBACK_IMAGES) return "count";
  const used = attached.reduce((sum, image) => sum + image.byteLength, 0);
  if (used + candidate.byteLength > MAX_FEEDBACK_TOTAL_IMAGE_BYTES) return "total";
  return null;
}

/**
 * A byte count said the way a person reads a file size, in Turkish.
 *
 * Every refusal about size has to name the real number — "Görsel 5 MB'ı aşıyor"
 * without saying what the file actually was leaves the person guessing whether
 * they missed by a little or a lot. Below a megabyte it rounds to whole
 * kilobytes, above it keeps one decimal with the comma this locale uses.
 */
export function byteSizeLabel(bytes: number): string {
  const safe = Math.max(0, Math.round(bytes));
  if (safe < 1024 * 1024) return `${Math.max(1, Math.round(safe / 1024))} KB`;
  const megabytes = safe / (1024 * 1024);
  // One decimal, and a whole number when the decimal would be a zero: "5 MB"
  // reads as the limit it is, "5,0 MB" reads as a measurement.
  const rounded = Math.round(megabytes * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1).replace(".", ",")} MB`;
}

/** What the attachments on a report weigh so far. */
export function feedbackImagesBytes(images: readonly { byteLength: number }[]): number {
  return images.reduce((sum, image) => sum + image.byteLength, 0);
}

export interface FeedbackDraft {
  category: FeedbackCategory;
  message: string;
  images: readonly { mimeType: string; byteLength: number }[];
}

/**
 * Whether the send button may be enabled.
 *
 * The images are optional, but one that is PRESENT and invalid blocks the
 * send — silently dropping it would mean the report arrives without the thing
 * the person was pointing at.
 */
export function isSubmittableFeedback(draft: FeedbackDraft): boolean {
  if (!isFeedbackCategory(draft.category)) return false;
  if (feedbackMessageRejection(draft.message) !== null) return false;
  if (draft.images.length > MAX_FEEDBACK_IMAGES) return false;
  if (feedbackImagesBytes(draft.images) > MAX_FEEDBACK_TOTAL_IMAGE_BYTES) return false;
  return draft.images.every(
    (image) => feedbackImageRejection(image.mimeType, image.byteLength) === null,
  );
}

/**
 * The subject line the report arrives under.
 *
 * Prefixed and categorised so a mail client can file it without being opened,
 * and truncated on a WORD boundary so a subject never ends mid-word — the same
 * rule the rest of this app applies to its own labels.
 */
export function feedbackSubject(category: FeedbackCategory, message: string): string {
  const trimmed = message.trim().replace(/\s+/g, " ");
  const limit = 60;
  if (trimmed.length <= limit) return `[Helix/${category}] ${trimmed}`;
  const cut = trimmed.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `[Helix/${category}] ${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Bytes as base64, without a platform API.
 *
 * `btoa` is a browser global that bare Hermes does not provide, and
 * `expo-file-system`'s `base64()` reads a native file URI — which a web
 * document-picker asset is not (it hands back a blob URL). Both halves of this
 * app have to produce the same string from the same bytes, so it is written
 * once, here, where it can be tested against known vectors rather than against
 * whichever runtime happens to be loaded.
 */
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    out += BASE64_ALPHABET[first >> 2];
    out += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    out += second === undefined ? "=" : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    out += third === undefined ? "=" : BASE64_ALPHABET[third & 0x3f];
  }
  return out;
}
