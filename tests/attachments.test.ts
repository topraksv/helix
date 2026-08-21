/**
 * Attachment rules.
 *
 * The bytes never leave the device, so the risk here is not exfiltration
 * through sync — it is a stored name that addresses somewhere it should not,
 * and a display name that lies about what a file is. Both are pinned here, and
 * both are re-checked where the name becomes a path — `attachment-store.ts`
 * refuses to resolve an unsafe name and `attachment-store.web.ts` refuses to
 * key storage with one — because a row can arrive from sync or a restored
 * backup rather than from the picker.
 */
import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_KINDS,
  ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  claimedExtension,
  classifyAttachment,
  isAttachmentKind,
  isAttachmentMimeType,
  isSafeAttachmentFileName,
  isStoredAttachmentName,
  storedAttachmentName,
} from "../src/domain/attachments";

const accepted = { fileName: "fatura.pdf", mimeType: "application/pdf", byteSize: 1024 };

describe("what may be attached", () => {
  it("accepts the document types the product stores", () => {
    for (const mimeType of ATTACHMENT_MIME_TYPES) expect(isAttachmentMimeType(mimeType)).toBe(true);
    for (const kind of ATTACHMENT_KINDS) expect(isAttachmentKind(kind)).toBe(true);
    expect(classifyAttachment(accepted)).toEqual({
      ok: true,
      value: { fileName: "fatura.pdf", mimeType: "application/pdf", byteSize: 1024 },
    });
  });

  it("accepts the alternative extensions a real type arrives with", () => {
    expect(classifyAttachment({ fileName: "fis.jpeg", mimeType: "image/jpeg", byteSize: 10 }).ok).toBe(true);
    expect(classifyAttachment({ fileName: "fis.heif", mimeType: "image/heic", byteSize: 10 }).ok).toBe(true);
  });

  it("refuses a type it will not store", () => {
    for (const mimeType of ["application/zip", "text/html", "application/x-msdownload", "", null, 7]) {
      expect(classifyAttachment({ ...accepted, mimeType }), String(mimeType))
        .toEqual({ ok: false, reason: "unsupported_type" });
    }
  });

  /**
   * The declared type and the name's extension have to agree. A `.pdf` that
   * arrives as `image/png` means one of the two is wrong, and the app has no
   * business picking a winner on the owner's behalf.
   */
  it("refuses a name whose extension contradicts its type", () => {
    expect(classifyAttachment({ ...accepted, fileName: "fatura.png" }))
      .toEqual({ ok: false, reason: "extension_mismatch" });
    expect(classifyAttachment({ ...accepted, fileName: "fatura" }))
      .toEqual({ ok: false, reason: "extension_mismatch" });
    expect(classifyAttachment({ ...accepted, fileName: "fatura." }))
      .toEqual({ ok: false, reason: "extension_mismatch" });
  });

  it("bounds the size in both directions", () => {
    expect(classifyAttachment({ ...accepted, byteSize: 0 })).toEqual({ ok: false, reason: "empty" });
    expect(classifyAttachment({ ...accepted, byteSize: -1 })).toEqual({ ok: false, reason: "empty" });
    expect(classifyAttachment({ ...accepted, byteSize: 1.5 })).toEqual({ ok: false, reason: "empty" });
    expect(classifyAttachment({ ...accepted, byteSize: MAX_ATTACHMENT_BYTES })).toMatchObject({ ok: true });
    expect(classifyAttachment({ ...accepted, byteSize: MAX_ATTACHMENT_BYTES + 1 }))
      .toEqual({ ok: false, reason: "too_large" });
  });
});

describe("names that must never be stored", () => {
  it("refuses a path rather than sanitizing it", () => {
    for (const fileName of ["../../etc/passwd", "a/b.pdf", "a\\b.pdf", ".", "..", "", "   "]) {
      expect(isSafeAttachmentFileName(fileName), JSON.stringify(fileName)).toBe(false);
    }
  });

  /**
   * A right-to-left override renders `fatura<RLO>gpj.exe` as `fatura exe.jpg`:
   * a file claiming to be something it is not, in a list the owner scans fast.
   */
  it("refuses a name that disguises its own extension", () => {
    expect(isSafeAttachmentFileName("fatura\u202egpj.exe")).toBe(false);
    expect(isSafeAttachmentFileName("fatura\u200e.pdf")).toBe(false);
    expect(isSafeAttachmentFileName("fatura\u0000.pdf")).toBe(false);
    expect(isSafeAttachmentFileName("fatura\u007f.pdf")).toBe(false);
  });

  it("bounds the length and keeps ordinary Turkish names", () => {
    expect(isSafeAttachmentFileName("Ağustos Faturası.pdf")).toBe(true);
    expect(isSafeAttachmentFileName(`${"a".repeat(161)}.pdf`)).toBe(false);
  });

  it("reads the claimed extension without being fooled by a leading dot", () => {
    expect(claimedExtension("a.b.PDF")).toBe("pdf");
    expect(claimedExtension(".pdf")).toBeNull();
    expect(claimedExtension("noext")).toBeNull();
  });
});

describe("the name a file is stored under", () => {
  /**
   * Derived from the row id, never from the owner's name: the display name is
   * whatever their file was called, and using it on disk would put a
   * user-controlled string into a path.
   */
  it("is built from the row id and the type, not from the owner's name", () => {
    const name = storedAttachmentName("0198f2aa-1c2d-7e3f-8a9b-0c1d2e3f4a5b", "application/pdf");
    expect(name).toBe("0198f2aa-1c2d-7e3f-8a9b-0c1d2e3f4a5b.pdf");
    expect(isStoredAttachmentName(name)).toBe(true);
  });

  it("strips anything a filesystem would care about out of the id", () => {
    expect(storedAttachmentName("../../evil id", "image/png")).toBe("evilid.png");
  });

  it("refuses an id with nothing storable left rather than writing a bare dot", () => {
    expect(() => storedAttachmentName("///", "image/png")).toThrow();
  });

  /** Re-checked at read time: the row may have come from sync or a restore. */
  it("refuses a stored name this app could not have written", () => {
    for (const name of ["../escape.pdf", "a/b.pdf", ".", "..", "-rf.pdf", "", `${"a".repeat(121)}.pdf`, null, 5]) {
      expect(isStoredAttachmentName(name), JSON.stringify(name)).toBe(false);
    }
  });
});
