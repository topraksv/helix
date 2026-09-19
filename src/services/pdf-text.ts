/**
 * Reading the text out of a PDF, locally (spec §3.1b).
 *
 * ## Why this exists at all
 *
 * A bank statement is the one document whose numbers the owner already has and
 * still has to retype. Extracting them needs the document's text — and a PDF
 * text layer is compressed, so something has to inflate it.
 *
 * ## Why it has a dependency now, having refused one for a year
 *
 * It used SheetJS's inflate, on the reasoning that it was already in the tree
 * for `.xlsx` and a `FlateDecode` stream is the same DEFLATE data. The
 * reasoning was sound and the outcome was not: that inflate needs a size to
 * allocate, a PDF does not reliably declare one, and the estimate that filled
 * the gap silently truncated well-compressed statements and leaked unzeroed
 * memory into the extracted text. `inflate` below records both measurements.
 *
 * `fflate` is 8 KB of dependency-free JavaScript whose inflate reports what it
 * wrote. That is the entire capability that was missing, and both defects are
 * gone by construction rather than by tuning.
 *
 * A full PDF library was considered and refused, on a narrower argument than
 * the original one. It is not only that shipping a large parser to run over the
 * owner's most sensitive file is a cost — it is that this app runs on React
 * Native as well as the web, and `pdfjs-dist` wants DOM APIs that Hermes does
 * not have. The limits below stay limits.
 *
 * ## What this deliberately does NOT do
 *
 * It is a text extractor, not a PDF renderer. It reads uncompressed and
 * FlateDecoded content streams, the text-showing operators inside them and the
 * fonts those operators select — including fonts packed into object streams,
 * each decoded through its own `ToUnicode` CMap. It does not do encryption or
 * images, which is why a scanned statement produces NO text and is reported as
 * unsupported rather than guessed at. Every one of those limits is a deliberate refusal to
 * pretend: a statement this cannot read must be said to be unreadable, because
 * a half-read financial document is worse than an unread one.
 *
 * Nothing here leaves the device, and nothing here is uploaded.
 */

/**
 * Loaded ON DEMAND, for the same reason the SheetJS it replaced was.
 *
 * Smaller is not small: measured, a static `import { Unzlib } from "fflate"`
 * put 33_884 bytes into the entry chunk of every session and pushed the export
 * 2_142 bytes past its ceiling — for a feature most sessions never open. The
 * win over SheetJS is still real and is a different one: the chunk that arrives
 * when somebody does open a statement is a few KB rather than 493.
 *
 * Type-only here, real module inside the one async function that needs it, and
 * threaded down to `inflate` exactly as the SheetJS handle used to be.
 */
import type { Unzlib as UnzlibClass } from "fflate";

type UnzlibCtor = typeof UnzlibClass;

/** Bytes a statement may be. Larger is not a statement; it is a mistake. */
export const MAX_PDF_BYTES = 12 * 1024 * 1024;

/** Guard against a decompression bomb: a stream that expands beyond this is
 *  refused rather than allocated. */
const MAX_STREAM_BYTES = 24 * 1024 * 1024;
/**
 * Inflated bytes a whole document may produce. The per-stream ceiling bounds
 * one bomb and not a file of them: a refused stream counted towards nothing, so
 * every one was inflated to the ceiling — measured, twenty took 450 ms, and a
 * file at `MAX_PDF_BYTES` holds hundreds. Eight times the largest file accepted
 * is far past what a statement's text, fonts and images inflate to.
 */
const MAX_INFLATED_BYTES = 8 * MAX_PDF_BYTES;
/** Total text kept. A statement's text layer is far smaller than this. */
const MAX_TEXT_LENGTH = 4_000_000;

export type PdfFailure =
  | "not_a_pdf"
  | "too_large"
  | "encrypted"
  | "no_text_layer"
  | "unmapped_font"
  | "unreadable";

export type PdfTextResult =
  | { ok: true; text: string; pageCount: number }
  | { ok: false; reason: PdfFailure };

function bytesToLatin1(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let out = "";
  // Chunked: `String.fromCharCode(...array)` blows the argument limit on a
  // multi-megabyte document.
  for (let index = start; index < end; index += 8192) {
    const stop = Math.min(index + 8192, end);
    out += String.fromCharCode(...bytes.subarray(index, stop));
  }
  return out;
}

/**
 * Whether these bytes begin with a real zlib header.
 *
 * This is a HARD gate, not an optimisation. `_inflateRaw` does not return on
 * input that is not deflate data — measured against a real bank statement, it
 * spun indefinitely on a byte range that merely looked like a stream — and
 * there is no way to interrupt a synchronous call once it has begun. So the
 * only safe policy is to refuse anything that does not prove itself first.
 *
 * Every PDF producer emits zlib-wrapped `FlateDecode`, so requiring the header
 * costs nothing real and removes the entire class of hang.
 */
function hasZlibHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false;
  const first = bytes[0]!;
  const second = bytes[1]!;
  // CMF: deflate compression method, window size within spec; FCHK: the
  // two-byte value must be a multiple of 31.
  return (first & 0x0f) === 8 && (first >> 4) <= 7 && ((first << 8) | second) % 31 === 0;
}

