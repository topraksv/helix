/**
 * Shared transaction row for the virtualized lists (month detail, cell editor,
 * analysis search). Pure layout: callers compose the date/meta text and decide
 * the surrounding card styling, so the row stays cheap to mount in a FlatList.
 */

import React from "react";
import { Text, View } from "react-native";
import { Pencil, Trash2 } from "lucide-react-native";
import { tr } from "../i18n/tr";
import { Amount, Badge, Body, Divider, IconButton, Row, Spread } from "./components";
import { spacing, type, useTheme } from "./theme";

export function TransactionRow({
  installmentTitle,
  dateText,
  note,
  pending,
  reversalBadge,
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
          {installmentTitle ? <Body style={{ fontFamily: "Inter_500Medium" }}>{installmentTitle}</Body> : null}
          <Body muted={installmentTitle != null}>{dateText}</Body>
          {note && note !== installmentTitle ? (
            <Text style={[type.small, { color: palette.textSecondary }]}>{note}</Text>
          ) : null}
          {reversalBadge || pending ? (
            <Row gap={spacing.sm} style={{ marginTop: 2, flexWrap: "wrap" }}>
              {reversalBadge ? <Badge text={reversalBadge.text} tone={reversalBadge.tone} /> : null}
              {pending ? <Badge text={tr.tx.futureNote} tone="warning" /> : null}
            </Row>
          ) : null}
        </View>
        <Row gap={spacing.sm}>
          <Amount minor={amountMinor} />
          <IconButton icon={Pencil} size={32} label={tr.common.edit} onPress={onEdit} />
          <IconButton icon={Trash2} size={32} tone="danger" label={tr.common.delete} haptic="none" onPress={onDelete} />
        </Row>
      </Spread>
      {divider ? <Divider /> : null}
    </View>
  );
}
