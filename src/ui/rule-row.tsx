/**
 * Shared list row for recurring rules (subscriptions, income rules): the price
 * sits in the right column with the edit/delete actions below it, and
 * dates/status render as compact wrapping badges (the same language as the
 * payment-method cycle chips) so long values never break the hierarchy.
 */

import { type ReactNode } from "react";
import { Pressable, View } from "react-native";
import Pencil from "lucide-react-native/icons/pencil";
import Trash from "lucide-react-native/icons/trash";
import type { LucideIcon } from "lucide-react-native";
import { tr } from "../i18n/tr";
import { Amount, Badge, Body, IconButton, Row } from "./components";
import { interactionBleed, interactionSurface } from "./interaction";
import { controlSize, font, radius, spacing, type, useTheme } from "./theme";
import { shouldStackListActions } from "./responsive";
import { useContentWidth } from "./viewport";

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
  amountUnknown = false,
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
  /** A variable rule with no estimate yet: replaces the figure with a label
   *  instead of drawing a "₺0,00" that reads as a real, free charge. */
  amountUnknown?: boolean;
  currency?: string;
  /** Small muted note under the amount (e.g. the normalized "…/ay" cost). */
  amountNote?: string;
  onPress?: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  /** Only the label is pressable: a pressable row around the edit and delete buttons is nested-interactive. */
  const label = (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Body style={{ fontFamily: font.medium }}>{title}</Body>
      {meta ? (
        <Body muted style={{ fontSize: type.small.fontSize, marginTop: 1 }}>
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

  const stackActions = shouldStackListActions(useContentWidth());
  const { palette } = useTheme();

  return (
    <View style={{ flexDirection: "row", gap: spacing.md, paddingVertical: spacing.sm, alignItems: "center" }}>
      {leading}
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          onPress={onPress}
          // The bleed lets the fill reach past the label without moving it.
          style={(state) => ({
            flex: 1,
            minWidth: 0,
            alignSelf: "stretch",
            justifyContent: "center",
            minHeight: controlSize.minimumTarget,
            marginVertical: -spacing.sm,
            paddingVertical: spacing.sm,
            ...interactionBleed(),
            borderRadius: radius.sm,
            ...interactionSurface(palette, state),
          })}
        >
          {label}
        </Pressable>
      ) : (
        label
      )}
      {/* Actions sit beside the amount when the width allows; stacked only below the threshold. */}
      <View
        style={stackActions
          ? { alignItems: "flex-end", gap: spacing.xs }
          : { flexDirection: "row", alignItems: "center", gap: spacing.lg }}
      >
        <View style={stackActions ? { alignItems: "flex-end" } : { alignItems: "flex-end", gap: 1 }}>
          {amountUnknown ? (
            <Body muted style={{ fontSize: type.small.fontSize, textAlign: "right" }}>{tr.subs.unknownAmount}</Body>
          ) : (
            <Amount minor={amountMinor} currency={currency} colorized={false} />
          )}
          {amountNote ? (
            <Body muted style={{ fontSize: type.small.fontSize }}>
              {amountNote}
            </Body>
          ) : null}
        </View>
        <Row gap={spacing.sm} style={stackActions ? { marginTop: 2 } : undefined}>
          <IconButton icon={Pencil} label={`${tr.common.edit} · ${title}`} onPress={onEdit} />
          <IconButton icon={Trash} tone="danger" label={`${tr.common.delete} · ${title}`} haptic="none" onPress={onDelete} />
        </Row>
      </View>
    </View>
  );
}
