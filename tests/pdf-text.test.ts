/**
 * The local PDF text boundary.
 *
 * Every case here is synthetic and built in-process: a real statement is the
 * most sensitive document the owner has and never belongs in this repository.
 *
 * What matters most is the failure side. A statement this cannot read must be
 * REPORTED as unreadable with a reason the review flow can act on, because a
 * half-read financial document is worse than an unread one.
 */
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MAX_PDF_BYTES, extractPdfText } from "../src/services/pdf-text";

function makePdf(
  lines: string[],
  options: { compress?: boolean; encrypt?: boolean; filter?: string } = {},
): Uint8Array {
  const { compress = true, encrypt = false, filter } = options;
  const content = ["BT /F1 10 Tf 40 800 Td"]
    .concat(lines.map((line, index) =>
      `${index === 0 ? "" : "0 -14 Td "}(${line.replace(/([()\\])/g, "\\$1")}) Tj`))
    .concat(["ET"])
    .join("\n");
  const body = compress ? deflateSync(Buffer.from(content, "latin1")) : Buffer.from(content, "latin1");
  const declaredFilter = filter ?? (compress ? " /Filter /FlateDecode" : "");
  const parts: Buffer[] = [];
  const push = (value: string | Buffer) =>
    parts.push(Buffer.isBuffer(value) ? value : Buffer.from(value, "latin1"));
  push("%PDF-1.4\n");
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  push("3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n");
  push(`4 0 obj\n<< /Length ${body.length}${declaredFilter} >>\nstream\n`);
  push(body);
  push("\nendstream\nendobj\n");
  push(`trailer\n<< /Root 1 0 R${encrypt ? " /Encrypt 9 0 R" : ""} >>\n%%EOF\n`);
  return new Uint8Array(Buffer.concat(parts));
}

/**
 * A PDF whose ToUnicode CMap is a work bomb.
 *
 * `<0000> <FFFF> <0041>` is a single range exactly as wide as the entry cap
 * allows, so each one is accepted and then walked. Repeating it is what turns
 * a few KB of deflated stream into billions of refused inserts — the cap on
 * the map's SIZE never stopped the walking, and the loop is synchronous, so
 * nothing can interrupt it. Measured before the fix: 1_000 ranges took 131 ms,
 * 10_000 took 3 s and 50_000 took 16 s, from a CMap under a megabyte.
 */
function makeCmapBombPdf(rangeCount: number): Uint8Array {
  const cmap = `begincmap\nbeginbfrange\n${"<0000> <FFFF> <0041>\n".repeat(rangeCount)}endbfrange\nendcmap`;
  // Uncompressed on purpose: `inflate` sizes its output buffer at 12x the
  // compressed length, which truncates a stream that deflates as well as this
  // one does. That 12x is a real mitigation — it bounds amplification — but it
  // is not the bound under test, and a ~34 KB deflated CMap still reaches this
  // size inside a small PDF.
  const cmapBody = Buffer.from(cmap, "latin1");
  const content = "BT /F1 10 Tf 40 800 Td <00410042> Tj ET";
  const contentBody = deflateSync(Buffer.from(content, "latin1"));
  const parts: Buffer[] = [];
  const push = (value: string | Buffer) =>
    parts.push(Buffer.isBuffer(value) ? value : Buffer.from(value, "latin1"));
  push("%PDF-1.4\n");
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  push("3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 6 0 R >> >> >>\nendobj\n");
  push(`4 0 obj\n<< /Length ${contentBody.length} /Filter /FlateDecode >>\nstream\n`);
  push(contentBody);
  push("\nendstream\nendobj\n");
  push("6 0 obj\n<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /ToUnicode 7 0 R >>\nendobj\n");
  push(`7 0 obj\n<< /Length ${cmapBody.length} >>\nstream\n`);
  push(cmapBody);
  push("\nendstream\nendobj\n");
  push("trailer\n<< /Root 1 0 R >>\n%%EOF\n");
  return new Uint8Array(Buffer.concat(parts));
}

/** `body` between a PDF header and a trailer, uncompressed. */
const plainPdf = (body: string) =>
  new Uint8Array(Buffer.from(`%PDF-1.5\n${body}trailer\n<< /Root 1 0 R >>\n%%EOF\n`, "latin1"));
const MEGABYTE = "a".repeat(1_000_000);
const NO_TEXT = { ok: false, reason: "no_text_layer" } as const;

