/**
 * Posting a feedback report (spec §4.1).
 *
 * What this module owns is not the sending — that is one call — but the three
 * answers a person can act on. A build with no Supabase, a signed-out session
 * and a refused request are different problems with different remedies, and
 * collapsing them into "failed" would tell someone to check their connection
 * when what they need is to sign in.
 *
 * It also re-checks the domain rules rather than trusting the form, because
 * the form is not the only thing that can call it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness: {
  supabase: unknown;
  configured: boolean;
  session: unknown;
  invoke: ReturnType<typeof vi.fn>;
} = {
  supabase: null,
  configured: true,
  session: { access_token: "t" },
  invoke: vi.fn(),
};

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "1.0.0", runtimeVersion: "54" } },
}));
vi.mock("../src/sync/supabase", () => ({
  get isSupabaseConfigured() {
    return harness.configured;
  },
  getSupabase: () => harness.supabase,
}));
vi.mock("../src/services/logger", () => ({ devError: vi.fn() }));

const { devError } = await import("../src/services/logger");
const { MAX_FEEDBACK_IMAGES, MAX_FEEDBACK_TOTAL_IMAGE_BYTES } = await import("../src/domain/feedback");
const { sendFeedback } = await import("../src/services/feedback");

function client() {
  return {
    auth: { getSession: async () => ({ data: { session: harness.session } }) },
    functions: { invoke: harness.invoke },
  };
}

const valid = {
  category: "visual",
  message: "Mali Tablo'da sütun boş kalıyor.",
  images: [],
} as const;

beforeEach(() => {
  harness.configured = true;
  harness.session = { access_token: "t" };
  harness.invoke = vi.fn(async () => ({ error: null }));
  harness.supabase = client();
  vi.mocked(devError).mockClear();
});

describe("the three answers", () => {
  it("sends when configured, signed in and valid", async () => {
    await expect(sendFeedback({ ...valid })).resolves.toBe("sent");
    expect(harness.invoke).toHaveBeenCalledTimes(1);
  });

  it("says a local-only build has nowhere to post, without pretending to fail", async () => {
    harness.configured = false;
    await expect(sendFeedback({ ...valid })).resolves.toBe("unconfigured");
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it("says signed-out rather than failed, because the remedy is different", async () => {
    harness.session = null;
    await expect(sendFeedback({ ...valid })).resolves.toBe("unauthenticated");
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it("reports a refused request as failed and keeps the draft's problem local", async () => {
    harness.invoke = vi.fn(async () => ({ error: { message: "boom" } }));
    harness.supabase = client();
    await expect(sendFeedback({ ...valid })).resolves.toBe("failed");
  });

  it("survives a thrown transport error", async () => {
    harness.invoke = vi.fn(async () => {
      throw new Error("offline");
    });
    harness.supabase = client();
    await expect(sendFeedback({ ...valid })).resolves.toBe("failed");
  });

  it("treats a missing client as unconfigured even when the flag says otherwise", async () => {
    harness.supabase = null;
    await expect(sendFeedback({ ...valid })).resolves.toBe("unconfigured");
  });

  /**
   * A limit is not a failure, and telling them apart is the whole point.
   *
   * The screen says "wait" for one and "try again" for the other, and a person
   * told to retry a rate limit will retry it — which is the behaviour the
   * limit exists to stop. The function answers 429 and nothing else does, so
   * the status is the contract; the body is the function's own and may change.
   */
  it("reads a rate limit off the status, not off the message", async () => {
    harness.invoke = vi.fn(async () => ({
      error: { message: "Edge Function returned a non-2xx status code", context: { status: 429 } },
    }));
    harness.supabase = client();
    await expect(sendFeedback({ ...valid })).resolves.toBe("rateLimited");
  });

  it("keeps every other refused status a plain failure", async () => {
    // 502 is what the function answers when the mail provider refuses, and 400
    // when it refuses the body itself. Neither is something waiting fixes.
    for (const status of [400, 401, 500, 502]) {
      harness.invoke = vi.fn(async () => ({
        error: { message: "non-2xx", context: { status } },
      }));
      harness.supabase = client();
      await expect(sendFeedback({ ...valid }), `HTTP ${status}`).resolves.toBe("failed");
    }
  });

  it("does not mistake an error with no context for a limit", async () => {
    // A transport error carries no `context` at all. Reading `status` straight
    // off it throws, and the throw is CAUGHT — so the answer is "failed"
    // either way and the outcome alone cannot tell the two apart. What the
    // incident log records can: the refusal reaches it as the invoke error it
    // is, not as a TypeError from this module's own line.
    harness.invoke = vi.fn(async () => ({ error: { message: "Failed to fetch" } }));
    harness.supabase = client();
    await expect(sendFeedback({ ...valid })).resolves.toBe("failed");
    expect(devError).toHaveBeenCalledWith("feedback.send", { message: "Failed to fetch" });
  });

  it("names the same scope whichever way a send fails", async () => {
    // `feedback.send` is what groups these in `incident_summary`; two spellings
    // would make one failure look like two unrelated ones, and an empty scope
    // would file them under nothing at all.
    harness.invoke = vi.fn(async () => ({ error: { message: "boom", context: { status: 502 } } }));
    harness.supabase = client();
    await expect(sendFeedback({ ...valid })).resolves.toBe("failed");
    expect(devError).toHaveBeenCalledWith("feedback.send", expect.anything());

    vi.mocked(devError).mockClear();
    const thrown = new Error("offline");
    harness.invoke = vi.fn(async () => {
      throw thrown;
    });
    harness.supabase = client();
    await expect(sendFeedback({ ...valid })).resolves.toBe("failed");
    expect(devError).toHaveBeenCalledWith("feedback.send", thrown);
  });
});

