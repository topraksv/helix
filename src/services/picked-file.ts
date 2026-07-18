import { Platform } from "react-native";
import type { DocumentPickerAsset } from "expo-document-picker";
import { File as ExpoFile } from "expo-file-system";

/** Read a document-picker asset through the API native to its platform.
 * Web assets carry a browser File; passing their blob URL to expo-file-system
 * throws before reading. Native assets remain sandbox file URIs. */
export async function readPickedText(asset: DocumentPickerAsset): Promise<string> {
  if (Platform.OS === "web") {
    if (asset.file) return asset.file.text();
    const response = await fetch(asset.uri);
    if (!response.ok) throw new Error(`Selected file could not be read (${response.status})`);
    return response.text();
  }
  return new ExpoFile(asset.uri).text();
}

export async function readPickedBytes(asset: DocumentPickerAsset): Promise<Uint8Array> {
  if (Platform.OS === "web") {
    if (asset.file) return new Uint8Array(await asset.file.arrayBuffer());
    const response = await fetch(asset.uri);
    if (!response.ok) throw new Error(`Selected file could not be read (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }
  return new ExpoFile(asset.uri).bytes();
}
