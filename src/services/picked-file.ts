import { Platform } from "react-native";
import type { DocumentPickerAsset } from "expo-document-picker";
import { File as ExpoFile } from "expo-file-system";
import { UserFacingError } from "../domain/user-error";
import { utf8ByteLength } from "../domain/input";

/** Read a document-picker asset through the API native to its platform.
 * Web assets carry a browser File; passing their blob URL to expo-file-system
 * throws before reading. Native assets remain sandbox file URIs. */
export async function readPickedText(
  asset: DocumentPickerAsset,
  maxBytes: number,
  tooLargeMessage: string,
): Promise<string> {
  assertKnownSize([asset.size, asset.file?.size], maxBytes, tooLargeMessage);
  if (Platform.OS === "web") {
    if (asset.file) {
      const content = await asset.file.text();
      assertKnownSize([utf8ByteLength(content)], maxBytes, tooLargeMessage);
      return content;
    }
    const response = await fetch(asset.uri);
    if (!response.ok) throw new Error(`Selected file could not be read (${response.status})`);
    return new TextDecoder().decode(await readBoundedResponse(response, maxBytes, tooLargeMessage));
  }
  const file = new ExpoFile(asset.uri);
  assertKnownSize([file.size], maxBytes, tooLargeMessage);
  const content = await file.text();
  assertKnownSize([utf8ByteLength(content)], maxBytes, tooLargeMessage);
  return content;
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
