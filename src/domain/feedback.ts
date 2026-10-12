/**
 * What a feedback report is allowed to be (spec §13.1). The form, the posting
 * service and the edge function must agree and cannot see each other; a rule
 * only the form holds is one a replayed request walks around. The categories
 * are the vocabulary reporter and fixer must mean the same thing by.
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

/** Short enough that "buton çalışmıyor" gets through, long enough that an accidental tap does not. */
export const FEEDBACK_MESSAGE_MIN = 10;

/** A ceiling, so a pasted log cannot become an unopenable email and the edge function can bound before it allocates. */
export const FEEDBACK_MESSAGE_MAX = 4000;

/** Screenshots. A PDF is not what "ekran görüntüsü" means, so it is refused. */
export const FEEDBACK_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

type FeedbackImageMimeType = (typeof FEEDBACK_IMAGE_MIME_TYPES)[number];

/** 5 MB, not an attachment's 25: this leaves the device as a base64 email attachment, a third larger, and mail hosts reject about 10 MB whole. */
export const MAX_FEEDBACK_IMAGE_BYTES = 5 * 1024 * 1024;

/** How many screenshots one report may carry: a flow that goes wrong needs the screen before and after. */
export const MAX_FEEDBACK_IMAGES = 4;

/**
 * What every attachment on ONE report may weigh together. The per-image cap
 * alone does not bound the email (four 5 MB screenshots are about 27 MB in
 * base64); 7 MB decoded is about 9.3 encoded, under the common 10 MB ceiling.
 */
export const MAX_FEEDBACK_TOTAL_IMAGE_BYTES = 7 * 1024 * 1024;

type FeedbackMessageRejection = "empty" | "tooShort" | "tooLong";
export type FeedbackImageRejection = "type" | "size" | "count" | "total";

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return typeof value === "string" && (FEEDBACK_CATEGORIES as readonly string[]).includes(value);
}

export function isFeedbackImageMimeType(value: unknown): value is FeedbackImageMimeType {
  return typeof value === "string" && (FEEDBACK_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Why this message cannot be sent, or `null` when it can. Length is measured
 * on the TRIMMED message, so twenty spaces is empty.
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
  if (feedbackImagesBytes(attached) + candidate.byteLength > MAX_FEEDBACK_TOTAL_IMAGE_BYTES) return "total";
  return null;
}

/**
 * A byte count as a person reads a file size, in Turkish, so a size refusal can
 * name the real number: whole kilobytes below a megabyte, else one decimal with
 * the locale's comma.
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

/**
 * Bytes as base64, without a platform API: `btoa` is absent from bare Hermes,
 * and `expo-file-system`'s `base64()` cannot read a web picker's blob URL. One
 * implementation, testable against known vectors.
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
