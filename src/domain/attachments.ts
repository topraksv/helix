/**
 * Receipts, invoices and warranty documents kept beside a transaction (spec §3.1c).
 *
 * Every rule an attachment has to obey lives here, as pure functions, because
 * three layers have to agree about them: the picker that accepts a file, the
 * repository that writes the row, and `backup-validation.ts`, which is the
 * last gate a restored or synced row passes. A rule living in only one of
 * those is a rule a restore can walk around.
 *
 * The bytes never leave the device (see `attachments` in `db/schema.ts`), so
 * the risk here is not exfiltration through sync — it is a stored name that
 * addresses somewhere it should not, and a display name that lies about what
 * the file is.
 */

/** What the app will store. Anything else is refused at the picker. */
export const ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
] as const;
export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number];

export const ATTACHMENT_KINDS = ["receipt", "invoice", "warranty", "other"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/**
 * 25 MB. Large enough for a photographed multi-page invoice, small enough that
 * a mistaken video pick is refused before it is copied into app storage.
 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** One canonical extension per accepted type, used to build the stored name. */
const EXTENSION_BY_MIME: Record<AttachmentMimeType, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/webp": "webp",
};

/** Extensions the accepted types may legitimately arrive with. */
const ALLOWED_EXTENSIONS: Record<AttachmentMimeType, readonly string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/heic": ["heic", "heif"],
  "image/webp": ["webp"],
};

export function isAttachmentMimeType(value: unknown): value is AttachmentMimeType {
  return typeof value === "string" && (ATTACHMENT_MIME_TYPES as readonly string[]).includes(value);
}

export function isAttachmentKind(value: unknown): value is AttachmentKind {
  return typeof value === "string" && (ATTACHMENT_KINDS as readonly string[]).includes(value);
}

/**
 * Characters a stored display name may never contain.
 *
 * C0 and C1 controls, plus the bidirectional overrides. The last group is not
 * pedantry: "fatura\u202egpj.exe" renders to a reader as `fatura exe.jpg`, which is a
 * file claiming to be something it is not, in a list the owner scans quickly.
 */
const UNSAFE_NAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

/**
 * A display name safe to store, list and write into an export manifest.
 *
 * Rejected rather than sanitized: a name containing a path separator, a
 * traversal segment or a control character is not a name with a typo in it,
 * and quietly rewriting it would hide from the owner that the file they picked
 * is not the file that got stored.
 */
export function isSafeAttachmentFileName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const name = value.trim();
  if (name === "" || name.length > 160) return false;
  if (name === "." || name === "..") return false;
  if (name.includes("/") || name.includes("\\")) return false;
  return !UNSAFE_NAME_CHARACTERS.test(name);
}

/** The extension a name claims, lowercased, or null when it claims none. */
export function claimedExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
}

export type AttachmentRejection =
  | "unsupported_type"
  | "extension_mismatch"
  | "unsafe_name"
  | "too_large"
  | "empty";

export interface AcceptedAttachment {
  fileName: string;
  mimeType: AttachmentMimeType;
  byteSize: number;
}

/**
 * Whether a picked file may be stored at all.
 *
 * The declared type and the name's extension must agree. A picker reports the
 * type the OS guessed, and a `.pdf` arriving as `image/png` means one of the
 * two is wrong — which one does not matter, because the app has no reason to
 * pick a winner on the owner's behalf.
 */
export function classifyAttachment(candidate: {
  fileName: unknown;
  mimeType: unknown;
  byteSize: unknown;
}): { ok: true; value: AcceptedAttachment } | { ok: false; reason: AttachmentRejection } {
  if (!isAttachmentMimeType(candidate.mimeType)) return { ok: false, reason: "unsupported_type" };
  if (!isSafeAttachmentFileName(candidate.fileName)) return { ok: false, reason: "unsafe_name" };
  const fileName = candidate.fileName.trim();
  const extension = claimedExtension(fileName);
  if (extension == null || !ALLOWED_EXTENSIONS[candidate.mimeType].includes(extension)) {
    return { ok: false, reason: "extension_mismatch" };
  }
  const byteSize = candidate.byteSize;
  if (typeof byteSize !== "number" || !Number.isInteger(byteSize) || byteSize <= 0) {
    return { ok: false, reason: "empty" };
  }
  if (byteSize > MAX_ATTACHMENT_BYTES) return { ok: false, reason: "too_large" };
  return { ok: true, value: { fileName, mimeType: candidate.mimeType, byteSize } };
}

/**
 * The device-local basename a stored file gets.
 *
 * Derived from the row id, never from the owner's name: the display name is
 * whatever their file was called, and using it on disk would put a
 * user-controlled string into a path. The row id is a UUIDv7 the app
 * generated, so the on-disk name is collision-free and free of every
 * character a filesystem cares about.
 */
export function storedAttachmentName(id: string, mimeType: AttachmentMimeType): string {
  const safeId = id.replace(/[^A-Za-z0-9-]/g, "");
  if (safeId === "") throw new Error("Attachment id has no storable characters");
  return `${safeId}.${EXTENSION_BY_MIME[mimeType]}`;
}

/** A stored basename this app could have written. Anything else is refused. */
export function isStoredAttachmentName(value: unknown): value is string {
  return typeof value === "string"
    && /^[A-Za-z0-9._-]{1,120}$/.test(value)
    && value !== "."
    && value !== ".."
    && !value.startsWith("-");
}