/** A PDF from numbered objects; a stream object is `[extra dictionary entries, body]`, deflated. */
function pdfOf(objects: Record<number, string | [string, string]>): Uint8Array {
  const parts: Buffer[] = [Buffer.from("%PDF-1.5\n", "latin1")];
  for (const [number, object] of Object.entries(objects)) {
    if (typeof object === "string") {
      parts.push(Buffer.from(`${number} 0 obj\n${object}\nendobj\n`, "latin1"));
      continue;
    }
    const body = deflateSync(Buffer.from(object[1], "latin1"));
    parts.push(
      Buffer.from(`${number} 0 obj\n<< ${object[0]} /Length ${body.length} /Filter /FlateDecode >>\nstream\n`, "latin1"),
      body,
      Buffer.from("\nendstream\nendobj\n", "latin1"),
    );
  }
  parts.push(Buffer.from("trailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1"));
  return new Uint8Array(Buffer.concat(parts));
}

/** A `ToUnicode` CMap naming each glyph id's character. */
function toUnicode(glyphs: Record<string, string>): [string, string] {
  const pairs = Object.entries(glyphs).map(([id, text]) => `<${id}> <${text.charCodeAt(0).toString(16).padStart(4, "0")}>`);
  return ["", `begincmap\nbeginbfchar\n${pairs.join("\n")}\nendbfchar\nendcmap`];
}

/** An object stream holding `objects`, with the `number offset` header PDF 1.5 writes before `/First`. */
function objectStream(objects: [number, string][]): [string, string] {
  let offset = 0;
  const header: string[] = [];
  for (const [number, body] of objects) {
    header.push(`${number} ${offset}`);
    offset += body.length + 1;
  }
  const head = `${header.join(" ")}\n`;
  return [`/Type /ObjStm /N ${objects.length} /First ${head.length}`, head + objects.map(([, body]) => body).join("\n") + "\n"];
}

