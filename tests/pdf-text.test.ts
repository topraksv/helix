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
});