/**
 * How much compressed input is handed to the inflater at a time.
 *
 * It is the bomb guard, and it has to be small. The limit below can only be
 * enforced between callbacks, so one push's worth of expansion is the overshoot
 * the process has to absorb: at DEFLATE's documented 1032:1 ceiling, 4 KB of
 * input is at most ~4 MB of output. Measured against 64 MB of zeros compressed
 * to 65_508 bytes — a 1023:1 bomb — the peak settles at 25_180_543 bytes with
 * this step and at the full 67_108_864 with 64 KB, because the whole payload
 * then arrives in two pushes and the callback never gets to say stop.
 */
const INFLATE_STEP = 4096;

/**
 * Inflate a zlib stream, exactly.
 *
 * ## What this replaced, and why it had to be a dependency
 *
 * This used SheetJS's `CFB.utils._inflateRaw`, chosen because it was already in
 * the tree. It needs a size to allocate and a PDF does not reliably declare
 * one, so the size was estimated at 12x the compressed length — and the
 * estimate carried two measured defects that could not both be fixed by tuning
 * it:
 *
 * 1. A stream compressing better than 12:1 was TRUNCATED, silently. A text
 *    layer repeats merchant names, dates and headers: measured, a 900 KB layer
 *    that deflated to 2.7 KB (331:1) came back 3.6% complete with the closing
 *    balance simply gone, reported as `ok`.
 * 2. The surplus was NOT zeroed, and the extractor scanned all of it: measured
 *    on a two-line statement, the text came back with JavaScript source
 *    fragments after it. Raising the estimate to fix (1) made (2) worse in
 *    proportion — 14_287 leaked characters instead of 189.
 *
 * `fflate` is the smallest thing that ends both: zero dependencies, pure
 * JavaScript, so it runs in Hermes as well as a browser. A full PDF library was
 * considered and refused — `pdfjs-dist` wants DOM APIs this app does not have
 * on native, and the missing capability was never parsing, it was an inflate
 * that reports how much it wrote.
 *
 * It also takes SheetJS off this path entirely. Opening a statement used to
 * download the 493 KB `xlsx` chunk for one utility function.
 *
 * ## Why streaming rather than the one-line call
 *
 * `unzlibSync` returns the exact length, which is the whole point — but its
 * bounded form does not: given a preallocated buffer that is too small it fills
 * it and returns, with no error, which is defect (1) again wearing a different
 * name. Measured. The streaming form is the one that can refuse: it reports
 * each chunk as it is produced, so the limit is a decision rather than an
 * allocation.
 */