describe("it re-checks the rules instead of trusting its caller", () => {
  it("refuses an unknown category without spending a round trip", async () => {
    await expect(sendFeedback({ ...valid, category: "bug" as never })).resolves.toBe("failed");
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it("refuses a message under the floor", async () => {
    await expect(sendFeedback({ ...valid, message: "kısa" })).resolves.toBe("failed");
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it("refuses an image of the wrong type", async () => {
    const image = { mimeType: "application/pdf", filename: "a.pdf", bytes: new Uint8Array([1, 2, 3]) };
    await expect(sendFeedback({ ...valid, images: [image] })).resolves.toBe("failed");
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it("refuses an image over the cap", async () => {
    const image = {
      mimeType: "image/png",
      filename: "a.png",
      bytes: new Uint8Array(5 * 1024 * 1024 + 1),
    };
    await expect(sendFeedback({ ...valid, images: [image] })).resolves.toBe("failed");
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it("accepts a full set and refuses one more", async () => {
    const image = { mimeType: "image/png", filename: "a.png", bytes: new Uint8Array(16) };
    const full = Array.from({ length: MAX_FEEDBACK_IMAGES }, () => image);
    await expect(sendFeedback({ ...valid, images: full })).resolves.toBe("sent");
    await expect(sendFeedback({ ...valid, images: [...full, image] })).resolves.toBe("failed");
    expect(harness.invoke).toHaveBeenCalledTimes(1);
  });

  /**
   * Four images that each clear the per-image cap can still be an email no
   * mail host will take, so the batch is weighed as well as each file.
   */
  it("refuses a batch over the shared ceiling even when each file clears its own", async () => {
    const image = (name: string, bytes: number) => ({
      mimeType: "image/png",
      filename: name,
      bytes: new Uint8Array(bytes),
    });
    // Two files that each clear the per-image cap and together land exactly on
    // the shared one. Exactly on it is allowed; one byte past it is not — the
    // limit is what a mail host will take, so the boundary is the point of it.
    const half = 4 * 1024 * 1024;
    const rest = MAX_FEEDBACK_TOTAL_IMAGE_BYTES - half;
    await expect(
      sendFeedback({ ...valid, images: [image("a.png", half), image("b.png", rest)] }),
    ).resolves.toBe("sent");
    await expect(
      sendFeedback({ ...valid, images: [image("a.png", half), image("b.png", rest + 1)] }),
    ).resolves.toBe("failed");
    expect(harness.invoke).toHaveBeenCalledTimes(1);
  });
});

describe("the build a report came from", () => {
  it("carries both the version and the runtime when the manifest has them", async () => {
    await sendFeedback({ ...valid });
    expect(harness.invoke.mock.calls[0]![1].body.appVersion).toBe("1.0.0 · 54");
  });

  it("carries the version alone when there is no runtime", async () => {
    vi.doMock("expo-constants", () => ({ default: { expoConfig: { version: "2.1.0" } } }));
    vi.resetModules();
    const fresh = await import("../src/services/feedback");
    await fresh.sendFeedback({ ...valid });
    expect(harness.invoke.mock.calls[0]![1].body.appVersion).toBe("2.1.0");
    vi.doUnmock("expo-constants");
    vi.resetModules();
  });

  it("ignores a non-string runtime rather than printing an object", async () => {
    vi.doMock("expo-constants", () => ({
      default: { expoConfig: { version: "3.0.0", runtimeVersion: { policy: "sdkVersion" } } },
    }));
    vi.resetModules();
    const fresh = await import("../src/services/feedback");
    await fresh.sendFeedback({ ...valid });
    expect(harness.invoke.mock.calls[0]![1].body.appVersion).toBe("3.0.0");
    vi.doUnmock("expo-constants");
    vi.resetModules();
  });

  it("says so plainly when the manifest carries nothing", async () => {
    vi.doMock("expo-constants", () => ({ default: { expoConfig: null } }));
    vi.resetModules();
    const fresh = await import("../src/services/feedback");
    await fresh.sendFeedback({ ...valid });
    expect(harness.invoke.mock.calls[0]![1].body.appVersion).toBe("bilinmiyor");
    vi.doUnmock("expo-constants");
    vi.resetModules();
  });
});

describe("what crosses the wire", () => {
  it("trims the message and names the platform and build", async () => {
    await sendFeedback({ ...valid, message: "  Sütun boş kalıyor.  " });
    const body = harness.invoke.mock.calls[0]![1].body;
    expect(body.message).toBe("Sütun boş kalıyor.");
    expect(body.category).toBe("visual");
    expect(body.platform).toBe("web");
    expect(body.appVersion).toContain("1.0.0");
    expect(body.images).toEqual([]);
  });

  it("sends the screenshot as base64 the function can decode", async () => {
    const bytes = new TextEncoder().encode("foobar");
    await sendFeedback({
      ...valid,
      images: [{ mimeType: "image/png", filename: "ekran.png", bytes }],
    });
    const body = harness.invoke.mock.calls[0]![1].body;
    expect(body.images).toEqual([{
      mimeType: "image/png",
      filename: "ekran.png",
      base64: "Zm9vYmFy",
    }]);
  });

  it("keeps several screenshots in the order they were attached", async () => {
    const at = (text: string, name: string) => ({
      mimeType: "image/png" as const,
      filename: name,
      bytes: new TextEncoder().encode(text),
    });
    await sendFeedback({ ...valid, images: [at("foo", "bir.png"), at("bar", "iki.png")] });
    const body = harness.invoke.mock.calls[0]![1].body;
    expect(body.images.map((image: { filename: string }) => image.filename)).toEqual(["bir.png", "iki.png"]);
    expect(body.images[0].base64).toBe("Zm9v");
    expect(body.images[1].base64).toBe("YmFy");
  });

  it("posts to the one function name the edge deployment provides", async () => {
    await sendFeedback({ ...valid });
    expect(harness.invoke.mock.calls[0]![0]).toBe("send-feedback");
  });
});
