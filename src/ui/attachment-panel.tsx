/**
 * The documents kept beside one transaction (spec §2.6). Metadata syncs; bytes
 * stay on the device that added them, so a tile without bytes says so instead
 * of offering an open that cannot work. Same grid as the feedback screen.
 */

import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import * as DocumentPicker from "expo-document-picker";
import FileText from "lucide-react-native/icons/file-text";
import ImageIcon from "lucide-react-native/icons/image";
import Paperclip from "lucide-react-native/icons/paperclip";
import X from "lucide-react-native/icons/x";
import { addAttachment, AttachmentRejectedError, deleteAttachment, restoreAttachment, type AttachmentRow } from "../data/repo";
import { ATTACHMENT_MIME_TYPES } from "../domain/attachments";
import { attachmentThumbnail, attachmentsSupported, openAttachment, presentAttachments, storeAttachmentBytes } from "../services/attachment-store";
import { devError } from "../services/logger";
import { fetchAttachment } from "../sync/attachment-mirror";
import { isSupabaseConfigured } from "../sync/supabase";
import { tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { Badge, Body, Button, Card, IconButton, Row, SectionHeader } from "./components";
import { interactionSurface } from "./interaction";
import { appAlert } from "./dialog";
import { useUndo } from "./undo";
import { radius, spacing, type, useTheme } from "./theme";

const kib = (bytes: number) => Math.max(1, Math.round(bytes / 1024));

function rejectionMessage(reason: string): string {
  const known = tr.attachments.rejected as Record<string, string | undefined>;
  return known[reason] ?? tr.errors.saveFailed;
}

/** A page or a picture: the two things a receipt is ever stored as. */
function attachmentIcon(mimeType: string) {
  return mimeType.startsWith("image/") ? ImageIcon : FileText;
}

/** The tile's edge, in points — the same 84 the feedback screen uses. */
const THUMBNAIL = 84;

/**
 * Object URLs for the images in this list, released when the list changes.
 *
 * The browser store hands back a URL that pins its blob in memory until it is
 * revoked, so an edit form opened and closed a few times would hold every
 * receipt it had ever drawn. Native has nothing to release and says so.
 */
function useThumbnails(attachments: readonly AttachmentRow[], present: ReadonlySet<string>): Record<string, string> {
  const [uris, setUris] = useState<Record<string, string>>({});
  const key = attachments.map((a) => `${a.storedName}:${present.has(a.storedName) ? 1 : 0}`).join("|");
  useEffect(() => {
    let cancelled = false;
    const releases: (() => void)[] = [];
    void Promise.all(
      attachments
        .filter((attachment) => present.has(attachment.storedName))
        .map(async (attachment) => {
          const drawn = await attachmentThumbnail(attachment.storedName, attachment.mimeType);
          if (!drawn) return null;
          releases.push(drawn.release);
          return [attachment.id, drawn.uri] as const;
        }),
    )
      .then((pairs) => {
        const found = Object.fromEntries(pairs.filter((pair): pair is readonly [string, string] => pair != null));
        if (cancelled) return;
        setUris(found);
      })
      .catch((error) => devError("attachment.thumbnail", error));
    return () => {
      cancelled = true;
      for (const release of releases) release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the list's identity; the array itself is rebuilt every render.
  }, [key]);
  return uris;
}

export function AttachmentPanel({
  userId,
  transactionId,
  attachments,
}: {
  userId: string;
  transactionId: string;
  attachments: AttachmentRow[];
}) {
  const undo = useUndo();
  const { palette } = useTheme();
  const [busy, setBusy] = useState(false);
  const supported = attachmentsSupported();
  /**
   * Which documents this device actually holds.
   *
   * Asked asynchronously because the browser's store is asynchronous, and
   * re-asked whenever the list changes. Until it answers, nothing claims to be
   * openable — an open button that appears and then fails is worse than one
   * that appears a moment late.
   */
  const [present, setPresent] = useState<ReadonlySet<string>>(new Set());
  const thumbnails = useThumbnails(attachments, present);
  const missingLabel = isSupabaseConfigured ? tr.attachments.otherDevice : tr.attachments.otherDeviceLocal;
  const totalBytes = attachments.reduce((sum, attachment) => sum + attachment.byteSize, 0);
  const storedNames = attachments.map((attachment) => attachment.storedName).join("|");
  useEffect(() => {
    let cancelled = false;
    const names = storedNames === "" ? [] : storedNames.split("|");
    void (async () => {
      const found = await presentAttachments(names);
      if (cancelled) return;
      // Held documents render immediately rather than waiting on the network.
      setPresent(found);
      const missing = names.filter((name) => !found.has(name));
      if (missing.length === 0) return;
      // This is the whole of "lazy download": only the documents on this
      // screen, only when they are not already here. Nothing walks the whole
      // ledger pulling every receipt onto every device.
      const fetched = await Promise.all(missing.map((name) => fetchAttachment(userId, name)));
      if (cancelled || !fetched.some(Boolean)) return;
      const arrived = await presentAttachments(names);
      if (!cancelled) setPresent(arrived);
    })().catch((error) => devError("attachment.presence", error));
    return () => { cancelled = true; };
  }, [storedNames, userId]);

  const pick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [...ATTACHMENT_MIME_TYPES],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      await addAttachment(userId, {
        transactionId,
        fileName: asset.name,
        mimeType: asset.mimeType ?? "",
        byteSize: asset.size ?? 0,
        // The repository decides the destination name and hands it back here;
        // it never receives a path to read from, so nothing outside the
        // picker's own result can be copied into app storage.
        copyInto: (storedName) => storeAttachmentBytes(asset, storedName),
      });
      scheduleSync(userId);
    } catch (error) {
      if (error instanceof AttachmentRejectedError) {
        void appAlert(rejectionMessage(error.reason), tr.errors.title);
        return;
      }
      devError("attachment.add", error);
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    } finally {
      setBusy(false);
    }
  };

  const open = async (attachment: AttachmentRow) => {
    try {
      await openAttachment(attachment.storedName, attachment.mimeType);
    } catch (error) {
      devError("attachment.open", error);
      void appAlert(isSupabaseConfigured ? tr.attachments.unavailable : tr.attachments.unavailableLocal, tr.errors.title);
    }
  };

  const remove = async (attachment: AttachmentRow) => {
    if (busy) return;
    setBusy(true);
    try {
      const snapshot = await deleteAttachment(userId, attachment.id);
      if (!snapshot) return;
      scheduleSync(userId);
      // The bytes are NOT removed here: undo has to be able to bring the whole
      // document back, and a row whose file was already deleted would return
      // as an attachment that cannot be opened. The file is collected by the
      // maintenance sweep once no live row names it.
      undo.show(tr.attachments.removed, async () => {
        await restoreAttachment(userId, snapshot);
        scheduleSync(userId);
      });
    } catch (error) {
      devError("attachment.delete", error);
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View testID="attachment-panel" style={{ marginBottom: spacing.md }}>
      <SectionHeader description={isSupabaseConfigured ? tr.attachments.hint : tr.attachments.hintLocal}>{tr.attachments.title}</SectionHeader>

      <Card>
        {attachments.length === 0 ? (
          <Body muted testID="attachment-empty" style={{ marginBottom: spacing.md }}>{tr.attachments.empty}</Body>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md }}>
            {attachments.map((attachment) => {
              const held = present.has(attachment.storedName);
              const TypeIcon = attachmentIcon(attachment.mimeType);
              const uri = thumbnails[attachment.id];
              return (
                <View key={attachment.id} style={{ width: THUMBNAIL }}>
                  {/* The tile is the open control when the file is here. */}
                  <Pressable
                    accessibilityRole={held ? "button" : undefined}
                    accessibilityLabel={[
                      held ? `${tr.attachments.open} · ${attachment.fileName}` : attachment.fileName,
                      tr.attachments.sizeLabel(kib(attachment.byteSize)),
                      held ? null : missingLabel,
                    ].filter(Boolean).join(" · ")}
                    disabled={!held}
                    onPress={() => void open(attachment)}
                    style={(state) => ({
                      ...interactionSurface(palette, state, { base: palette.surfaceAlt, enabled: held }),
                      width: THUMBNAIL,
                      height: THUMBNAIL,
                      borderRadius: radius.sm,
                      overflow: "hidden",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: spacing.xs,
                    })}
                  >
                    {uri ? (
                      <Image alt="" source={{ uri }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
                    ) : (
                      <TypeIcon accessible={false} size={24} color={palette.textSecondary} strokeWidth={1.8} />
                    )}
                    {held ? null : (
                      <Badge testID={`attachment-missing-${attachment.id}`} text={missingLabel} tone="warning" />
                    )}
                  </Pressable>
                  <Row style={{ alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
                    <Body muted style={{ fontSize: type.small.fontSize, flex: 1, minWidth: 0 }}>
                      {tr.attachments.sizeLabel(kib(attachment.byteSize))}
                    </Body>
                    <IconButton
                      icon={X}
                      tone="danger"
                      label={`${tr.attachments.remove} · ${attachment.fileName}`}
                      disabled={busy}
                      onPress={() => void remove(attachment)}
                    />
                  </Row>
                  {/* Own line: a PDF has no thumbnail to identify it, and beside the remove button the column is ~40px. */}
                  <Body muted style={{ fontSize: type.small.fontSize }}>
                    {attachment.fileName}
                  </Body>
                </View>
              );
            })}
          </View>
        )}

        {supported ? (
          <Button
            testID="attachment-add"
            icon={Paperclip}
            variant="secondary"
            label={tr.attachments.add}
            disabled={busy}
            onPress={() => void pick()}
          />
        ) : (
          <Body muted testID="attachment-unsupported">{tr.attachments.unsupported}</Body>
        )}
        {attachments.length > 0 ? (
          <Body muted style={{ marginTop: spacing.xs, fontSize: type.small.fontSize }}>
            {tr.attachments.count(attachments.length, kib(totalBytes))}
          </Body>
        ) : null}
      </Card>
    </View>
  );
}