function inflate(bytes: Uint8Array, Unzlib: UnzlibCtor, budget: { left: number }): Uint8Array | null {
  if (!hasZlibHeader(bytes)) return null;
  const limit = Math.min(MAX_STREAM_BYTES, budget.left);
  const parts: Uint8Array[] = [];
  let written = 0;
  let overflowed = false;
  const stream = new Unzlib((chunk) => {
    if (overflowed) return;
    written += chunk.length;
    if (written > limit) {
      overflowed = true;
      return;
    }
    parts.push(chunk);
  });
  let corrupt = false;
  try {
    for (let at = 0; at < bytes.length && !overflowed; at += INFLATE_STEP) {
      const end = Math.min(at + INFLATE_STEP, bytes.length);
      stream.push(bytes.subarray(at, end), end === bytes.length);
    }
  } catch {
    // Corrupt or not actually deflate. It THROWS rather than spinning, which
    // the previous inflate did not — `hasZlibHeader` below is kept anyway,
    // because refusing early is still cheaper than unwinding.
    corrupt = true;
  }
  budget.left -= written;
  // Thrown rather than skipped: past the document's budget the file is not one
  // stream too many but a file of them, and `extractPdfText` names it
  // unreadable instead of reading whatever the streams before it held.
  if (budget.left < 0) throw new Error("PDF inflate budget exceeded");
  if (corrupt || overflowed) return null;
  const out = new Uint8Array(written);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** `/Length 1234` from a stream's own dictionary, when it declares one. */
function declaredLength(dictionary: string): number | null {
  const match = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dictionary);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * Every content stream in the file, inflated where it says it is compressed.
 *
 * Streams are found by `>>` followed by the `stream` keyword — the shape a
 * stream object actually has — and NOT by scanning for the bare word. A 195 KB
 * statement contains that word inside its embedded font and image data a dozen
 * times over, and treating those byte ranges as streams is what fed garbage to
 * the inflater in the first place.
 */
interface PdfStreams {
  /** Page content, in file order. */
  content: string[];
  /** Every `ToUnicode` CMap, in file order. */
  cmaps: string[];
  /** The same CMaps by the object number a font names them with. */
  cmapByObject: Map<number, string>;
  /** Type3 glyph drawings by object number. */
  glyphs: Map<number, string>;
  /**
   * Object streams. PDF 1.5 packs font and page dictionaries into them, where a
   * search of the file's bytes cannot see them — and a Type0 font nobody can see
   * is read as single bytes, which is garbage that looks like text.
   */
  packed: { dictionary: string; text: string }[];
}

/**
 * Only what this can decode. An LZW stream or an unfiltered binary blob is
 * skipped rather than guessed at, and so is an image, by its subtype, because
 * it is deflated exactly as page content is.
 */
function notText(dictionary: string, isFlate: boolean): boolean {
  const hasOtherFilter = /\/Filter\s*(?:\[\s*)?\/(?!FlateDecode)[A-Za-z]/.test(dictionary);
  return (hasOtherFilter && !isFlate) || /\/Subtype\s*\/Image\b/.test(dictionary);
}

/** A Type3 glyph's drawing opens with `d0` or `d1`, and is no more page text than an image is. */
const GLYPH_DRAWING = /^\s*(?:-?[\d.]+\s+){2}d0\b|^\s*(?:-?[\d.]+\s+){6}d1\b/;

function contentStreams(bytes: Uint8Array, Unzlib: UnzlibCtor): PdfStreams {
  const haystack = bytesToLatin1(bytes);
  const found: PdfStreams = { content: [], cmaps: [], cmapByObject: new Map(), glyphs: new Map(), packed: [] };
  let total = 0;
  const budget = { left: MAX_INFLATED_BYTES };
  const opener = />>\s*stream\r?\n?/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(haystack)) !== null) {
    const start = match.index + match[0].length;
    const close = haystack.indexOf("endstream", start);
    if (close === -1) break;
    opener.lastIndex = close + "endstream".length;

    // The dictionary is the text back to its own opening `<<`, looked for only
    // in the 2000 characters before the keyword. Searching the whole file
    // walked back to its start from every stream of a file with no `<<`:
    // measured, a megabyte of text before 4_000 streams took 2 s.
    const before = haystack.slice(Math.max(0, match.index - 2000), match.index);
    const opensAt = before.lastIndexOf("<<");
    const dictionary = opensAt === -1 ? before : before.slice(opensAt);
    const dictionaryStart = opensAt === -1 ? -1 : match.index - before.length + opensAt;

    const isFlate = /\/Filter\s*(?:\[\s*)?\/FlateDecode/.test(dictionary);
    if (notText(dictionary, isFlate)) continue;

    const declared = declaredLength(dictionary);
    const end = declared != null && start + declared <= close ? start + declared : close;
    const raw = bytes.subarray(start, end);
    const decoded = isFlate ? inflate(raw, Unzlib, budget) : raw;
    if (!decoded) continue;
    const text = bytesToLatin1(decoded);
    total += text.length;
    if (total > MAX_TEXT_LENGTH) break;
    const owner = Number(/(\d+)\s+\d+\s+obj\s*$/.exec(haystack.slice(Math.max(0, dictionaryStart - 32), Math.max(0, dictionaryStart)))?.[1]);
    if (/\/Type\s*\/ObjStm\b/.test(dictionary)) {
      found.packed.push({ dictionary, text });
    } else if (GLYPH_DRAWING.test(text)) {
      found.glyphs.set(owner, text);
    } else if (text.includes("begincmap")) {
      // A CMap is not page content and must never be scanned for text: its own
      // body is full of hex that would otherwise be read as words.
      found.cmaps.push(text);
      found.cmapByObject.set(owner, text);
    } else {
      found.content.push(text);
    }
  }
  return found;
}

/**
 * Every object's own text by object number: the top-level ones up to their
 * stream, their `endobj` or the next object, whichever comes first, then those
 * packed into object streams.
 *
 * Each boundary is searched for once per stretch of the file and no two bodies
 * overlap, so this and the font search that reads every body are linear in
 * the file. Measured on what this replaced: a file of unclosed headers
 * rescanned the rest of itself from each one (20_000 took 264 ms, four times
 * that at twice as many), and 10_000 headers closed by a single `endobj` were
 * 10_000 copies of the file's tail (108 ms, likewise quadratic).
 */
function objectBodies(document: string, packed: PdfStreams["packed"]): Map<number, string> {
  const bodies = new Map<number, string>();
  // `(?<!\d)` starts a number at its first digit only. Without it every digit
  // of a long run began a match that backtracked over the rest of the run —
  // measured, 60_000 digits took 1.3 s.
  const header = /(?<!\d)(\d+)\s+\d+\s+obj\b/g;
  const terminator = /\b(?:stream|endobj)\b/g;
  let terminatorAt = 0;
  let match = header.exec(document);
  while (match !== null) {
    const start = match.index + match[0].length;
    if (terminatorAt < start) {
      terminator.lastIndex = start;
      terminatorAt = terminator.exec(document)?.index ?? Infinity;
    }
    const next = header.exec(document);
    bodies.set(Number(match[1]), document.slice(start, Math.min(terminatorAt, next?.index ?? document.length)));
    match = next;
  }
  for (const stream of packed) unpackObjects(stream, bodies);
  return bodies;
}

/** How many objects one object stream may claim to hold. */
const MAX_PACKED_OBJECTS = 100_000;

/**
 * The objects one object stream packs, from the `number offset` pairs before
 * `/First`. Reading stops at an offset that goes back: past one, a body could
 * be the rest of the stream once for every other object — measured, 2_000
 * alternating offsets over a megabyte took 160 ms, and a stream may claim a
 * hundred thousand.
 */
function unpackObjects({ dictionary, text }: PdfStreams["packed"][number], bodies: Map<number, string>): void {
  const count = Number(/\/N\s+(\d+)/.exec(dictionary)?.[1]);
  const first = Number(/\/First\s+(\d+)/.exec(dictionary)?.[1]);
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(first) || count > MAX_PACKED_OBJECTS) return;
  const header = text.slice(0, first).trim().split(/\s+/).map(Number);
  for (let index = 0; index < count; index += 1) {
    const number = header[index * 2]!;
    const offset = header[index * 2 + 1]!;
    const end = header[index * 2 + 3] ?? text.length - first;
    if (!Number.isSafeInteger(number) || !Number.isSafeInteger(offset) || !(end >= offset)) return;
    bodies.set(number, text.slice(first + offset, first + end));
  }
}

