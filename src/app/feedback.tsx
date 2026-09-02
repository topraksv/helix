/**
 * Report a problem from inside the app (spec §4.1).
 *
 * A root-level route rather than one inside the Settings stack, so closing it
 * returns to wherever it was opened from. It is opened from the foot of
 * Settings today; a future "report this screen" affordance would want the same
 * behaviour.
 *
 * The category is a `ChoiceTile` grid and not a `Select`, because the six
 * options ARE the content of the decision: each carries a sentence saying what
 * belongs in it, and a dropdown would hide exactly the part that makes the
 * reporter and the owner mean the same thing by "görsel hata".
 *
 * Every refusal is INLINE and immediate. An alert for a file that is too big
 * interrupts the person to tell them something the form could have shown them
 * where they were already looking, and it says nothing about how far over the
 * limit they were — so each message names the real figure and stays on screen
 * beside the control that produced it.
 */

import React, { useState } from "react";
import { View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { Image } from "expo-image";
import * as DocumentPicker from "expo-document-picker";
import ImageIcon from "lucide-react-native/icons/image";
import ImagePlus from "lucide-react-native/icons/image-plus";
import MessageSquare from "lucide-react-native/icons/message-square";
import Send from "lucide-react-native/icons/send";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import X from "lucide-react-native/icons/x";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_IMAGE_MIME_TYPES,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_MESSAGE_MIN,
  MAX_FEEDBACK_IMAGES,
  MAX_FEEDBACK_IMAGE_BYTES,
  MAX_FEEDBACK_TOTAL_IMAGE_BYTES,
  byteSizeLabel,
  feedbackAttachmentRejection,
  feedbackImagesBytes,
  feedbackMessageRejection,
  type FeedbackCategory,
  type FeedbackImageRejection,
} from "../domain/feedback";
import { sendFeedback, type FeedbackImage } from "../services/feedback";
import { readPickedBytes } from "../services/picked-file";
import { devError } from "../services/logger";
import { tr } from "../i18n/tr";
import {
  Body,
  Button,
  Card,
  ChoiceTile,
  Field,
  IconButton,
  PanelHeader,
  Row,
  Screen,
  SectionHeader,
} from "../ui/components";
import { placeholderPools, useRotatingPlaceholder } from "../ui/placeholders";
import { useUndo } from "../ui/undo";
import { shouldUseTripleTileGrid } from "../ui/responsive";
import { useContentWidth } from "../ui/viewport";
import { radius, spacing, type, useTheme } from "../ui/theme";

/** A picked screenshot, plus what the form needs to show it. */
interface PickedImage extends FeedbackImage {
  displayName: string;
  /** The picker's own URI, used only to draw the thumbnail. */
  uri: string;
}

const PER_IMAGE_LABEL = byteSizeLabel(MAX_FEEDBACK_IMAGE_BYTES);
const TOTAL_LABEL = byteSizeLabel(MAX_FEEDBACK_TOTAL_IMAGE_BYTES);
const THUMBNAIL = 84;

