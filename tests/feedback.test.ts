/**
 * What a feedback report is allowed to be (spec §4.1).
 *
 * These rules are enforced in three places that cannot see each other — the
 * form, the client that posts, and the edge function that receives — so they
 * are asserted here once, against the one module all three read.
 */

import { describe, expect, it } from "vitest";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_IMAGE_MIME_TYPES,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_MESSAGE_MIN,
  MAX_FEEDBACK_IMAGES,
  MAX_FEEDBACK_IMAGE_BYTES,
  MAX_FEEDBACK_TOTAL_IMAGE_BYTES,
  byteSizeLabel,
  feedbackAttachmentRejection,
  feedbackImageRejection,
  feedbackImagesBytes,
  feedbackMessageRejection,
  feedbackSubject,
  isFeedbackCategory,
  isFeedbackImageMimeType,
  isSubmittableFeedback,
  toBase64,
} from "../src/domain/feedback";

describe("feedback categories", () => {
  it("offers the shared repair vocabulary and nothing else", () => {
    expect([...FEEDBACK_CATEGORIES]).toEqual([
      "visual", "functional", "performance", "data", "suggestion", "other",
    ]);
  });

  it("accepts only a listed category", () => {
    for (const category of FEEDBACK_CATEGORIES) expect(isFeedbackCategory(category)).toBe(true);
    for (const value of ["", "bug", "Visual", null, 3, {}, undefined]) {
      expect(isFeedbackCategory(value)).toBe(false);
    }
  });
});

describe("the description has a floor and a ceiling", () => {
  it("measures the trimmed text, so whitespace is not a description", () => {
    expect(feedbackMessageRejection("   ")).toBe("empty");
    expect(feedbackMessageRejection("")).toBe("empty");
    expect(feedbackMessageRejection(`${" ".repeat(40)}`)).toBe("empty");
  });

  it("refuses a message under the floor and accepts one exactly on it", () => {
    expect(feedbackMessageRejection("a".repeat(FEEDBACK_MESSAGE_MIN - 1))).toBe("tooShort");
    expect(feedbackMessageRejection("a".repeat(FEEDBACK_MESSAGE_MIN))).toBeNull();
  });

  it("refuses a message over the ceiling and accepts one exactly on it", () => {
    expect(feedbackMessageRejection("a".repeat(FEEDBACK_MESSAGE_MAX))).toBeNull();
    expect(feedbackMessageRejection("a".repeat(FEEDBACK_MESSAGE_MAX + 1))).toBe("tooLong");
  });

  it("lets a real Turkish report through", () => {
    expect(feedbackMessageRejection("Mali Tablo'da Nisan sütunu boş kalıyor.")).toBeNull();
  });
});

describe("the screenshot is an image, and a small one", () => {
  it("accepts every listed image type and refuses a document", () => {
    for (const mimeType of FEEDBACK_IMAGE_MIME_TYPES) {
      expect(isFeedbackImageMimeType(mimeType)).toBe(true);
      expect(feedbackImageRejection(mimeType, 1024)).toBeNull();
    }
    expect(feedbackImageRejection("application/pdf", 1024)).toBe("type");
    expect(feedbackImageRejection("text/plain", 1024)).toBe("type");
    expect(isFeedbackImageMimeType("image/gif")).toBe(false);
  });

  it("refuses an empty file and one over the cap, and accepts one exactly on it", () => {
    expect(feedbackImageRejection("image/png", 0)).toBe("size");
    expect(feedbackImageRejection("image/png", -1)).toBe("size");
    expect(feedbackImageRejection("image/png", MAX_FEEDBACK_IMAGE_BYTES)).toBeNull();
    expect(feedbackImageRejection("image/png", MAX_FEEDBACK_IMAGE_BYTES + 1)).toBe("size");
  });

  it("stays well under what a mail host refuses once base64 inflates it", () => {
    expect(MAX_FEEDBACK_IMAGE_BYTES * (4 / 3)).toBeLessThan(10 * 1024 * 1024);
    // The bound that actually matters is the WHOLE set, which is what leaves
    // the device as one message.
    expect(MAX_FEEDBACK_TOTAL_IMAGE_BYTES * (4 / 3)).toBeLessThan(10 * 1024 * 1024);
  });

  it("adds the attached bytes up, and calls nothing attached zero", () => {
    expect(feedbackImagesBytes([])).toBe(0);
    expect(feedbackImagesBytes([{ byteLength: 10 }, { byteLength: 32 }])).toBe(42);
  });
});

