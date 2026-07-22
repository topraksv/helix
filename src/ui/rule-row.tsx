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
import { controlSize, font, spacing } from "./theme";

export interface RuleBadge {
  text: string;
  tone?: "muted" | "positive" | "negative" | "success" | "error" | "warning" | "primary";
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
  /**
   * The row's own tap target wraps ONLY the label column.
   *
   * It used to wrap the whole row, which put two `IconButton`s (themselves
   * `accessibilityRole="button"`) inside another `role="button"` — axe's
   * `nested-interactive` rule, WCAG SC 4.1.2. `ListRow` in
   * `settings/index.tsx` shows the discipline this file had lapsed from: a row
   * with an interactive `right` does not also make itself pressable.
   *
   * Scoping the Pressable to the label leaves three SIBLING controls — open,
   * edit, delete — each separately focusable, each with its own name, and the
   * label still opens the editor on tap.
   */
  const label = (
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
  );

  return (
    <View style={{ flexDirection: "row", gap: spacing.md, paddingVertical: spacing.sm, alignItems: "flex-start" }}>
      {leading}
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          onPress={onPress}
          style={{ flex: 1, minWidth: 0, justifyContent: "center", minHeight: controlSize.minimumTarget }}
        >
          {label}
        </Pressable>
      ) : (
        label
      )}
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
}
