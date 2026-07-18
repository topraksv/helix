/**
 * Shared list row for recurring rules (subscriptions, income rules): the price
 * sits top-right with the edit/delete actions in the same right column below
 * it, and dates/status render as compact wrapping badges (the same language as
 * the payment-method cycle chips) so long values never break the hierarchy.
 */

import React, { type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Pencil, Trash2, type LucideIcon } from "lucide-react-native";
import { tr } from "../i18n/tr";
import { Amount, Badge, Body, IconButton, Row } from "./components";
import { font, spacing } from "./theme";

export interface RuleBadge {
  text: string;
  tone?: "muted" | "positive" | "negative" | "warning" | "primary";
  icon?: LucideIcon;
}

export function RuleRow({
  leading,
  title,
  meta,
  badges,
  amountMinor,
  currency = "TRY",
  amountNote,
  onPress,
  onEdit,
  onDelete,
}: {
  leading?: ReactNode;
  title: string;
  /** Muted line under the title (e.g. the income kind). */
  meta?: string;
  badges: RuleBadge[];
  amountMinor: number;
  currency?: string;
  /** Small muted note under the amount (e.g. the normalized "…/ay" cost). */
  amountNote?: string;
  onPress?: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const content = (
    <View style={{ flexDirection: "row", gap: spacing.md, paddingVertical: spacing.sm, alignItems: "flex-start" }}>
      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body style={{ fontFamily: font.medium }}>{title}</Body>
        {meta ? (
          <Body muted style={{ fontSize: 12, marginTop: 1 }}>
            {meta}
          </Body>
        ) : null}
        {badges.length > 0 ? (
          <Row gap={spacing.xs} style={{ flexWrap: "wrap", rowGap: spacing.xs, marginTop: spacing.xs + 2 }}>
            {badges.map((badge) => (
              <Badge key={badge.text} text={badge.text} tone={badge.tone ?? "muted"} icon={badge.icon} />
            ))}
          </Row>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: spacing.xs }}>
        <Amount minor={amountMinor} currency={currency} colorized={false} />
        {amountNote ? (
          <Body muted style={{ fontSize: 12 }}>
            {amountNote}
          </Body>
        ) : null}
        <Row gap={spacing.sm} style={{ marginTop: 2 }}>
          <IconButton icon={Pencil} size={32} label={tr.common.edit} onPress={onEdit} />
          <IconButton icon={Trash2} size={32} tone="danger" label={tr.common.delete} haptic="none" onPress={onDelete} />
        </Row>
      </View>
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}>
      {content}
    </Pressable>
  );
}