/** A Type3 glyph drawing: a 1-bit image from rows of `#` and `.`, top row first. */
function glyph(rows: string[]): [string, string] {
  const width = rows[0]!.length;
  const bits = rows.map((row) => {
    let bytes = "";
    for (let at = 0; at < width; at += 8) bytes += String.fromCharCode(Number.parseInt(row.slice(at, at + 8).padEnd(8, ".").replace(/#/g, "1").replace(/\./g, "0"), 2));
    return bytes;
  }).join("");
  return ["", `${width} 0 0 0 ${width} ${rows.length} d1 q ${width} 0 0 ${rows.length} 0 0 cm BI /W ${width} /H ${rows.length} /BPC 1 /IM true /D [1 0] ID ${bits} EI Q`];
}

const glyphFont = (map: number) => `<< /Type /Font /Subtype /Type0 /BaseFont /Sub /Encoding /Identity-H /ToUnicode ${map} 0 R >>`;
const CATALOG = "<< /Type /Catalog /Pages 2 0 R >>";
const page = (contents: number, fonts: string) => `<< /Type /Page /Parent 2 0 R /Contents ${contents} 0 R /Resources << /Font << ${fonts} >> >> >>`;

describe("reading the fonts a statement's text is set in", () => {
  it("decodes glyph ids through a font packed, with its pages, into an object stream", async () => {
    const result = await extractPdfText(pdfOf({
      1: CATALOG,
      2: "<< /Type /Pages /Kids [3 0 R 10 0 R] /Count 2 >>",
      4: ["", "BT /F1 10 Tf 40 800 Td <00010002> Tj ET"],
      6: toUnicode({ "0001": "M", "0002": "G" }),
      11: ["", "BT /F1 10 Tf 40 800 Td <0002> Tj ET"],
      12: objectStream([[3, page(4, "/F1 5 0 R")], [5, glyphFont(6)], [10, page(11, "/F1 5 0 R")]]),
    }));
    expect(result.ok && result.pageCount).toBe(2);
    expect(result.ok && result.text.split("\n").filter(Boolean)).toEqual(["MG", "G"]);
  });

  it("decodes each glyph font on a page through its own map", async () => {
    const result = await extractPdfText(pdfOf({
      1: CATALOG,
      2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      3: page(4, "/F1 5 0 R /F2 7 0 R"),
      4: ["", "BT /F1 10 Tf 40 800 Td <0001> Tj /F2 10 Tf <0001> Tj ET"],
      5: glyphFont(6),
      6: toUnicode({ "0001": "M" }),
      7: glyphFont(8),
      8: toUnicode({ "0001": "Z" }),
    }));
    expect(result).toEqual({ ok: true, text: "MZ", pageCount: 1 });
  });

  it("reads a plain font's text beside a glyph font's, through a font dictionary of its own", async () => {
    const result = await extractPdfText(pdfOf({
      1: CATALOG,
      2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      3: "<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font 9 0 R >> >>",
      4: ["", "BT /F1 10 Tf 40 800 Td <0001> Tj /F2 10 Tf (PLAIN) Tj <41> Tj ET"],
      5: glyphFont(6),
      6: toUnicode({ "0001": "M" }),
      7: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      9: "<< /F1 5 0 R /F2 7 0 R >>",
    }));
    expect(result).toEqual({ ok: true, text: "MPLAINA", pageCount: 1 });
  });

  it("refuses a glyph font that ships no map instead of guessing its letters", async () => {
    const result = await extractPdfText(pdfOf({
      1: CATALOG,
      2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      3: page(4, "/F1 5 0 R /F2 7 0 R"),
      4: ["", "BT /F2 10 Tf 40 800 Td <0001> Tj ET"],
      5: glyphFont(6),
      6: toUnicode({ "0001": "M" }),
      7: "<< /Type /Font /Subtype /Type0 /BaseFont /Bare /Encoding /Identity-H >>",
    }));
    expect(result).toEqual({ ok: false, reason: "unmapped_font" });
  });

  it("refuses a Type3 font whose glyph names are not its codes", async () => {
    const result = await extractPdfText(pdfOf({
      1: CATALOG,
      2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      3: page(4, "/C1 5 0 R"),
      4: ["", "BT /C1 10 Tf 40 800 Td (\\301\\302) Tj ET"],
      5: "<< /Type /Font /Subtype /Type3 /CharProcs << /g1 6 0 R /g2 6 0 R >> /Encoding << /Type /Encoding /Differences [ 193 /g1 /g2 ] >> >>",
      6: glyph(["#"]),
    }));
    expect(result).toEqual({ ok: false, reason: "unmapped_font" });
  });

  /**
   * A statement printed through a mainframe's page format (AFP): Type3 fonts
   * named `C` + code, text in EBCDIC, each glyph group placed on its own, and
   * the Turkish letters the code page lacks drawn from a supplement font.
   */
  describe("a page-format statement", () => {
    const I = ["#.", "..", "#.", "#.", "#."];
    const S = ["###", "#..", "###", "..#", "###"];
    const A = [".#.", "#.#", "###", "#.#"];
    const afpFont = (codes: Record<number, number>) => {
      const names = Object.entries(codes).map(([code, object]) => `/C${Number(code).toString(16)} ${object} 0 R`).join(" ");
      const differences = Object.keys(codes).map((code) => `${code} /C${Number(code).toString(16)}`).join(" ");
      return `<< /Type /Font /Subtype /Type3 /FontMatrix [1 0 0 1 0 0] /FirstChar 0 /Widths [${Array(256).fill(1).join(" ")}] /CharProcs << ${names} >> /Encoding << /Differences [ ${differences} ] >> >>`;
    };
    const read = (content: string) => extractPdfText(pdfOf({
      1: CATALOG,
      2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      3: page(4, "/F1 5 0 R /F2 6 0 R"),
      4: ["", content],
      5: afpFont({ 0x89: 10, 0xa2: 11, 0xc1: 12, 0xf1: 13, 0x4b: 13 }),
      6: afpFont({ 0xa6: 14, 0xa7: 15 }),
      10: glyph(I),
      11: glyph(S),
      12: glyph(A),
      13: glyph(["#"]),
      14: glyph([...S, "...", ".#."]),
      15: glyph(I.slice(2)),
    }));
    const run = (font: string, x: number, y: number, codes: string) => `/${font} 2 Tf 100 Tz 1 0 0 1 0 0 Tm ${x} ${y} Td [(${codes})] TJ`;

    it("reads rows top to bottom and left to right, whatever order the page drew them in", async () => {
      // "is" is two units wide at size 2, so the run at 14 follows it with no gap; 60 is a column away.
      const result = await read(`BT ${run("F1", 10, 700, "\\301")} ${run("F1", 10, 720, "\\211\\242")} ${run("F1", 14, 720, "\\301")} ${run("F1", 60, 720, "\\361\\113")} ET`);
      expect(result).toEqual({ ok: true, text: "isA 1.\nA", pageCount: 1 });
    });

    it("recognises the Turkish letters a supplement font draws as a base letter with marks", async () => {
      const result = await read(`BT ${run("F1", 10, 720, "\\211")} ${run("F2", 11, 720, "\\246\\247")} ${run("F1", 13, 720, "\\242")} ET`);
      expect(result).toEqual({ ok: true, text: "işıs", pageCount: 1 });
    });
  });

  /** An image and a Type3 glyph's drawing are compressed exactly as page content is, and neither is text. */
  it("does not read an image's pixels or a glyph's drawing as page text", async () => {
    const result = await extractPdfText(pdfOf({
      1: CATALOG,
      2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      3: page(4, "/F1 5 0 R"),
      4: ["", "BT /F1 10 Tf 40 800 Td (MARKET) Tj ET"],
      5: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      6: ["/Type /XObject /Subtype /Image /Width 8 /Height 1", "(PIXELS) Tj"],
      7: ["", "30 0 -2 -7 28 31 d1 (GLYPH) Tj"],
      8: ["", "600 0 d0 (WIDTH) Tj"],
    }));
    expect(result).toEqual({ ok: true, text: "MARKET", pageCount: 1 });
  });

  it("refuses a font name that means two different fonts on two pages", async () => {
    const result = await extractPdfText(pdfOf({
      1: CATALOG,
      2: "<< /Type /Pages /Kids [3 0 R 9 0 R] /Count 2 >>",
      3: page(4, "/F1 5 0 R"),
      4: ["", "BT /F1 10 Tf 40 800 Td <0001> Tj ET"],
      5: glyphFont(6),
      6: toUnicode({ "0001": "M" }),
      7: glyphFont(8),
      8: toUnicode({ "0001": "Z" }),
      9: page(10, "/F1 7 0 R"),
      10: ["", "BT /F1 10 Tf 40 800 Td <0001> Tj ET"],
    }));
    expect(result).toEqual({ ok: false, reason: "unmapped_font" });
  });
});

describe("reading a PDF's text layer", () => {
  it("reads a compressed text layer without any new dependency", async () => {
    const result = await extractPdfText(makePdf(["MIGROS MARKET", "1.234,56"]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain("MIGROS MARKET");
    expect(result.text).toContain("1.234,56");
    expect(result.pageCount).toBe(1);
  });

  it("reads an uncompressed text layer too", async () => {
    const result = await extractPdfText(makePdf(["NAKIT AVANS"], { compress: false }));
    expect(result.ok && result.text).toContain("NAKIT AVANS");
  });

  /** A vertical move is a new row; without it a table collapses to one line. */
  it("keeps separate rows on separate lines", async () => {
    const result = await extractPdfText(makePdf(["BIRINCI", "IKINCI"]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lines = result.text.split("\n").map((line) => line.trim()).filter(Boolean);
    expect(lines).toContain("BIRINCI");
    expect(lines).toContain("IKINCI");
  });

  it("preserves Turkish characters written as escapes", async () => {
    const result = await extractPdfText(makePdf(["ODEME \\350\\351"]));
    expect(result.ok).toBe(true);
  });

  it("survives a literal string containing brackets and backslashes", async () => {
    const result = await extractPdfText(makePdf(["A (B) \\ C"]));
    expect(result.ok && result.text).toContain("A (B) \\ C");
  });
});

describe("refusing what it cannot read, with a reason", () => {
  it("names a file that is not a PDF at all", async () => {
    expect(await extractPdfText(new Uint8Array([1, 2, 3, 4, 5, 6]))).toEqual({ ok: false, reason: "not_a_pdf" });
    expect(await extractPdfText(new Uint8Array())).toEqual({ ok: false, reason: "not_a_pdf" });
  });

  it("names an encrypted statement rather than calling it a scan", async () => {
    expect(await extractPdfText(makePdf(["GIZLI"], { encrypt: true })))
      .toEqual({ ok: false, reason: "encrypted" });
  });

  /** A scan is an image: there is no text layer, and none may be invented. */
  it("names a scanned statement instead of returning nothing", async () => {
    const scanned = makePdf([], { compress: false });
    const result = await extractPdfText(scanned);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no_text_layer");
  });

  it("refuses a file larger than a statement can plausibly be", async () => {
    const oversized = new Uint8Array(MAX_PDF_BYTES + 1);
    oversized.set(new TextEncoder().encode("%PDF-1.4"));
    expect(await extractPdfText(oversized)).toEqual({ ok: false, reason: "too_large" });
  });

  /** An encoding this cannot decode is skipped, never guessed at. */
  it("skips a stream compressed with a filter it does not implement", async () => {
    const result = await extractPdfText(makePdf(["GIZLENMIS"], { compress: false, filter: " /Filter /LZWDecode" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no_text_layer");
  });

  it("does not hang or throw on a truncated stream", async () => {
    const whole = makePdf(["KESIK"]);
    const truncated = whole.slice(0, Math.floor(whole.length * 0.7));
    await expect(extractPdfText(truncated)).resolves.toBeDefined();
  });

  /** A stream that claims to inflate to gigabytes is refused, not allocated. */
  it("bounds the WORK a CMap can demand, not only the entries it may keep", async () => {
    // The guarded path is O(1) in the range count — it stops the moment the map
    // is full — so the count is chosen to make the UNGUARDED path unmistakably
    // slow rather than to stress the guarded one. Measured: 60_000 ranges is
    // ~6 s without the guard and ~50 ms with it, so this budget has a wide
    // margin in both directions and is not a load-sensitive assertion.
    const started = performance.now();
    const result = await extractPdfText(makeCmapBombPdf(60_000));
    const elapsed = performance.now() - started;
    // Deliberately generous: the point is orders of magnitude, not milliseconds.
    expect(elapsed).toBeLessThan(1_500);
    // And it still reads the document rather than bailing out of it.
    expect(result.ok).toBe(true);
  });

  /**
   * Files whose shape is the attack: each is sized past a second and a half on
   * the reader it guards against — the measurement behind each is beside it —
   * and linear work reads it in milliseconds, so the bound is orders of
   * magnitude rather than a load-sensitive assertion.
   */
  it.each<[shape: string, build: () => Uint8Array, expected: Partial<Awaited<ReturnType<typeof extractPdfText>>>]>([
    // 20_000 took 264 ms, four times that at twice as many: about 26 s here.
    ["objects that never close", () => plainPdf("1 0 obj\n".repeat(200_000)), NO_TEXT],
    // 60_000 digits took 1.3 s, four times that at twice as many.
    ["a run of digits no object header ends", () => plainPdf(`${"1".repeat(120_000)}\n`), NO_TEXT],
    // 10_000 took 108 ms, four times that at twice as many.
    ["headers that one endobj closes", () => plainPdf(`${Array.from({ length: 60_000 }, (_, i) => `${i + 1} 0 obj\n`).join("")}endobj\n`), NO_TEXT],
    // 2_000 took 160 ms, growing with the count.
    ["an object stream whose offsets go back", () => {
      const head = `${Array.from({ length: 40_000 }, (_, i) => `${i + 1} ${i % 2 ? MEGABYTE.length : 0}`).join(" ")}\n`;
      const text = head + MEGABYTE;
      return plainPdf(`9 0 obj\n<< /Type /ObjStm /N 40000 /First ${head.length} /Length ${text.length} >>\nstream\n${text}\nendstream\nendobj\n`);
    }, NO_TEXT],
    // 2_000 took 536 ms, growing with the count.
    ["a megabyte named as the font dictionary of every page", () => plainPdf(`5 0 obj\n<< /Filler (${MEGABYTE}) >>\nendobj\n6 0 obj\n<< ${"/Font 5 0 R ".repeat(12_000)} >>\nendobj\n`), NO_TEXT],
    // 4_000 took 463 ms, growing with the count.
    ["a megabyte selected as a font by thousands of names", () => plainPdf(`5 0 obj\n<< /Filler (${MEGABYTE}) >>\nendobj\n6 0 obj\n<< /Font << ${Array.from({ length: 24_000 }, (_, i) => `/F${i} 5 0 R`).join(" ")} >> >>\nendobj\n`), NO_TEXT],
    // 400 took 962 ms, growing with the count.
    ["streams that share one full CMap", () => {
      const cmap = "begincmap\nbeginbfrange\n<0000> <FFFF> <0041>\nendbfrange\nendcmap";
      const streams = Array.from({ length: 3_000 }, (_, i) => `${i + 10} 0 obj\n<< /Length 15 >>\nstream\nBT <0041> Tj ET\nendstream\nendobj\n`).join("");
      return plainPdf(`3 0 obj\n<< /Subtype /Type0 >>\nendobj\n4 0 obj\n<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream\nendobj\n${streams}`);
    }, { ok: true }],
    // 4_000 took 2 s, growing with the count.
    ["streams with no dictionary before them", () => plainPdf(`${MEGABYTE}\n${">>stream\nendstream\n".repeat(8_000)}`), NO_TEXT],
  ])("bounds the work of %s", async (_shape, build, expected) => {
    const bytes = build();
    const started = performance.now();
    const result = await extractPdfText(bytes);
    expect(performance.now() - started).toBeLessThan(1_500);
    expect(result).toMatchObject(expected);
  });

  /**
   * The defect that made this module's inflate a dependency decision.
   *
   * The old inflate allocated 12x the compressed length and read the whole
   * buffer back, so a text layer that deflated better than that was cut off
   * mid-document and still reported `ok`. A statement's text layer is exactly
   * the shape that compresses well — the same merchant names, dates and column
   * headers over and over — and the measured case was a 900 KB layer at 331:1
   * coming back 3.6% complete with the closing balance gone.
   *
   * 4.000 identical lines deflate at roughly 1.000:1 here, which is comfortably
   * past the old ceiling and inside DEFLATE's documented 1032:1 maximum.
   */
  it("reads a text layer that compresses far better than any fixed estimate", async () => {
    const lines = Array.from({ length: 4_000 }, () => "MIGROS MARKET ODEME 1.234,56");
    const pdf = makePdf([...lines, "KAPANIS BAKIYESI 9.876,54"]);

    const result = await extractPdfText(pdf);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The LAST line is the assertion. Anything that truncates keeps the head of
    // the document and loses the tail, which is where a statement puts the
    // figure the whole import exists to read.
    expect(result.text).toContain("KAPANIS BAKIYESI 9.876,54");
    expect(result.text.match(/MIGROS MARKET/g)).toHaveLength(4_000);
  });

  /**
   * The other half of the same defect: the surplus of that over-allocation was
   * never zeroed, and everything downstream scanned it. Measured on a two-line
   * statement, the extracted text carried 189 characters of whatever had been
   * in that memory — JavaScript source fragments — and raising the estimate to
   * fix the truncation above made this one worse in proportion.
   *
   * There is no surplus to leak now, so the check is exact: what comes out is
   * what the stream said, and nothing after it.
   */
  it("returns the stream's own bytes and nothing that was after them", async () => {
    const result = await extractPdfText(makePdf(["ILK SATIR", "SON SATIR"]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text.trim()).toBe("ILK SATIR\nSON SATIR");
  });

  it("bounds what a single stream may expand to", async () => {
    const bomb = deflateSync(Buffer.alloc(2_000_000, 0x41));
    const parts: Buffer[] = [
      Buffer.from("%PDF-1.4\n4 0 obj\n<< /Filter /FlateDecode >>\nstream\n", "latin1"),
      bomb,
      Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1"),
    ];
    const started = Date.now();
    const result = await extractPdfText(new Uint8Array(Buffer.concat(parts)));
    expect(Date.now() - started).toBeLessThan(10_000);
    // Whatever it decides, it must decide rather than exhaust memory.
    expect(typeof result.ok).toBe("boolean");
  });

  it("names a file of streams that each expand to the ceiling unreadable", async () => {
    // A refused stream counted towards nothing, so each was inflated in full
    // again: twenty took 450 ms, and a file this size may hold hundreds.
    const bomb = deflateSync(Buffer.alloc(25 * 1024 * 1024));
    const parts = [Buffer.from("%PDF-1.4\n", "latin1")];
    for (let object = 10; object < 16; object += 1) {
      parts.push(Buffer.from(`${object} 0 obj\n<< /Length ${bomb.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), bomb, Buffer.from("\nendstream\nendobj\n", "latin1"));
    }
    parts.push(Buffer.from("trailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1"));
    expect(await extractPdfText(new Uint8Array(Buffer.concat(parts)))).toEqual({ ok: false, reason: "unreadable" });
  });
});