/** What a `Tf` selects: how that font's shown strings become text. */
interface FontDecoder {
  /** Two-byte glyph ids (a Type0 font, or an Identity encoding) rather than one byte a character. */
  cid: boolean;
  toUnicode: ToUnicodeMap | null;
  /**
   * A Type3 font with no map. Its glyphs are drawings its producer numbers at
   * will: a statement printed through a mainframe's page format sets each
   * letter at that system's own code, a different code for the same Turkish
   * letter in two fonts of one page, and read as bytes came back "ok" as
   * three thousand lines of accented noise.
   */
  unnamed?: boolean;
  /** Advance per code at size 1, for a font whose text is placed by position. */
  widths?: Map<number, number>;
}

/** EBCDIC code page 037, the codes a mainframe page format (AFP) sets Latin text in. */
const EBCDIC_037 = "\uFFFD".repeat(64) + "  âäàáãåçñ¢.<(+|&éêëèíîïìß!$*);¬-/ÂÄÀÁÃÅÇÑ¦,%_>?øÉÊËÈÍÎÏÌ`:#@'=\"Øabcdefghi«»ðýþ±°jklmnopqrªºæ¸Æ¤µ~stuvwxyz¡¿ÐÝÞ®^£¥·©§¶¼½¾[]¯¨´×{ABCDEFGHI\u00ADôöòóõ}JKLMNOPQR¹ûüùúÿ\\÷STUVWXYZ²ÔÖÒÓÕ0123456789³ÛÜÙÚ\uFFFD";

/** A Turkish letter drawn as a Latin letter's body with marks: base letter, marks above, marks below. */
const MARKED_LETTERS: Readonly<Record<string, string>> = {
  i00: "ı", I10: "İ", g10: "ğ", G10: "Ğ", s01: "ş", S01: "Ş", c01: "ç", C01: "Ç", o20: "ö", O20: "Ö", u20: "ü", U20: "Ü",
};

const MAX_GLYPH_PIXELS = 65_536;

/** A 1-bit glyph drawing's largest connected part, and how many separate marks sit above and below it. */
interface GlyphShape {
  body: string;
  above: number;
  below: number;
}

function glyphShape(drawing: string | undefined): GlyphShape | null {
  const image = drawing && /BI\s*\/W\s+(\d+)\s*\/H\s+(\d+)\s*\/BPC\s+1\s*\/IM\s+true\s*(\/D\s*\[\s*1\s+0\s*\])?\s*ID\s/.exec(drawing);
  if (!image) return null;
  const width = Number(image[1]);
  const height = Number(image[2]);
  if (width * height > MAX_GLYPH_PIXELS) return null;
  const data = drawing.slice(image.index + image[0].length);
  const ink = image[3] ? 1 : 0;
  const stride = Math.ceil(width / 8);
  const pixels = new Set<number>();
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const byte = data.charCodeAt(row * stride + (column >> 3));
      if (((byte >> (7 - (column & 7))) & 1) === ink) pixels.add((height - 1 - row) * width + column);
    }
  }
  const [body, ...marks] = connectedParts(pixels, width).sort((a, b) => b.length - a.length);
  if (!body) return null;
  const ys = (part: number[]) => part.map((pixel) => Math.floor(pixel / width));
  const top = Math.max(...ys(body));
  const bottom = Math.min(...ys(body));
  const left = Math.min(...body.map((pixel) => pixel % width));
  return {
    body: body.map((pixel) => `${(pixel % width) - left},${Math.floor(pixel / width) - bottom}`).sort().join(" "),
    above: marks.filter((mark) => Math.min(...ys(mark)) > top).length,
    below: marks.filter((mark) => Math.max(...ys(mark)) < bottom).length,
  };
}

function connectedParts(pixels: Set<number>, width: number): number[][] {
  const parts: number[][] = [];
  const unvisited = new Set(pixels);
  for (const start of pixels) {
    if (!unvisited.delete(start)) continue;
    const part = [start];
    for (let index = 0; index < part.length; index += 1) {
      const pixel = part[index]!;
      const column = pixel % width;
      for (const dy of [-width, 0, width]) {
        for (const dx of [-1, 0, 1]) {
          const neighbour = pixel + dy + dx;
          if (column + dx >= 0 && column + dx < width && unvisited.delete(neighbour)) part.push(neighbour);
        }
      }
    }
    parts.push(part);
  }
  return parts;
}

/** A dictionary entry's value: the object it references, or the value written in place. */
function entryValue(body: string, key: string, bodies: Map<number, string>): string {
  const reference = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(body);
  if (reference) return bodies.get(Number(reference[1])) ?? "";
  return new RegExp(`/${key}\\s*(<<[^>]*>>|\\[[^\\]]*\\])`).exec(body)?.[1] ?? "";
}

interface AfpFont {
  /** Glyph drawing object by code. */
  glyphs: Map<number, number>;
  widths: Map<number, number>;
}

/**
 * A Type3 font converted from a mainframe page format: every glyph is named
 * `C` and its own code in hex, and no map says which letter it draws.
 */
/** An encoding's glyph drawings by code, when every glyph is named `C` and its own code in hex. */
function glyphsNamedForCodes(differences: string, drawings: Map<string, number>): Map<number, number> | null {
  const glyphs = new Map<number, number>();
  let code = 0;
  for (const token of differences.match(/\d+|\/[^\s/]+/g) ?? []) {
    if (!token.startsWith("/")) {
      code = Number(token);
      continue;
    }
    const drawing = drawings.get(token.slice(1));
    if (drawing == null || !/^\/C[0-9A-Fa-f]{1,2}$/.test(token) || Number.parseInt(token.slice(2), 16) !== code) return null;
    glyphs.set(code, drawing);
    code += 1;
  }
  return glyphs.size > 0 ? glyphs : null;
}