describe("what may be sent", () => {
  const valid = { category: "visual", message: "Buton çalışmıyor gibi.", images: [] } as const;
  const png = (byteLength: number) => ({ mimeType: "image/png", byteLength });

  it("needs a valid category and a valid message", () => {
    expect(isSubmittableFeedback(valid)).toBe(true);
    expect(isSubmittableFeedback({ ...valid, message: "kısa" })).toBe(false);
    expect(isSubmittableFeedback({ ...valid, category: "nope" as never })).toBe(false);
  });

  it("treats no image as fine and a broken image as blocking", () => {
    expect(isSubmittableFeedback({ ...valid, images: [] })).toBe(true);
    expect(isSubmittableFeedback({ ...valid, images: [png(2048)] })).toBe(true);
    // Silently dropping it would send a report about a picture that is missing.
    expect(isSubmittableFeedback({ ...valid, images: [{ mimeType: "application/pdf", byteLength: 2048 }] })).toBe(false);
    expect(isSubmittableFeedback({ ...valid, images: [png(0)] })).toBe(false);
  });

  it("accepts a full set and refuses one more", () => {
    const four = Array.from({ length: MAX_FEEDBACK_IMAGES }, () => png(1024));
    expect(isSubmittableFeedback({ ...valid, images: four })).toBe(true);
    expect(isSubmittableFeedback({ ...valid, images: [...four, png(1024)] })).toBe(false);
  });

  it("refuses a batch over the shared ceiling even when each file clears its own", () => {
    const big = png(4 * 1024 * 1024);
    expect(isSubmittableFeedback({ ...valid, images: [big] })).toBe(true);
    expect(isSubmittableFeedback({ ...valid, images: [big, big] })).toBe(false);
  });
});

/**
 * Each refusal names a different remedy — pick another file, shrink it, remove
 * one, or remove a big one — so they have to be distinguishable answers and not
 * one "geçersiz görsel".
 */
describe("why a screenshot cannot join the ones already picked", () => {
  const png = (byteLength: number) => ({ mimeType: "image/png", byteLength });

  it("checks what the file is before how big it is", () => {
    expect(feedbackAttachmentRejection([], { mimeType: "application/pdf", byteLength: 99 })).toBe("type");
    // Over the per-image cap AND the wrong type: the type is the useful answer.
    expect(
      feedbackAttachmentRejection([], { mimeType: "application/pdf", byteLength: MAX_FEEDBACK_IMAGE_BYTES + 1 }),
    ).toBe("type");
  });

  it("refuses a file over the per-image cap and accepts one exactly on it", () => {
    expect(feedbackAttachmentRejection([], png(MAX_FEEDBACK_IMAGE_BYTES))).toBeNull();
    expect(feedbackAttachmentRejection([], png(MAX_FEEDBACK_IMAGE_BYTES + 1))).toBe("size");
  });

  it("says the set is full before it weighs anything", () => {
    const full = Array.from({ length: MAX_FEEDBACK_IMAGES }, () => png(16));
    expect(feedbackAttachmentRejection(full, png(16))).toBe("count");
    expect(feedbackAttachmentRejection(full.slice(1), png(16))).toBeNull();
  });

  it("weighs the candidate together with what is already attached", () => {
    const attached = [png(MAX_FEEDBACK_TOTAL_IMAGE_BYTES - 1024)];
    expect(feedbackAttachmentRejection(attached, png(1024))).toBeNull();
    expect(feedbackAttachmentRejection(attached, png(1025))).toBe("total");
  });
});

describe("a size said the way a person reads one", () => {
  it("rounds to whole kilobytes below a megabyte", () => {
    expect(byteSizeLabel(0)).toBe("1 KB");
    expect(byteSizeLabel(1)).toBe("1 KB");
    expect(byteSizeLabel(2048)).toBe("2 KB");
    expect(byteSizeLabel(1024 * 1024 - 1)).toBe("1024 KB");
  });

  it("switches to megabytes with the comma this locale writes", () => {
    expect(byteSizeLabel(1024 * 1024)).toBe("1 MB");
    expect(byteSizeLabel(Math.round(3.4 * 1024 * 1024))).toBe("3,4 MB");
    expect(byteSizeLabel(MAX_FEEDBACK_IMAGE_BYTES)).toBe("5 MB");
    expect(byteSizeLabel(MAX_FEEDBACK_TOTAL_IMAGE_BYTES)).toBe("7 MB");
  });

  it("never reports a negative size", () => {
    expect(byteSizeLabel(-500)).toBe("1 KB");
  });
});

