/**
 * The documents kept beside one transaction.
 *
 * Metadata is a synced row; the bytes are this device's. That split is stated
 * on the panel and shown per row: a document added on the phone appears on the
 * desktop as a record with no file behind it, and says so, rather than
 * offering an open button that cannot work.
 *
 * Laid out as the app lays out every other list of records — one card of rows,
 * each row an icon, a name, what it is, and the same two controls in the same
 * order. It used to be one bordered card per file with the buttons stacked
 * underneath, so two receipts took more vertical space than the form they
 * belonged to.
 */

import React, { useEffect, useState } from "react";
import { View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import FileText from "lucide-react-native/icons/file-text";
import ImageIcon from "lucide-react-native/icons/image";
import Paperclip from "lucide-react-native/icons/paperclip";
import { addAttachment, AttachmentRejectedError, deleteAttachment, restoreAttachment, type AttachmentRow } from "../data/repo";
import { ATTACHMENT_MIME_TYPES, type AttachmentRejection } from "../domain/attachments";
import { attachmentsSupported, openAttachment, presentAttachments, storeAttachmentBytes } from "../services/attachment-store";
import { devError } from "../services/logger";
import { tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { Badge, Body, Button, Card, Divider, ListRow, Row, SectionHeader } from "./components";
import { appAlert } from "./dialog";
import { useUndo } from "./undo";
import { spacing } from "./theme";

function rejectionMessage(reason: string): string {
  const known = tr.attachments.rejected as Record<string, string | undefined>;
  return known[reason] ?? tr.errors.saveFailed;
}

/** A page or a picture: the two things a receipt is ever stored as. */
function attachmentIcon(mimeType: string) {
  return mimeType.startsWith("image/") ? ImageIcon : FileText;
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
    <View testID="attachment-panel">
      <SectionHeader description={tr.attachments.hint}>{tr.attachments.title}</SectionHeader>

      {attachments.length === 0 ? (
        <Card>
          <Body muted testID="attachment-empty">{tr.attachments.empty}</Body>
        </Card>
      ) : (
        <Card rows>
          {attachments.map((attachment, index) => {
            const held = present.has(attachment.storedName);
            return (
              <React.Fragment key={attachment.id}>
                {index > 0 ? <Divider /> : null}
                <ListRow
                  icon={attachmentIcon(attachment.mimeType)}
                  title={attachment.fileName}
                  stackRightOnNarrow
                  subtitle={(
                    <Row gap={spacing.sm} style={{ flexWrap: "wrap", marginTop: spacing.xs }}>
                      <Badge text={tr.attachments.kinds[attachment.kind]} tone="muted" />
                      <Badge text={tr.attachments.sizeLabel(Math.max(1, Math.round(attachment.byteSize / 1024)))} tone="muted" />
                      {/* A device that did not add the file does not have it,
                          and the row says so rather than offering a dead
                          button. */}
                      {held ? null : (
                        <Badge testID={`attachment-missing-${attachment.id}`} text={tr.attachments.otherDevice} tone="warning" />
                      )}
                    </Row>
                  )}
                  right={(
                    <Row gap={spacing.sm}>
                      {held ? (
                        <Button size="sm" variant="secondary" label={tr.attachments.open} onPress={() => void open(attachment)} />
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        label={tr.attachments.remove}
                        disabled={busy}
                        onPress={() => void remove(attachment)}
                      />
                    </Row>
                  )}
                />
              </React.Fragment>
            );
          })}
        </Card>
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
    </View>
  );
}