function afpFont(body: string, bodies: Map<number, string>): AfpFont | null {
  if (!/\/Subtype\s*\/Type3\b/.test(body) || /\/ToUnicode\b/.test(body)) return null;
  const drawings = new Map([...entryValue(body, "CharProcs", bodies).matchAll(/\/(\S+?)\s+(\d+)\s+\d+\s+R/g)].map((m) => [m[1]!, Number(m[2])]));
  const glyphs = glyphsNamedForCodes(/\/Differences\s*\[([^\]]*)\]/.exec(entryValue(body, "Encoding", bodies))?.[1] ?? "", drawings);
  if (!glyphs) return null;
  const first = Number(/\/FirstChar\s+(\d+)/.exec(body)?.[1] ?? 0);
  const scale = Number(/\/FontMatrix\s*\[\s*([-\d.]+)/.exec(body)?.[1] ?? 1);
  const advances = entryValue(body, "Widths", bodies).match(/-?\d*\.?\d+/g) ?? [];
  return { glyphs, widths: new Map(advances.map((advance, index) => [first + index, Number(advance) * scale])) };
}

/**
 * Letters for page-format fonts. Latin text is EBCDIC 037; the letters that
 * code page lacks are drawn from a supplement font, recognised by shape: a
 * glyph whose body is exactly a base letter's body elsewhere in the document,
 * with the marks that make it Turkish. Measured on the owner's Akbank
 * statement, one such font held every `ı ş İ Ş` at several sizes.
 */
function afpDecoders(fonts: AfpFont[], drawings: Map<number, string>): FontDecoder[] {
  const shapes = fonts.map((font) => new Map([...font.glyphs].map(([code, object]) => [code, glyphShape(drawings.get(object))])));
  const bases = new Map<string, string>();
  for (const glyphs of shapes) {
    for (const [code, shape] of glyphs) {
      const letter = EBCDIC_037[code]!;
      if (shape && "iIsScCgGoOuU".includes(letter) && shape.above === Number(letter === "i") && shape.below === 0) bases.set(shape.body, letter);
    }
  }
  return fonts.map((font, index) => {
    const inked = [...shapes[index]!].filter(([, shape]) => shape != null);
    const turkish = new Map(inked.flatMap(([code, shape]) => {
      const letter = MARKED_LETTERS[`${bases.get(shape!.body)}${shape!.above}${shape!.below}`];
      return letter ? [[code, letter] as const] : [];
    }));
    // A font drawn mostly as marked letters is the supplement; what it draws unrecognised is not guessed.
    const supplement = turkish.size > 0 && turkish.size * 2 >= inked.length;
    const letterOf = (code: number) => supplement ? turkish.get(code) ?? (shapes[index]!.get(code) ? "\uFFFD" : "") : EBCDIC_037[code]!;
    return { cid: false, toUnicode: new Map([...font.glyphs.keys()].map((code) => [code, letterOf(code)])), widths: font.widths };
  });
}

/**
 * The font object each resource name selects, or null when one name means two
 * different fonts — attributing a stream to its page is the part of the
 * resource graph this extractor does not walk, so a name it cannot pin down is
 * a name it cannot decode.
 *
 * A referenced dictionary is read once however many pages name it: reading it
 * per reference made 2_000 references to a megabyte take 536 ms.
 */
function fontObjectsByName(bodies: Map<number, string>): Map<string, number> | null {
  const dictionaries: string[] = [];
  const referenced = new Set<number>();
  for (const body of bodies.values()) {
    for (const inline of body.matchAll(/\/Font\s*<<([^<>]*)>>/g)) dictionaries.push(inline[1]!);
    for (const reference of body.matchAll(/\/Font\s+(\d+)\s+\d+\s+R/g)) referenced.add(Number(reference[1]));
  }
  for (const object of referenced) dictionaries.push(bodies.get(object) ?? "");
  const fontByName = new Map<string, number>();
  for (const dictionary of dictionaries) {
    for (const entry of dictionary.matchAll(/\/([^\s/[\]()<>{}%]+)\s+(\d+)\s+\d+\s+R/g)) {
      const known = fontByName.get(entry[1]!);
      if (known != null && known !== Number(entry[2])) return null;
      fontByName.set(entry[1]!, Number(entry[2]));
    }
  }
  return fontByName;
}

/**
 * The decoder each resource name selects, or null where `fontObjectsByName`
 * refuses. A font is read once however many names select it, and a CMap once
 * however many fonts share it: 4_000 names for one megabyte took 463 ms.
 */