export default function FeedbackScreen() {
  const router = useRouter();
  const undo = useUndo();
  const { palette } = useTheme();
  const tripleTiles = shouldUseTripleTileGrid(useContentWidth());
  const [category, setCategory] = useState<FeedbackCategory>("visual");
  const [message, setMessage] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Shown only after a send is attempted, so the form does not scold as you type. */
  const [attempted, setAttempted] = useState(false);

  const trimmed = message.trim();
  const rejection = feedbackMessageRejection(message);
  const messageError = attempted && rejection
    ? rejection === "empty"
      ? tr.feedback.rejected.empty
      : rejection === "tooShort"
        ? tr.feedback.rejected.tooShort(FEEDBACK_MESSAGE_MIN, trimmed.length)
        : tr.feedback.rejected.tooLong(FEEDBACK_MESSAGE_MAX, trimmed.length)
    : null;
  const canSend = rejection === null && !busy;
  const usedBytes = feedbackImagesBytes(images.map((image) => ({ byteLength: image.bytes.byteLength })));
  const full = images.length >= MAX_FEEDBACK_IMAGES;
  // The example cycles only while the field is empty — a placeholder nobody can
  // see is movement that costs a re-render and shows nothing.
  const messagePlaceholder = useRotatingPlaceholder(placeholderPools.feedback, { active: message === "" });

  /** Why this file cannot join the ones already picked, said with real figures. */
  const refusalText = (reason: FeedbackImageRejection, mimeType: string, byteLength: number): string => {
    if (reason === "type") return tr.feedback.rejected.type(mimeType || tr.feedback.rejected.unknownType);
    if (reason === "size") return tr.feedback.rejected.size(PER_IMAGE_LABEL, byteSizeLabel(byteLength));
    if (reason === "count") return tr.feedback.rejected.count(MAX_FEEDBACK_IMAGES);
    return tr.feedback.rejected.total(TOTAL_LABEL, byteSizeLabel(usedBytes), byteSizeLabel(byteLength));
  };

  const pickImages = async () => {
    setImageError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [...FEEDBACK_IMAGE_MIME_TYPES],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (picked.canceled || !picked.assets?.length) return;

      // Accumulated inside the loop, not read from state: each accepted file
      // changes what the next one is allowed to be, and `setImages` has not
      // landed yet when the second file is checked.
      const accepted: PickedImage[] = [];
      let firstRefusal: string | null = null;
      for (const asset of picked.assets) {
        const mimeType = asset.mimeType ?? "";
        const sofar = [...images, ...accepted].map((image) => ({ byteLength: image.bytes.byteLength }));
        // The type is knowable without reading the file, so a PDF is refused
        // before its bytes are ever loaded.
        const typeRejection = feedbackAttachmentRejection(sofar, { mimeType, byteLength: 1 });
        if (typeRejection === "type" || typeRejection === "count") {
          firstRefusal ??= refusalText(typeRejection, mimeType, asset.size ?? 0);
          continue;
        }
        let bytes: Uint8Array;
        try {
          bytes = await readPickedBytes(asset, MAX_FEEDBACK_IMAGE_BYTES, tr.feedback.rejected.size(PER_IMAGE_LABEL, byteSizeLabel(asset.size ?? MAX_FEEDBACK_IMAGE_BYTES + 1)));
        } catch (error) {
          devError("feedback.read", error);
          firstRefusal ??= asset.size != null && asset.size > MAX_FEEDBACK_IMAGE_BYTES
            ? tr.feedback.rejected.size(PER_IMAGE_LABEL, byteSizeLabel(asset.size))
            : tr.feedback.rejected.unreadable;
          continue;
        }
        const reason = feedbackAttachmentRejection(sofar, { mimeType, byteLength: bytes.byteLength });
        if (reason) {
          firstRefusal ??= refusalText(reason, mimeType, bytes.byteLength);
          continue;
        }
        const name = asset.name || `ekran-goruntusu-${images.length + accepted.length + 1}`;
        if ([...images, ...accepted].some((image) => image.displayName === name && image.bytes.byteLength === bytes.byteLength)) {
          firstRefusal ??= tr.feedback.rejected.duplicate;
          continue;
        }
        accepted.push({ mimeType, filename: name, displayName: name, uri: asset.uri, bytes });
      }
      if (accepted.length > 0) setImages((current) => [...current, ...accepted]);
      // One message, for the first thing that went wrong: a list of four
      // refusals is not more useful than the reason the first one failed.
      setImageError(firstRefusal);
    } catch (error) {
      devError("feedback.pick", error);
      setImageError(tr.feedback.rejected.unreadable);
    }
  };

  const removeImage = (index: number) => {
    setImageError(null);
    setImages((current) => current.filter((_, position) => position !== index));
  };

  const submit = async () => {
    setAttempted(true);
    if (feedbackMessageRejection(message) !== null) return;
    setBusy(true);
    try {
      const result = await sendFeedback({ category, message, images });
      if (result === "sent") {
        undo.show(tr.feedback.sent);
        router.back();
        return;
      }
      setImageError(
        result === "unauthenticated"
          ? tr.feedback.unauthenticated
          : result === "unconfigured"
            ? tr.feedback.unconfigured
            : tr.feedback.failed,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen width="form">
      <Body muted style={{ marginBottom: spacing.sm }}>{tr.feedback.intro}</Body>
      {/* This form is a collection point: the message, the category and any
          screenshot leave the device and travel through a third country. */}
      <View style={{ marginBottom: spacing.lg, alignItems: "flex-start" }}>
        <Button
          label={tr.legal.readNotice}
          variant="ghost"
          size="sm"
          onPress={() => router.push("/privacy" as Href)}
        />
      </View>

      <SectionHeader>{tr.feedback.categoryLabel}</SectionHeader>
      <View
        role="radiogroup"
        accessibilityLabel={tr.feedback.categoryLabel}
        style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg }}
      >
        {FEEDBACK_CATEGORIES.map((value) => (
          <View
            key={value}
            style={{ flexBasis: tripleTiles ? "31%" : "47%", flexGrow: 1, minWidth: 0 }}
          >
            <ChoiceTile
              selected={category === value}
              onPress={() => setCategory(value)}
              accessibilityRole="radio"
              label={tr.feedback.category[value]}
              description={tr.feedback.categoryHint[value]}
            />
          </View>
        ))}
      </View>

      <Card>
        <PanelHeader
          icon={MessageSquare}
          title={tr.feedback.messageLabel}
          description={tr.feedback.categoryHint[category]}
        />
        <Field
          noMargin
          label={tr.feedback.messageLabel}
          value={message}
          onChangeText={(value) => setMessage(value.slice(0, FEEDBACK_MESSAGE_MAX))}
          placeholder={messagePlaceholder}
          multiline
          error={messageError}
          testID="feedback-message"
        />
        {/* The count is a live fact, not a warning: it turns amber only as the
            ceiling comes into reach, so it is silent for every ordinary report. */}
        <Body
          muted
          style={{
            marginTop: spacing.xs,
            textAlign: "right",
            fontSize: type.small.fontSize,
            color: message.length > FEEDBACK_MESSAGE_MAX - 200 ? palette.warningText : palette.textSecondary,
          }}
        >
          {tr.feedback.messageCount(message.length, FEEDBACK_MESSAGE_MAX)}
        </Body>
      </Card>

      <SectionHeader description={tr.feedback.imageHint(MAX_FEEDBACK_IMAGES, PER_IMAGE_LABEL, TOTAL_LABEL)}>
        {tr.feedback.imageTitle}
      </SectionHeader>
      <Card>
        {images.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md }}>
            {images.map((image, index) => (
              <View key={`${image.displayName}-${index}`} style={{ width: THUMBNAIL }}>
                <View
                  style={{
                    width: THUMBNAIL,
                    height: THUMBNAIL,
                    borderRadius: radius.sm,
                    overflow: "hidden",
                    backgroundColor: palette.surfaceAlt,
                  }}
                >
                  {/* The picture itself, not a filename. A person checking
                      they attached the right screenshot should not have to
                      read "IMG_4821.PNG" to find out. */}
                  <Image
                    alt=""
                    source={{ uri: image.uri }}
                    style={{ width: "100%", height: "100%" }}
                    contentFit="cover"
                  />
                </View>
                <Row style={{ alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
                  <Body muted style={{ fontSize: type.small.fontSize, flex: 1, minWidth: 0 }}>
                    {byteSizeLabel(image.bytes.byteLength)}
                  </Body>
                  <IconButton
                    icon={X}
                    tone="danger"
                    label={`${tr.feedback.imageRemove} · ${image.displayName}`}
                    onPress={() => removeImage(index)}
                  />
                </Row>
              </View>
            ))}
          </View>
        ) : null}

        <Button
          icon={images.length > 0 ? ImagePlus : ImageIcon}
          variant="secondary"
          label={images.length > 0 ? tr.feedback.imageAddMore : tr.feedback.imageAdd}
          onPress={() => void pickImages()}
          disabled={busy || full}
          testID="feedback-add-image"
        />
        {images.length > 0 || full ? (
          <Body muted style={{ marginTop: spacing.xs, fontSize: type.small.fontSize }}>
            {full
              ? tr.feedback.imageFull
              : tr.feedback.imageCount(images.length, MAX_FEEDBACK_IMAGES, byteSizeLabel(usedBytes))}
          </Body>
        ) : null}
      </Card>

      {/* Inline, live, and where the person is already looking. It carries the
          alert role so a screen reader is told the moment the refusal appears,
          which a silently-inserted line would not do. */}
      {imageError ? (
        <Card tone="warning">
          <Row gap={spacing.sm} style={{ alignItems: "flex-start" }}>
            <TriangleAlert accessible={false} size={18} color={palette.warningText} />
            <Body
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              testID="feedback-image-error"
              style={{ flex: 1, minWidth: 0, color: palette.warningText }}
            >
              {imageError}
            </Body>
          </Row>
        </Card>
      ) : null}

      <Body muted style={{ marginBottom: spacing.lg, color: palette.textSecondary }}>
        {tr.feedback.privacy}
      </Body>

      <Row>
        <View style={{ flex: 1 }}>
          <Button
            testID="feedback-send"
            icon={Send}
            label={busy ? tr.feedback.sending : tr.feedback.send}
            onPress={() => void submit()}
            disabled={!canSend}
            loading={busy}
          />
        </View>
      </Row>
    </Screen>
  );
}
