/**
 * Post a feedback report to the edge function that emails it (spec §4.1).
 *
 * Thin on purpose: every rule about what a report may contain lives in
 * `domain/feedback.ts`, and the sending itself is one authenticated call.
 * What this module owns is the part neither of those can — turning the two
 * failure modes a person can act on into distinct answers.
 *
 * There are three, and they are not the same problem:
 *
 *   - `unconfigured` — this build has no Supabase, so there is nothing to post
 *     to. Local-only installs are a supported way to run Helix, and the form
 *     says so instead of offering a button that cannot work.
 *   - `unauthenticated` — signed out. The function refuses anonymous reports,
 *     and finding that out after typing is worse than being told before.
 *   - `failed` — everything else: offline, a provider outage, a refused
 *     payload. The caller keeps the draft.
 */

import { Platform } from "react-native";
import Constants from "expo-constants";
import { getSupabase, isSupabaseConfigured } from "../sync/supabase";
import {
  MAX_FEEDBACK_IMAGES,
  MAX_FEEDBACK_TOTAL_IMAGE_BYTES,
  feedbackImageRejection,
  feedbackImagesBytes,
  feedbackMessageRejection,
  isFeedbackCategory,
  toBase64,
  type FeedbackCategory,
} from "../domain/feedback";
import { devError } from "./logger";

export type FeedbackResult = "sent" | "unconfigured" | "unauthenticated" | "failed";

export interface FeedbackImage {
  mimeType: string;
  filename: string;
  bytes: Uint8Array;
}

export interface FeedbackSubmission {
  category: FeedbackCategory;
  message: string;
  images: readonly FeedbackImage[];
}

/** The build a report came from, so a fixed bug is not chased in a stale one. */
function appVersion(): string {
  const version = Constants.expoConfig?.version;
  const runtime = Constants.expoConfig?.runtimeVersion;
  const runtimeLabel = typeof runtime === "string" ? runtime : null;
  return [version, runtimeLabel].filter(Boolean).join(" · ") || "bilinmiyor";
}

export async function sendFeedback(submission: FeedbackSubmission): Promise<FeedbackResult> {
  if (!isSupabaseConfigured) return "unconfigured";

  // Re-checked here rather than trusted from the form: this is the last point
  // that can refuse without spending a round trip, and the form is not the
  // only thing that could ever call it.
  if (!isFeedbackCategory(submission.category)) return "failed";
  if (feedbackMessageRejection(submission.message) !== null) return "failed";
  const images = submission.images;
  if (images.length > MAX_FEEDBACK_IMAGES) return "failed";
  if (images.some((image) => feedbackImageRejection(image.mimeType, image.bytes.byteLength) !== null)) {
    return "failed";
  }
  // The whole batch, not each file: four images that each clear the per-image
  // cap can still be an email no mail host will take.
  if (feedbackImagesBytes(images.map((image) => ({ byteLength: image.bytes.byteLength }))) > MAX_FEEDBACK_TOTAL_IMAGE_BYTES) {
    return "failed";
  }

  const supabase = getSupabase();
  if (!supabase) return "unconfigured";

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return "unauthenticated";

  try {
    const { error } = await supabase.functions.invoke("send-feedback", {
      body: {
        category: submission.category,
        message: submission.message.trim(),
        platform: Platform.OS,
        appVersion: appVersion(),
        images: images.map((image) => ({
          mimeType: image.mimeType,
          filename: image.filename,
          base64: toBase64(image.bytes),
        })),
      },
    });
    if (error) {
      devError("feedback.send", error);
      return "failed";
    }
    return "sent";
  } catch (error) {
    devError("feedback.send", error);
    return "failed";
  }
}