function resolveFonts(bodies: Map<number, string>, streams: PdfStreams): Map<string, FontDecoder> | null {
  const fontByName = fontObjectsByName(bodies);
  if (!fontByName) return null;
  const parsed = new Map<number, ToUnicodeMap>();
  const decoders = new Map<number, FontDecoder>();
  const afp = [...new Set(fontByName.values())].flatMap((object) => {
    const font = afpFont(bodies.get(object) ?? "", bodies);
    return font ? [[object, font] as const] : [];
  });
  afpDecoders(afp.map(([, font]) => font), streams.glyphs).forEach((decoder, index) => decoders.set(afp[index]![0], decoder));
  const fonts = new Map<string, FontDecoder>();
  for (const [name, object] of fontByName) {
    let decoder = decoders.get(object);
    if (!decoder) {
      const body = bodies.get(object) ?? "";
      const reference = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(body);
      const cmapObject = reference ? Number(reference[1]) : -1;
      const cmap = streams.cmapByObject.get(cmapObject);
      if (cmap != null && !parsed.has(cmapObject)) parsed.set(cmapObject, parseToUnicode(cmap));
      const toUnicode = parsed.get(cmapObject) ?? null;
      decoder = {
        cid: /\/Subtype\s*\/Type0\b/.test(body) || /\/Encoding\s*\/Identity-[HV]\b/.test(body),
        toUnicode,
        unnamed: toUnicode == null && /\/Subtype\s*\/Type3\b/.test(body),
      };
      decoders.set(object, decoder);
    }
    fonts.set(name, decoder);
  }
  return fonts;
}

/**
 * The font a stream is read with before it selects one, or by a name the
 * resource graph did not resolve: the whole document's single CMap when it uses
 * glyph ids and ships exactly one, and nothing at all — a refusal — when it
 * ships several.
 */
function documentFont(usesGlyphIds: boolean, cmaps: string[]): FontDecoder | null {
  if (!usesGlyphIds) return { cid: false, toUnicode: null };
  return cmaps.length === 1 ? { cid: true, toUnicode: parseToUnicode(cmaps[0]!) } : null;
}

/**
 * A `ToUnicode` CMap: which character each glyph id actually is.
 *
 * A statement produced with `/Encoding /Identity-H` does not store letters. It
 * stores GLYPH INDEXES into an embedded subset font, and the only thing that
 * says which letter a glyph is, is the `ToUnicode` CMap the producer ships
 * beside it. Without applying it, extraction returns something that looks like
 * text, is the right length, and is meaningless — measured against a real
 * statement, 96 KB of it. That is the single most dangerous output this module
 * could produce, because every later stage would treat it as a readable
 * document.
 */
type ToUnicodeMap = Map<number, string>;

/** `<0041>` → 0x41. Bounded so a malformed CMap cannot allocate. */
function hexValue(token: string): number | null {
  const digits = token.replace(/[<>\s]/g, "");
  if (digits.length === 0 || digits.length > 8 || !/^[0-9A-Fa-f]+$/.test(digits)) return null;
  return Number.parseInt(digits, 16);
}

/** `<0041 0042>` → "AB": a destination may be several UTF-16 code units. */
function hexToString(token: string): string {
  const digits = token.replace(/[<>\s]/g, "");
  let out = "";
  for (let index = 0; index + 3 < digits.length + 1; index += 4) {
    const unit = Number.parseInt(digits.slice(index, index + 4), 16);
    if (Number.isFinite(unit)) out += String.fromCharCode(unit);
  }
  return out;
}

/**
 * How many entries one CMap may declare.
 *
 * It caps MEMORY, and on its own it did not cap WORK. `add` refuses past this
 * size but the loops kept walking: a CMap of `<0000> <FFFF> <41>` repeated
 * 50_000 times is 930 KB — far inside the stream ceiling, and a few KB once
 * deflated — and it drove 3.3 BILLION refused inserts, 16 seconds of a frozen
 * JavaScript thread that nothing can interrupt. Scaled to the stream ceiling
 * that is minutes. So every loop below stops at this size too, and a statement
 * whose CMap is already full costs nothing more to keep reading.
 */
const MAX_CMAP_ENTRIES = 65_536;

/**
 * Read `beginbfchar` and `beginbfrange` sections out of a CMap stream.
 *
 * Both `bfrange` forms are handled: a contiguous destination
 * (`<lo> <hi> <dst>`) and the array form (`<lo> <hi> [ <d1> <d2> … ]`) that
 * the statement in front of me actually uses.
 */
function parseToUnicode(text: string): ToUnicodeMap {
  const map: ToUnicodeMap = new Map();
  const add = (code: number, value: string) => {
    if (map.size < MAX_CMAP_ENTRIES && value !== "") map.set(code, value);
  };
  const full = () => map.size >= MAX_CMAP_ENTRIES;
  for (const section of text.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    for (const pair of section.match(/<[0-9A-Fa-f\s]+>\s*<[0-9A-Fa-f\s]*>/g) ?? []) {
      if (full()) return map;
      const [source, destination] = pair.match(/<[0-9A-Fa-f\s]*>/g)!;
      const code = hexValue(source!);
      if (code != null) add(code, hexToString(destination!));
    }
  }
  for (const section of text.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    for (const entry of section.matchAll(/<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>\s*(\[[\s\S]*?\]|<[0-9A-Fa-f\s]*>)/g)) {
      if (full()) return map;
      addRange(entry, add, full);
    }
  }
  return map;
}

/** One `bfrange` entry: an array of destinations, or one destination counted up across the range. */
function addRange(entry: RegExpMatchArray, add: (code: number, value: string) => void, full: () => boolean): void {
  const low = hexValue(entry[1]!);
  const high = hexValue(entry[2]!);
  if (low == null || high == null || high < low || high - low > MAX_CMAP_ENTRIES) return;
  const destination = entry[3]!;
  if (destination.startsWith("[")) {
    (destination.match(/<[0-9A-Fa-f\s]*>/g) ?? []).forEach((value, offset) => add(low + offset, hexToString(value)));
    return;
  }
  const base = hexToString(destination);
  if (base.length !== 1) return;
  for (let code = low; code <= high && !full(); code += 1) add(code, String.fromCharCode(base.charCodeAt(0) + code - low));
}

