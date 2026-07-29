import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ os: "web" }));
const nativeFile = vi.hoisted(() => ({
  size: 0,
  text: vi.fn(async () => "{}"),
  bytes: vi.fn(async () => new Uint8Array()),
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return platform.os;
    },
  },
}));

vi.mock("expo-file-system", () => ({
  File: class {
    get size() {
      return nativeFile.size;
    }

    text() {
      return nativeFile.text();
    }

    bytes() {
      return nativeFile.bytes();
    }
  },
}));

import { readPickedBytes, readPickedText } from "../src/services/picked-file";

describe("picked file limits", () => {
  beforeEach(() => {
    platform.os = "web";
    nativeFile.size = 0;
    nativeFile.text.mockClear();
    nativeFile.bytes.mockClear();
    vi.unstubAllGlobals();
  });

  it("rejects a web byte asset from File.size before allocating its contents", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(11));
    const asset = {
      uri: "blob:workbook",
      name: "workbook.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      file: { size: 11, arrayBuffer },
    };

    await expect(readPickedBytes(asset as never, 10, "Dosya çok büyük.")).rejects.toThrow("Dosya çok büyük.");
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("rejects a web text asset from File.size before allocating its contents", async () => {
    const text = vi.fn(async () => "{}");
    const asset = {
      uri: "blob:backup",
      name: "backup.json",
      mimeType: "application/json",
      file: { size: 11, text },
    };

    await expect(readPickedText(asset as never, 10, "Yedek çok büyük.")).rejects.toThrow("Yedek çok büyük.");
    expect(text).not.toHaveBeenCalled();
  });

  it("rejects a native asset from the filesystem size before reading it", async () => {
    platform.os = "ios";
    nativeFile.size = 11;
    const asset = {
      uri: "file:///workbook.xlsx",
      name: "workbook.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };

    await expect(readPickedBytes(asset as never, 10, "Dosya çok büyük.")).rejects.toThrow("Dosya çok büyük.");
    expect(nativeFile.bytes).not.toHaveBeenCalled();
  });

  it("stops a web fallback response while its stream crosses the limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(11))));
    const asset = {
      uri: "blob:workbook",
      name: "workbook.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };

    await expect(readPickedBytes(asset as never, 10, "Dosya çok büyük.")).rejects.toThrow("Dosya çok büyük.");
  });

  it("checks the actual byte count when picker metadata understates it", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(11));
    const asset = {
      uri: "blob:workbook",
      name: "workbook.xlsx",
      size: 5,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      file: { size: 5, arrayBuffer },
    };

    await expect(readPickedBytes(asset as never, 10, "Dosya çok büyük.")).rejects.toThrow("Dosya çok büyük.");
    expect(arrayBuffer).toHaveBeenCalledOnce();
  });
});
