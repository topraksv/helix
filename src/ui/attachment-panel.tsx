/**
 * The documents kept beside one transaction.
 *
 * Metadata is a synced row; the bytes are this device's. That split is stated
 * on the panel and shown per row: a document added on the phone appears on the
 * desktop as a record with no file behind it, and says so, rather than
 * offering an open button that cannot work.
 */

import React, { useState } from "react";
import { View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import Paperclip from "lucide-react-native/icons/paperclip";
import { addAttachment, AttachmentRejectedError, deleteAttachment, restoreAttachment, type AttachmentRow } from "../data/repo";
import { ATTACHMENT_MIME_TYPES, MAX_ATTACHMENT_BYTES, type AttachmentRejection } from "../domain/attachments";
import { attachmentsSupported, localAttachment, storeAttachmentBytes } from "../services/attachment-store";
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
        copyInto: (storedName) => storeAttachmentBytes(asset.uri, storedName),
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
    const file = localAttachment(attachment.storedName);
    if (!file) {
      void appAlert(tr.attachments.unavailable, tr.errors.title);
      return;
    }
    try {
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: attachment.mimeType });
    } catch (error) {
      devError("attachment.open", error);
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
          const present = localAttachment(attachment.storedName) != null;
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
                      present ? "" : tr.attachments.unavailable,
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
                  {present ? null : (
                    <Body muted testID={`attachment-missing-${attachment.id}`} style={{ marginTop: 2 }}>
                      {tr.attachments.unavailable}
                    </Body>
                  )}
                </View>
              </Spread>
              <Row gap={spacing.sm} style={{ marginTop: spacing.sm, flexWrap: "wrap" }}>
                {present ? (
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

/** Bytes a picked document may occupy, restated for the picker's own guard. */
export const ATTACHMENT_SIZE_LIMIT = MAX_ATTACHMENT_BYTES;