/** Two-byte big-endian glyph ids, mapped through the document's own CMap. */
function decodeCids(raw: string, toUnicode: ToUnicodeMap): string {
  let out = "";
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const cid = (raw.charCodeAt(index) << 8) | raw.charCodeAt(index + 1);
    out += toUnicode.get(cid) ?? "";
  }
  return out;
}

/** Unescape a PDF literal string body. */
function unescapeLiteral(body: string): string {
  return body.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_match, code: string) => {
    switch (code) {
      case "n": return "\n";
      case "r": return "\r";
      case "t": return "\t";
      case "b": return "\b";
      case "f": return "\f";
      case "(": return "(";
      case ")": return ")";
      case "\\": return "\\";
      default: return String.fromCharCode(Number.parseInt(code, 8));
    }
  });
}

/**
 * One shown string as text under the selected font, or null when that font's
 * glyphs cannot be named.
 *
 * Under a glyph-id font a literal string is two-byte ids too, so it goes
 * through the map rather than being taken at face value. A hex string under a
 * plain font keeps only printable bytes: two digits a byte, and a control code
 * is not a character anyone printed.
 */
function decodeShown(raw: string, font: FontDecoder | null, fromHex: boolean): string | null {
  if (font == null || font.unnamed) return null;
  if (font.cid) return font.toUnicode != null && font.toUnicode.size > 0 ? decodeCids(raw, font.toUnicode) : null;
  let out = "";
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    const mapped = font.toUnicode?.get(code);
    if (mapped != null) out += mapped;
    else if (!fromHex || code >= 32 || code === 10) out += raw[index];
  }
  return out;
}

/** `<48 65 6C>` → the bytes it spells; a trailing odd digit is followed by 0. */
function hexBytes(hex: string): string {
  const digits = hex.replace(/\s+/g, "");
  let out = "";
  for (let index = 0; index < digits.length; index += 2) {
    out += String.fromCharCode(Number.parseInt(digits.slice(index, index + 2).padEnd(2, "0"), 16));
  }
  return out;
}

