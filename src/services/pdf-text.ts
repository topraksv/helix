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
 * FlateDecoded content streams and the text-showing operators inside them. It
 * does not do encryption, object streams, CID font mapping, or images — which
 * is why a scanned statement produces NO text and is reported as unsupported
 * rather than guessed at. Every one of those limits is a deliberate refusal to
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
function inflate(bytes: Uint8Array, Unzlib: UnzlibCtor): Uint8Array | null {
  if (!hasZlibHeader(bytes)) return null;
  const parts: Uint8Array[] = [];
  let written = 0;
  let overflowed = false;
  const stream = new Unzlib((chunk) => {
    if (overflowed) return;
    written += chunk.length;
    if (written > MAX_STREAM_BYTES) {
      overflowed = true;
      return;
    }
    parts.push(chunk);
  });
  try {
    for (let at = 0; at < bytes.length && !overflowed; at += INFLATE_STEP) {
      const end = Math.min(at + INFLATE_STEP, bytes.length);
      stream.push(bytes.subarray(at, end), end === bytes.length);
    }
  } catch {
    // Corrupt or not actually deflate. It THROWS rather than spinning, which
    // the previous inflate did not — `hasZlibHeader` below is kept anyway,
    // because refusing early is still cheaper than unwinding.
    return null;
  }
  if (overflowed) return null;
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
function contentStreams(bytes: Uint8Array, Unzlib: UnzlibCtor): { content: string[]; cmaps: string[] } {
  const haystack = bytesToLatin1(bytes);
  const streams: string[] = [];
  const cmaps: string[] = [];
  let total = 0;
  const opener = />>\s*stream\r?\n?/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(haystack)) !== null) {
    const start = match.index + match[0].length;
    const close = haystack.indexOf("endstream", start);
    if (close === -1) break;
    opener.lastIndex = close + "endstream".length;

    // The dictionary is the text back to its own opening `<<`, bounded so a
    // malformed file cannot make this scan the whole document.
    const dictionaryStart = haystack.lastIndexOf("<<", match.index);
    const dictionary = dictionaryStart === -1 || match.index - dictionaryStart > 2000
      ? haystack.slice(Math.max(0, match.index - 2000), match.index)
      : haystack.slice(dictionaryStart, match.index);

    // Only what this can decode. An image, an LZW stream or an unfiltered
    // binary blob is skipped rather than guessed at.
    const isFlate = /\/Filter\s*(?:\[\s*)?\/FlateDecode/.test(dictionary);
    const hasOtherFilter = /\/Filter\s*(?:\[\s*)?\/(?!FlateDecode)[A-Za-z]/.test(dictionary);
    if (hasOtherFilter && !isFlate) continue;

    const declared = declaredLength(dictionary);
    const end = declared != null && start + declared <= close ? start + declared : close;
    const raw = bytes.subarray(start, end);
    const decoded = isFlate ? inflate(raw, Unzlib) : raw;
    if (!decoded) continue;
    const text = bytesToLatin1(decoded);
    total += text.length;
    if (total > MAX_TEXT_LENGTH) break;
    // A CMap is not page content and must never be scanned for text: its own
    // body is full of hex that would otherwise be read as words.
    if (text.includes("begincmap")) cmaps.push(text);
    else streams.push(text);
  }
  return { content: streams, cmaps };
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
    if (map.size >= MAX_CMAP_ENTRIES || value === "") return;
    map.set(code, value);
  };

  for (const section of text.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    if (map.size >= MAX_CMAP_ENTRIES) break;
    for (const pair of section.match(/<[0-9A-Fa-f\s]+>\s*<[0-9A-Fa-f\s]*>/g) ?? []) {
      if (map.size >= MAX_CMAP_ENTRIES) break;
      const [source, destination] = pair.match(/<[0-9A-Fa-f\s]*>/g) ?? [];
      const code = source ? hexValue(source) : null;
      if (code == null || destination == null) continue;
      add(code, hexToString(destination));
    }
  }

  for (const section of text.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    if (map.size >= MAX_CMAP_ENTRIES) break;
    const body = section.replace(/^beginbfrange/, "").replace(/endbfrange$/, "");
    const entry = /<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>\s*(\[[\s\S]*?\]|<[0-9A-Fa-f\s]*>)/g;
    let match: RegExpExecArray | null;
    while ((match = entry.exec(body)) !== null) {
      if (map.size >= MAX_CMAP_ENTRIES) break;
      const low = hexValue(match[1]!);
      const high = hexValue(match[2]!);
      if (low == null || high == null || high < low || high - low > MAX_CMAP_ENTRIES) continue;
      const destination = match[3]!;
      if (destination.startsWith("[")) {
        const values = destination.match(/<[0-9A-Fa-f\s]*>/g) ?? [];
        values.forEach((value, offset) => add(low + offset, hexToString(value)));
        continue;
      }
      const base = hexToString(destination);
      if (base.length !== 1) continue;
      const start = base.charCodeAt(0);
      for (let code = low; code <= high && map.size < MAX_CMAP_ENTRIES; code += 1) {
        add(code, String.fromCharCode(start + (code - low)));
      }
    }
  }
  return map;
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
 * Pull the shown strings out of one content stream, in reading order.
 *
 * Only `Tj`, `TJ`, `'` and `"` show text. `Td`/`TD`/`T*`/`ET` move the cursor,
 * and a vertical move is treated as a line break so a table's rows stay
 * separate lines — which is what makes a statement line parseable at all.
 */
function showText(stream: string, toUnicode: ToUnicodeMap | null): string {
  let out = "";
  const operator = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\[|\]|(-?\d*\.?\d+)|(T[JjdD*]|ET|'|")/g;
  let pendingNumbers: number[] = [];
  let match: RegExpExecArray | null;
  let buffer = "";
  while ((match = operator.exec(stream)) !== null) {
    const token = match[0];
    if (token.startsWith("(")) {
      const literal = unescapeLiteral(token.slice(1, -1));
      // Under Identity-H a literal string is still two-byte glyph ids, so it
      // goes through the same map rather than being taken at face value.
      buffer += toUnicode ? decodeCids(literal, toUnicode) : literal;
      continue;
    }
    if (token.startsWith("<") && token.endsWith(">")) {
      // A hex string. Two digits per byte; anything else is a CID encoding
      // this does not map, and mapping it wrongly would invent characters.
      const hex = token.slice(1, -1).replace(/\s+/g, "");
      if (toUnicode) {
        // Two hex digits are half a glyph id: Identity-H is a two-byte
        // encoding, and reading it a byte at a time is what produced garbage.
        for (let index = 0; index + 3 < hex.length + 1; index += 4) {
          const cid = Number.parseInt(hex.slice(index, index + 4), 16);
          buffer += toUnicode.get(cid) ?? "";
        }
      } else if (hex.length % 2 === 0) {
        for (let index = 0; index < hex.length; index += 2) {
          const code = Number.parseInt(hex.slice(index, index + 2), 16);
          if (code >= 32 || code === 10) buffer += String.fromCharCode(code);
        }
      }
      continue;
    }
    if (match[1] !== undefined) {
      pendingNumbers.push(Number(match[1]));
      continue;
    }
    const op = match[2];
    if (op === "Tj" || op === "TJ" || op === "'" || op === '"') {
      out += buffer;
      buffer = "";
      if (op === "'" || op === '"') out += "\n";
      pendingNumbers = [];
      continue;
    }
    if (op === "Td" || op === "TD") {
      out += buffer;
      buffer = "";
      // A negative vertical move is a new line of the document.
      const vertical = pendingNumbers.at(-1) ?? 0;
      if (vertical !== 0) out += "\n";
      else out += " ";
      pendingNumbers = [];
      continue;
    }
    if (op === "T*" || op === "ET") {
      out += buffer;
      buffer = "";
      out += "\n";
      pendingNumbers = [];
      continue;
    }
  }
  return out + buffer;
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

  let streams: { content: string[]; cmaps: string[] };
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

  const document = bytesToLatin1(bytes);
  const pageCount = (document.match(/\/Type\s*\/Page[^s]/g) ?? []).length;

  /**
   * Which map decodes this document — or the refusal to guess.
   *
   * With exactly one `ToUnicode` CMap, every glyph id in the file belongs to
   * it and it can be applied globally. With SEVERAL, a glyph id means
   * different characters in different fonts, and choosing one would silently
   * mistranslate the others: attributing glyphs to fonts needs the resource
   * graph this extractor deliberately does not parse. Refusing is the only
   * honest answer, and it is reported as its own reason.
   */
  const usesGlyphIds = /\/Encoding\s*\/Identity-[HV]/.test(document) || /\/Subtype\s*\/Type0/.test(document);
  if (usesGlyphIds && streams.cmaps.length !== 1) return { ok: false, reason: "unmapped_font" };
  const toUnicode = usesGlyphIds ? parseToUnicode(streams.cmaps[0]!) : null;
  if (usesGlyphIds && (toUnicode == null || toUnicode.size === 0)) {
    return { ok: false, reason: "unmapped_font" };
  }

  const text = streams.content
    .map((stream) => showText(stream, toUnicode))
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
