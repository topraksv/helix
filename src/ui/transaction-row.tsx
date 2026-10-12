/**
 * Shared transaction row for the virtualized lists (month detail, cell editor,
 * analysis search). Pure layout: callers compose the date/meta text and decide
 * the surrounding card styling, so the row stays cheap to mount in a FlatList.
 * A row carrying documents says so here rather than only on the detail screen
 * (spec §2.6).
 */

import { Text, View } from "react-native";
import Paperclip from "lucide-react-native/icons/paperclip";
import Pencil from "lucide-react-native/icons/pencil";
import Repeat from "lucide-react-native/icons/repeat";
import Trash from "lucide-react-native/icons/trash";
import { expectationEffect, type PlannedExpectation } from "../domain/expected";
import { isWorkbookRemainderRow } from "../domain/transactions";
import type { TransactionType } from "../domain/types";
import { dateLabel, tr } from "../i18n/tr";
import { Amount, Badge, Body, Divider, IconButton, Row, Spread } from "./components";
import { font, spacing, type, useTheme } from "./theme";

/**
 * A row action named by what tells two rows apart (UI.md §4): two purchases of
 * one day in one group were both "Sil · 3 Ekim 2026", and two of one merchant
 * on different days would both be "Sil · MIGROS" without the date.
 */
const actionLabel = (verb: string, title: string | null, dateText: string) => [verb, title, dateText].filter(Boolean).join(" · ");

export type TransactionBadge = { text: string; tone: "negative" | "positive" | "muted" };

/** The marker a row wears when it is a workbook remainder or a reversal, so the three lists name them alike. */
export function transactionBadge(t: Parameters<typeof isWorkbookRemainderRow>[0] & { type: TransactionType; amountTryMinor: number }): TransactionBadge | null {
  if (isWorkbookRemainderRow(t)) return { text: tr.analysis.remainderBadge, tone: "muted" };
  return t.amountTryMinor < 0 ? { text: tr.tx.reversalLabel(t.type), tone: t.type === "income" ? "negative" : "positive" } : null;
}

export function TransactionRow({
  installmentTitle,
  dateText,
  note,
  pending,
  reversalBadge,
  hasDocuments,
  automatic,
  amountMinor,
  onEdit,
  onDelete,
  divider,
}: {
  installmentTitle: string | null;
  dateText: string;
  note: string | null;
  pending: boolean;
  reversalBadge: TransactionBadge | null;
  /** A document is filed against this row (spec §2.6). */
  hasDocuments?: boolean;
  /** Auto-pay recorded it paid; the owner never confirmed it. */
  automatic?: boolean;
  amountMinor: number;
  onEdit: () => void;
  onDelete?: () => void;
  divider: boolean;
}) {
  const { palette } = useTheme();
  const title = installmentTitle ?? note;
  return (
    <View>
      <Spread style={{ paddingVertical: spacing.sm }}>
        <View style={{ flex: 1 }}>
          {/* What it was leads; when and what kind follows. */}
          {title ? <Body style={{ fontFamily: font.medium }}>{title}</Body> : null}
          <Body muted={title != null}>{dateText}</Body>
          {note && note !== title ? (
            <Text style={[type.small, { color: palette.textSecondary }]}>{note}</Text>
          ) : null}
          {reversalBadge || pending || hasDocuments || automatic ? (
            <Row gap={spacing.sm} style={{ marginTop: 2, flexWrap: "wrap" }}>
              {reversalBadge ? <Badge text={reversalBadge.text} tone={reversalBadge.tone} /> : null}
              {pending ? <Badge text={tr.tx.futureNote} tone="warning" /> : null}
              {automatic ? <Badge icon={Repeat} text={tr.tx.autoConfirmed} tone="primary" /> : null}
              {hasDocuments ? <Badge icon={Paperclip} text={tr.attachments.onTransaction} tone="primary" /> : null}
            </Row>
          ) : null}
        </View>
        <Row gap={spacing.sm}>
          <Amount minor={amountMinor} />
          <IconButton icon={Pencil} label={actionLabel(tr.common.edit, title, dateText)} onPress={onEdit} />
          {onDelete ? <IconButton icon={Trash} tone="danger" label={actionLabel(tr.common.delete, title, dateText)} haptic="none" onPress={onDelete} /> : null}
        </Row>
      </Spread>
      {divider ? <Divider flush /> : null}
    </View>
  );
}

/**
 * A rule's unpaid occurrence, listed beside the rows because the cell counts it
 * (`plannedExpectations`). It has no delete: an occurrence belongs to its rule,
 * which is where editing it leads.
 */
export function ExpectationRow({ item, onEdit, divider }: { item: PlannedExpectation; onEdit: () => void; divider: boolean }) {
  return (
    <TransactionRow
      installmentTitle={null}
      note={item.name ?? tr.common.paymentFallback}
      dateText={`${dateLabel(item.dueDate)}  ·  ${tr.cashflow.plannedExpectation(item.direction === "in")}`}
      pending
      reversalBadge={null}
      amountMinor={expectationEffect(item)}
      onEdit={onEdit}
      divider={divider}
    />
  );
}
