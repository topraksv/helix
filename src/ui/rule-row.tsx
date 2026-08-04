/**
 * Shared list row for recurring rules (subscriptions, income rules): the price
 * sits in the right column with the edit/delete actions below it, and
 * dates/status render as compact wrapping badges (the same language as the
 * payment-method cycle chips) so long values never break the hierarchy.
 *
 * The three columns centre against the row rather than hanging from its top.
 * The badges wrap, so the label column's height depends on how many a rule
 * happens to carry — a subscription in trial with auto-pay is three lines
 * where a plain one is one — and top alignment left the logo and the price
 * stranded against the first line of a much taller row.
 */

import React, { type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Pencil, Trash2, type LucideIcon } from "lucide-react-native";
import { tr } from "../i18n/tr";
import { Amount, Badge, Body, IconButton, Row } from "./components";
import { controlSize, font, spacing } from "./theme";
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

  const stackActions = shouldStackListActions(useContentWidth());

  return (
    <View style={{ flexDirection: "row", gap: spacing.md, paddingVertical: spacing.sm, alignItems: "center" }}>
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
      {/* The row's controls sit BESIDE the amount wherever the row has width
          for them. Stacked unconditionally they pushed every subscription to
          90px tall on a surface with a third of its width to spare; below the
          narrow threshold that stack is still the only thing that fits. */}
      <View
        style={stackActions
          ? { alignItems: "flex-end", gap: spacing.xs }
          : { flexDirection: "row", alignItems: "center", gap: spacing.lg }}
      >
        <View style={stackActions ? { alignItems: "flex-end" } : { alignItems: "flex-end", gap: 1 }}>
          <Amount minor={amountMinor} currency={currency} colorized={false} />
          {amountNote ? (
            <Body muted style={{ fontSize: 12 }}>
              {amountNote}
            </Body>
          ) : null}
        </View>
        <Row gap={spacing.sm} style={stackActions ? { marginTop: 2 } : undefined}>
          <IconButton icon={Pencil} label={`${tr.common.edit} · ${title}`} onPress={onEdit} />
          <IconButton icon={Trash2} tone="danger" label={`${tr.common.delete} · ${title}`} haptic="none" onPress={onDelete} />
        </Row>
      </View>
    </View>
  );
}
