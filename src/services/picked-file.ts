import { Platform } from "react-native";
import type { DocumentPickerAsset } from "expo-document-picker";
import { File as ExpoFile } from "expo-file-system";
import { UserFacingError } from "../domain/user-error";

/** Read a document-picker asset through the API native to its platform.
 * Web assets carry a browser File; passing their blob URL to expo-file-system
 * throws before reading. Native assets remain sandbox file URIs. */
export async function readPickedText(
  asset: DocumentPickerAsset,
  maxBytes: number,
  tooLargeMessage: string,
  invalidEncodingMessage: string,
): Promise<string> {
  const bytes = await readPickedBytes(asset, maxBytes, tooLargeMessage);
  if (!isValidUtf8(bytes)) throw new UserFacingError(invalidEncodingMessage);
  if (Platform.OS === "web") {
    return new TextDecoder().decode(bytes);
  }
  // Bare Hermes has no TextDecoder. Validate the native bytes above, then let
  // Expo decode the same bounded file instead of adding a second codec.
  return new ExpoFile(asset.uri).text();
}

export async function readPickedBytes(
  asset: DocumentPickerAsset,
  maxBytes: number,
  tooLargeMessage: string,
): Promise<Uint8Array> {
  assertKnownSize([asset.size, asset.file?.size], maxBytes, tooLargeMessage);
  if (Platform.OS === "web") {
    if (asset.file) {
      const bytes = new Uint8Array(await asset.file.arrayBuffer());
      assertKnownSize([bytes.byteLength], maxBytes, tooLargeMessage);
      return bytes;
    }
    const response = await fetch(asset.uri);
    if (!response.ok) throw new Error(`Selected file could not be read (${response.status})`);
    return readBoundedResponse(response, maxBytes, tooLargeMessage);
  }
  const file = new ExpoFile(asset.uri);
  assertKnownSize([file.size], maxBytes, tooLargeMessage);
  const bytes = await file.bytes();
  assertKnownSize([bytes.byteLength], maxBytes, tooLargeMessage);
  return bytes;
}

function assertKnownSize(sizes: readonly (number | null | undefined)[], maxBytes: number, message: string): void {
  if (sizes.some((size) => typeof size === "number" && Number.isFinite(size) && size > maxBytes)) {
    throw new UserFacingError(message);
  }
}

function isValidUtf8(bytes: Uint8Array): boolean {
  let index = 0;
  while (index < bytes.length) {
    const first = bytes[index++]!;
    if (first <= 0x7f) continue;
    let remaining: number;
    let codePoint: number;
    let minimum: number;
    if (first >= 0xc2 && first <= 0xdf) {
      remaining = 1;
      codePoint = first & 0x1f;
      minimum = 0x80;
    } else if (first >= 0xe0 && first <= 0xef) {
      remaining = 2;
      codePoint = first & 0x0f;
      minimum = 0x800;
    } else if (first >= 0xf0 && first <= 0xf4) {
      remaining = 3;
      codePoint = first & 0x07;
      minimum = 0x10000;
    } else {
      return false;
    }
    if (index + remaining > bytes.length) return false;
    for (let offset = 0; offset < remaining; offset += 1) {
      const next = bytes[index++]!;
      if ((next & 0xc0) !== 0x80) return false;
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    if (codePoint < minimum || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return false;
  }
  return true;
}

async function readBoundedResponse(response: Response, maxBytes: number, message: string): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  assertKnownSize([Number.isFinite(contentLength) ? contentLength : null], maxBytes, message);

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertKnownSize([bytes.byteLength], maxBytes, message);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      assertKnownSize([total], maxBytes, message);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
