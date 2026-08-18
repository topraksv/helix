/**
 * The documents kept beside one transaction.
 *
 * Metadata is a synced row; the bytes are this device's. That split is stated
 * on the panel and shown per row: a document added on the phone appears on the
 * desktop as a record with no file behind it, and says so, rather than
 * offering an open button that cannot work.
 */

import React, { useEffect, useState } from "react";
import { View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import Paperclip from "lucide-react-native/icons/paperclip";
import { addAttachment, AttachmentRejectedError, deleteAttachment, restoreAttachment, type AttachmentRow } from "../data/repo";
import { ATTACHMENT_MIME_TYPES, type AttachmentRejection } from "../domain/attachments";
import { attachmentsSupported, openAttachment, presentAttachments, storeAttachmentBytes } from "../services/attachment-store";
import { devError } from "../services/logger";
import { tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { Badge, Body, Button, Card, Row, SectionHeader, Spread } from "./components";
import { appAlert } from "./dialog";
import { useUndo } from "./undo";
import { spacing } from "./theme";

function rejectionMessage(reason: string): string {
  const known = tr.attachments.rejected as Record<string, string | undefined>;
  return known[reason] ?? tr.errors.saveFailed;
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
  const storedNames = attachments.map((attachment) => attachment.storedName).join("|");
  useEffect(() => {
    let cancelled = false;
    void presentAttachments(storedNames === "" ? [] : storedNames.split("|"))
      .then((found) => { if (!cancelled) setPresent(found); })
      .catch((error) => devError("attachment.presence", error));
    return () => { cancelled = true; };
  }, [storedNames]);

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
        // The repository decides the destination name and hands it back; it
        // never receives a path to read from, so nothing outside the picker's
        // own result can be copied into app storage.
        copyInto: (storedName) => storeAttachmentBytes(asset, storedName),
      });
      scheduleSync(userId);
    } catch (error) {
      if (error instanceof AttachmentRejectedError) {
        void appAlert(rejectionMessage(error.reason as AttachmentRejection), tr.errors.title);
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
      void appAlert(tr.attachments.unavailable, tr.errors.title);
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
    <View testID="attachment-panel" style={{ marginTop: spacing.lg }}>
      <SectionHeader>{tr.attachments.title}</SectionHeader>
      <Body muted style={{ marginBottom: spacing.sm }}>{tr.attachments.hint}</Body>

      {attachments.length === 0 ? (
        <Body muted testID="attachment-empty">{tr.attachments.empty}</Body>
      ) : (
        attachments.map((attachment) => {
          const held = present.has(attachment.storedName);
          return (
            <Card key={attachment.id} testID={`attachment-${attachment.id}`}>
              <Spread style={{ alignItems: "flex-start", gap: spacing.sm }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Row gap={spacing.sm} style={{ flexWrap: "wrap" }}>
                    <Badge text={tr.attachments.kinds[attachment.kind]} tone="muted" />
                  </Row>
                  <Body
                    accessibilityLabel={tr.attachments.rowA11y(
                      attachment.fileName,
                      tr.attachments.kinds[attachment.kind],
                      held ? "" : tr.attachments.unavailable,
                    )}
                    style={{ marginTop: spacing.xs }}
                  >
                    {attachment.fileName}
                  </Body>
                  <Body muted style={{ marginTop: 2 }}>
                    {tr.attachments.sizeLabel(Math.max(1, Math.round(attachment.byteSize / 1024)))}
                  </Body>
                  {/* A device that did not add the file does not have it, and
                      the row says so rather than offering a dead button. */}
                  {held ? null : (
                    <Body muted testID={`attachment-missing-${attachment.id}`} style={{ marginTop: 2 }}>
                      {tr.attachments.unavailable}
                    </Body>
                  )}
                </View>
              </Spread>
              <Row gap={spacing.sm} style={{ marginTop: spacing.sm, flexWrap: "wrap" }}>
                {held ? (
                  <View>
                    <Button size="sm" variant="secondary" label={tr.attachments.open} onPress={() => void open(attachment)} />
                  </View>
                ) : null}
                <View>
                  <Button
                    size="sm"
                    variant="ghost"
                    label={tr.attachments.remove}
                    disabled={busy}
                    onPress={() => void remove(attachment)}
                  />
                </View>
              </Row>
            </Card>
          );
        })
      )}

      <View style={{ marginTop: spacing.sm }}>
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
      </View>
    </View>
  );
}