describe("the subject line", () => {
  it("carries the category so a mail client can file it unopened", () => {
    expect(feedbackSubject("visual", "Kısa mesaj")).toBe("[Helix/visual] Kısa mesaj");
  });

  it("collapses whitespace rather than carrying a newline into a header", () => {
    expect(feedbackSubject("data", "İki\n\nsatır")).toBe("[Helix/data] İki satır");
  });

  it("shortens on a word boundary, never mid-word", () => {
    const long = "Mali Tablo ekranında Nisan sütununa dokunduğumda uygulama tamamen boş kalıyor";
    const subject = feedbackSubject("functional", long);
    expect(subject.startsWith("[Helix/functional] ")).toBe(true);
    expect(subject.endsWith("…")).toBe(true);
    const body = subject.slice("[Helix/functional] ".length, -1);
    // Whatever it kept is a prefix of the original ending at a word boundary.
    expect(long.startsWith(body)).toBe(true);
    expect(long[body.length] === " " || body.length === long.length).toBe(true);
  });

  it("trims before it measures, so leading space is not part of the subject", () => {
    expect(feedbackSubject("visual", "   Kısa mesaj   ")).toBe("[Helix/visual] Kısa mesaj");
  });

  it("keeps a message of exactly the limit whole, and shortens one character past it", () => {
    const exact = "a".repeat(60);
    expect(feedbackSubject("other", exact)).toBe(`[Helix/other] ${exact}`);
    expect(feedbackSubject("other", exact).endsWith("…")).toBe(false);
    expect(feedbackSubject("other", `${exact}b`).endsWith("…")).toBe(true);
  });

  it("keeps the kept half whole and drops the trailing space with it", () => {
    // The 60-character cut lands mid-word, so it steps back to the space and
    // must not leave that space sitting before the ellipsis.
    const message = `${"kelime ".repeat(9)}sonrakikelimeuzun`;
    const subject = feedbackSubject("data", message);
    expect(subject).toContain("kelime");
    expect(subject.endsWith(" …")).toBe(false);
    expect(subject.endsWith("…")).toBe(true);
  });

  it("cuts hard when stepping back would leave almost nothing", () => {
    // A 60-character run whose only space is very early: stepping back to it
    // would throw away the whole subject, so the cut stands.
    const message = `ab ${"c".repeat(80)}`;
    const subject = feedbackSubject("performance", message);
    const body = subject.slice("[Helix/performance] ".length, -1);
    expect(body.length).toBeGreaterThan(20);
  });

  it("still shortens a single unbroken token", () => {
    const subject = feedbackSubject("other", "a".repeat(120));
    expect(subject.endsWith("…")).toBe(true);
    expect(subject.length).toBeLessThan(100);
  });
});

/**
 * Known vectors, not a round trip against the platform.
 *
 * `btoa` is a browser global bare Hermes does not have and
 * `expo-file-system`'s `base64()` reads a native file URI, so both halves of
 * the app use this encoder and both have to produce the same bytes the edge
 * function will decode.
 */
describe("base64", () => {
  const encode = (text: string) => toBase64(new TextEncoder().encode(text));

  it("matches RFC 4648's own test vectors", () => {
    expect(encode("")).toBe("");
    expect(encode("f")).toBe("Zg==");
    expect(encode("fo")).toBe("Zm8=");
    expect(encode("foo")).toBe("Zm9v");
    expect(encode("foob")).toBe("Zm9vYg==");
    expect(encode("fooba")).toBe("Zm9vYmE=");
    expect(encode("foobar")).toBe("Zm9vYmFy");
  });

  it("pads to a multiple of four, which is what the receiver checks", () => {
    for (let length = 0; length < 20; length += 1) {
      const encoded = toBase64(new Uint8Array(length));
      expect(encoded.length % 4, `length ${length}`).toBe(0);
    }
  });

  it("encodes every byte value, so no high byte is mangled", () => {
    const all = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) all[index] = index;
    const encoded = toBase64(all);
    // Decoded through an independent implementation.
    const decoded = Uint8Array.from(Buffer.from(encoded, "base64"));
    expect([...decoded]).toEqual([...all]);
  });

  it("agrees with Node for arbitrary lengths", () => {
    for (const length of [1, 2, 3, 4, 5, 7, 16, 31, 64, 255]) {
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) bytes[index] = (index * 37 + 11) % 256;
      expect(toBase64(bytes), `length ${length}`).toBe(Buffer.from(bytes).toString("base64"));
    }
  });
});