/** A string, a name, an array bracket, a number (group 1) or a text operator (group 2). */
const TEXT_TOKEN = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\/[^\s/[\]()<>{}%]+|\[|\]|(-?\d*\.?\d+)|(T[JjdDfmz*]|ET|'|")/g;

interface TextOperation {
  operator: string;
  /** The numbers, last name and strings written since the previous operator. */
  numbers: number[];
  name: string;
  strings: { raw: string; hex: boolean }[];
}

/** A content stream's text operators in order; strings after the last one come with an empty operator. */
function* textOperations(stream: string): Generator<TextOperation> {
  let operation: TextOperation = { operator: "", numbers: [], name: "", strings: [] };
  for (const match of stream.matchAll(TEXT_TOKEN)) {
    const token = match[0];
    if (token.startsWith("(")) operation.strings.push({ raw: unescapeLiteral(token.slice(1, -1)), hex: false });
    else if (token.startsWith("<")) operation.strings.push({ raw: hexBytes(token.slice(1, -1)), hex: true });
    else if (token.startsWith("/")) operation.name = token.slice(1);
    else if (match[1] !== undefined) operation.numbers.push(Number(match[1]));
    else if (match[2] !== undefined) {
      yield { ...operation, operator: match[2] };
      operation = { operator: "", numbers: [], name: operation.name, strings: [] };
    }
  }
  if (operation.strings.length > 0) yield operation;
}

/** The strings an operation shows, decoded, and their advance at `scale`; null in a font it cannot name. */
function shownText(strings: TextOperation["strings"], font: FontDecoder | null, scale: number): { text: string; advance: number } | null {
  let text = "";
  let advance = 0;
  for (const { raw, hex } of strings) {
    const shown = decodeShown(raw, font, hex);
    if (shown == null) return null;
    text += shown;
    for (const character of raw) advance += (font?.widths?.get(character.charCodeAt(0)) ?? 0) * scale;
  }
  return { text, advance };
}

/**
 * The strings of one content stream in reading order, or null when a string is
 * shown in a font whose glyphs cannot be named. `Tf` selects the font; a
 * vertical `Td` and `T*`, `ET`, `'`, `"` break the line, so a table's rows stay
 * separate lines — which is what makes a statement line parseable at all.
 */
function showText(stream: string, fonts: Map<string, FontDecoder> | null, documentDefault: FontDecoder | null): string | null {
  let out = "";
  let font = documentDefault;
  for (const { operator, numbers, name, strings } of textOperations(stream)) {
    const shown = shownText(strings, font, 0);
    if (!shown) return null;
    out += shown.text;
    if (operator === "Tf") font = fonts?.get(name) ?? documentDefault;
    else if (operator === "Td" || operator === "TD") out += numbers.at(-1) ? "\n" : " ";
    else if (["T*", "ET", "'", '"'].includes(operator)) out += "\n";
  }
  return out;
}

/**
 * Runs this close in height share a row; a wider gap between runs is a space.
 * Points. On the owner's Akbank statement gaps between runs were ~0 or ≥ 6.
 */
const ROW_TOLERANCE = 3;
const WORD_GAP = 3;

interface TextRun {
  x: number;
  y: number;
  end: number;
  text: string;
}

/**
 * A page that sets each glyph group at an absolute position (`Tm` then `Td`),
 * read back as rows: by height, then left to right. Stream order says nothing
 * about reading order there.
 */
function positionedText(stream: string, fonts: Map<string, FontDecoder>): string | null {
  const runs: TextRun[] = [];
  let font: FontDecoder | null = null;
  let size = 0;
  let scale = 1;
  let [x, y] = [0, 0];
  for (const { operator, numbers, name, strings } of textOperations(stream)) {
    const shown = shownText(strings, font, size * scale);
    if (!shown) return null;
    if (shown.text) runs.push({ x, y, end: x + shown.advance, text: shown.text });
    const [last = 0, beforeLast = 0] = numbers.slice(-2).reverse();
    if (operator === "Tf") [font, size] = [fonts.get(name) ?? null, last];
    else if (operator === "Tz") scale = last / 100;
    else if (operator === "Tm") [x, y] = [beforeLast, last];
    else if (operator === "Td" || operator === "TD") [x, y] = [x + beforeLast, y + last];
  }
  return rowsOf(runs);
}

function rowsOf(runs: TextRun[]): string {
  const rows: TextRun[][] = [];
  for (const run of runs.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.at(-1);
    if (row && row[0]!.y - run.y <= ROW_TOLERANCE) row.push(run);
    else rows.push([run]);
  }
  return rows
    .map((row) => row.sort((a, b) => a.x - b.x).map((run, index) => (index > 0 && run.x - row[index - 1]!.end > WORD_GAP ? " " : "") + run.text).join(""))
    .join("\n");
}

/**
 * Undo per-glyph positioning.
 *
 * Some producers place every single glyph with its own `Td`, so the gap this
 * module emits between runs lands between every CHARACTER: `S o n Ö d e m e`
 * instead of `Son Ödeme`. A real word boundary is still visible, because it is
 * the run gap PLUS the space glyph's own advance — it arrives as two spaces
 * where an intra-word gap arrives as one.
 *
 * Applied per line and only when the line actually looks like that (most of
 * its tokens are one character long), so a normally-spaced statement — the
 * common case — is returned untouched rather than being reflowed on a guess.
 */
function collapseGlyphSpacing(line: string): string {
  const tokens = line.split(" ");
  const printable = tokens.filter((token) => token.length > 0);
  if (printable.length < 6) return line;
  const singles = printable.filter((token) => token.length === 1).length;
  if (singles / printable.length < 0.7) return line;
  // An empty token is the doubled space, i.e. the word boundary.
  let out = "";
  for (const token of tokens) out += token.length === 0 ? " " : token;
  return out.replace(/ {2,}/g, " ").trim();
}

/**
 * The text layer of a PDF, or a reason it could not be read.
 *
 * A failure is always a NAMED reason, never an empty string: the review flow
 * has to tell the owner "this is a scan" apart from "this is not a PDF" apart
 * from "this is locked", and each of those has a different next step.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextResult> {
  if (bytes.byteLength > MAX_PDF_BYTES) return { ok: false, reason: "too_large" };
  if (bytes.byteLength < 5) return { ok: false, reason: "not_a_pdf" };
  const header = bytesToLatin1(bytes, 0, Math.min(1024, bytes.byteLength));
  if (!header.startsWith("%PDF-")) return { ok: false, reason: "not_a_pdf" };

  let streams: PdfStreams;
  try {
    const { Unzlib } = await import("fflate");
    streams = contentStreams(bytes, Unzlib);
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  // Encryption is checked on the trailer, not the header, and is checked before
  // "no text" so a locked file is not reported as a scan.
  const tail = bytesToLatin1(bytes, Math.max(0, bytes.byteLength - 4096), bytes.byteLength);
  if (/\/Encrypt\b/.test(tail)) return { ok: false, reason: "encrypted" };

  const raw = bytesToLatin1(bytes);
  const document = [raw, ...streams.packed.map((object) => object.text)].join("\n");
  const pageCount = (document.match(/\/Type\s*\/Page[^s]/g) ?? []).length;

  /**
   * Which map decodes each string — or the refusal to guess.
   *
   * A glyph id means different characters in different fonts, so each `Tf`
   * picks its font's own `ToUnicode` CMap. Where a string's font cannot be
   * named that way the document's single CMap still serves; with several, or
   * with none for a glyph font, choosing one would silently mistranslate the
   * text, and that is reported as its own reason.
   */
  const usesGlyphIds = /\/Encoding\s*\/Identity-[HV]/.test(document) || /\/Subtype\s*\/Type0/.test(document);
  const fonts = resolveFonts(objectBodies(raw, streams.packed), streams);
  // Once rather than per stream: four hundred streams sharing one full CMap
  // took 962 ms when each parsed it again.
  const fallback = documentFont(usesGlyphIds, streams.cmaps);
  const positioned = (stream: string) => [...stream.matchAll(/\/([^\s/[\]()<>{}%]+)\s+[-\d.]+\s+Tf/g)].some((m) => fonts?.get(m[1]!)?.widths);
  const shown = streams.content.map((stream) => positioned(stream) ? positionedText(stream, fonts!) : showText(stream, fonts, fallback));
  if (shown.some((stream) => stream == null)) return { ok: false, reason: "unmapped_font" };

  const text = shown
    .join("\n")
    .split("\n")
    // Per line, and BEFORE any whitespace collapse: the collapse is what
    // destroys the doubled space that marks a real word boundary.
    .map((line) => collapseGlyphSpacing(line.replace(/\t/g, " ")))
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .trim();
  if (text.length === 0) return { ok: false, reason: "no_text_layer" };
  return { ok: true, text, pageCount: Math.max(1, pageCount) };
}
