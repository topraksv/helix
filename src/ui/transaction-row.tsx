/**
 * Shared transaction row for the virtualized lists (month detail, cell editor,
 * analysis search). Pure layout: callers compose the date/meta text and decide
 * the surrounding card styling, so the row stays cheap to mount in a FlatList.
 * A row carrying documents says so here rather than only on the detail screen
 * (spec §3.1g).
 */

import { Text, View } from "react-native";
import Paperclip from "lucide-react-native/icons/paperclip";
import Pencil from "lucide-react-native/icons/pencil";
import Trash2 from "lucide-react-native/icons/trash-2";
import { tr } from "../i18n/tr";
import { Amount, Badge, Body, Divider, IconButton, Row, Spread } from "./components";
import { font, spacing, type, useTheme } from "./theme";

export function TransactionRow({
  installmentTitle,
  dateText,
  note,
  pending,
  reversalBadge,
  hasDocuments,
  amountMinor,
  onEdit,
  onDelete,
  divider,
}: {
  installmentTitle: string | null;
  dateText: string;
  note: string | null;
  pending: boolean;
  reversalBadge: { text: string; tone: "negative" | "positive" } | null;
  /**
   * A receipt, invoice or warranty is filed against this row.
   *
   * Worth saying HERE and not only inside the editor: the reason to open a
   * three-month-old grocery row is usually the receipt attached to it, and
   * nothing in the list said which rows had one.
   */
  hasDocuments?: boolean;
  amountMinor: number;
  onEdit: () => void;
  onDelete: () => void;
  divider: boolean;
}) {
  const { palette } = useTheme();
  return (
    <View>
      <Spread style={{ paddingVertical: spacing.sm }}>
        <View style={{ flex: 1 }}>
          {installmentTitle ? <Body style={{ fontFamily: font.medium }}>{installmentTitle}</Body> : null}
          <Body muted={installmentTitle != null}>{dateText}</Body>
          {note && note !== installmentTitle ? (
            <Text style={[type.small, { color: palette.textSecondary }]}>{note}</Text>
          ) : null}
          {reversalBadge || pending || hasDocuments ? (
            <Row gap={spacing.sm} style={{ marginTop: 2, flexWrap: "wrap" }}>
              {reversalBadge ? <Badge text={reversalBadge.text} tone={reversalBadge.tone} /> : null}
              {pending ? <Badge text={tr.tx.futureNote} tone="warning" /> : null}
              {hasDocuments ? <Badge icon={Paperclip} text={tr.attachments.onTransaction} tone="primary" /> : null}
            </Row>
          ) : null}
        </View>
        <Row gap={spacing.sm}>
          <Amount minor={amountMinor} />
          <IconButton icon={Pencil} label={`${tr.common.edit} · ${dateText}`} onPress={onEdit} />
          <IconButton icon={Trash2} tone="danger" label={`${tr.common.delete} · ${dateText}`} haptic="none" onPress={onDelete} />
        </Row>
      </Spread>
      {divider ? <Divider flush /> : null}
    </View>
  );
}
