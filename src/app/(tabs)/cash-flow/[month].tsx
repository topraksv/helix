/** Month detail: per-column breakdown; expand a column to see and manage its transactions + cell note. */

import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { and, eq, isNull } from "drizzle-orm";
import { ChevronDown, ChevronUp, Inbox, Pencil, StickyNote, Trash2 } from "lucide-react-native";
import { getDb } from "../../../db/client";
import * as s from "../../../db/schema";
import { newId } from "../../../db/ids";
import { restoreRow, writeRows } from "../../../db/mutations";
import { deleteTransaction } from "../../../data/repo";
import { firstDayOf, lastDayOf, monthKeyOf, yearOf } from "../../../domain/dates";
import { useCategories, useLedger, useLive, usePersons, usePlans, useTransactionsBetween, useUserId } from "../../../data/hooks";
import { installmentDisplayTitle } from "../../../domain/installments";
import { categoryIcon } from "../../../data/category-icons";
import { dateLabel, monthLabel, tr } from "../../../i18n/tr";
import { Amount, Badge, Body, Button, Card, Divider, EmptyState, Field, Heading, IconButton, Row, Screen, Spread } from "../../../ui/components";
import { useUndo } from "../../../ui/undo";
import { selectionTapIfChanged } from "../../../ui/haptics";
import { spacing, type, useTheme } from "../../../ui/theme";

export default function MonthDetailScreen() {
  const { month } = useLocalSearchParams<{ month: string }>();
  const router = useRouter();
  const userId = useUserId();
  const categories = useCategories();
  const persons = usePersons();
  const plans = usePlans();
  const transactions = useTransactionsBetween(firstDayOf(month!), lastDayOf(month!));
  const bundle = useLedger(yearOf(month!));
  const [expanded, setExpanded] = useState<string | null>(null);
  const { palette } = useTheme();
  const undo = useUndo();

  const ledgerMonth = bundle?.ledger.find((m) => m.month === month);
  const personName = useMemo(() => new Map(persons.map((p) => [p.id, p.name])), [persons]);
  const selfIds = useMemo(() => new Set(persons.filter((p) => p.isSelf).map((p) => p.id)), [persons]);
  const planTitle = new Map(plans.map((plan) => [plan.id, plan.title]));

  const byCategory = useMemo(() => {
    const map = new Map<string, typeof transactions>();
    for (const t of transactions) {
      const key = t.categoryId ?? "uncategorized";
      const list = map.get(key);
      if (list) list.push(t);
      else map.set(key, [t]);
    }
    return map;
  }, [transactions]);

  const cellNotes = useLive(
    getDb()
      .select()
      .from(s.cellNotes)
      .where(and(eq(s.cellNotes.userId, userId), eq(s.cellNotes.month, month!), isNull(s.cellNotes.deletedAt))),
    [userId, month],
    ["cell_notes"],
  ).data;

  const removeTx = async (id: string) => {
    const snapshot = await deleteTransaction(userId, id);
    if (snapshot) {
      undo.show(tr.tx.deletedUndo, () => void restoreRow(userId, "transactions", snapshot), "warning");
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: monthLabel(month!) }} />
      {ledgerMonth ? (
        <Card>
          <Spread>
            <Body muted>{tr.cashflow.opening}</Body>
            <Amount minor={ledgerMonth.openingMinor} />
          </Spread>
          <Spread style={{ marginTop: spacing.xs }}>
            <Body muted>{tr.cashflow.income}</Body>
            <Amount minor={ledgerMonth.incomeMinor} colorized={false} color={palette.positive} />
          </Spread>
          <Spread style={{ marginTop: spacing.xs }}>
            <Body muted>{tr.cashflow.expense}</Body>
            <Amount minor={-ledgerMonth.expenseMinor} />
          </Spread>
          {ledgerMonth.transferMinor !== 0 ? (
            <Spread style={{ marginTop: spacing.xs }}>
              <Body muted style={{ flex: 1, paddingRight: spacing.sm }}>{tr.cashflow.transfer}</Body>
              <Amount minor={-ledgerMonth.transferMinor} />
            </Spread>
          ) : null}
          <Divider />
          <Spread>
            <Heading style={{ marginVertical: 0 }}>{tr.cashflow.closing}</Heading>
            <Amount minor={ledgerMonth.closingMinor} large />
          </Spread>
        </Card>
      ) : null}

      {transactions.length === 0 ? <EmptyState icon={Inbox} title={tr.cashflow.emptyMonth} /> : null}

      {[...byCategory.entries()].map(([categoryId, txs]) => {
        const category = categories.find((c) => c.id === categoryId);
        const title = category?.name ?? tr.common.none;
        const selfSum = txs.filter((t) => selfIds.has(t.personId)).reduce(
          (sum, t) => sum + (t.type === "income" ? t.amountTryMinor : -t.amountTryMinor),
          0,
        );
        const note = cellNotes.find((n) => n.categoryId === categoryId);
        const open = expanded === categoryId;
        return (
          <Card key={categoryId}>
            <Pressable
              onPress={() => {
                selectionTapIfChanged(expanded, open ? "" : categoryId);
                setExpanded(open ? null : categoryId);
              }}
              accessibilityRole="button"
            >
              <Spread>
                <Row gap={spacing.sm} style={{ flex: 1, paddingRight: spacing.md }}>
                  <Heading style={{ marginVertical: 0, flexShrink: 1 }}>
                    {category ? `${categoryIcon(category)} ` : ""}
                    {title}
                  </Heading>
                  {note ? <StickyNote size={14} color={palette.textMuted} /> : null}
                </Row>
                <Row gap={spacing.sm}>
                  <Amount minor={selfSum} />
                  {open ? <ChevronUp size={16} color={palette.textMuted} /> : <ChevronDown size={16} color={palette.textMuted} />}
                </Row>
              </Spread>
            </Pressable>
            {open ? (
              <View style={{ marginTop: spacing.md }}>
                {txs.map((t, index) => {
                  const installmentTitle = t.installmentPlanId
                    ? installmentDisplayTitle(planTitle.get(t.installmentPlanId), t.note, tr.installments.plan)
                    : null;
                  return (
                  <View key={t.id}>
                    <Spread style={{ paddingVertical: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        {installmentTitle ? <Body style={{ fontFamily: "Inter_500Medium" }}>{installmentTitle}</Body> : null}
                        <Body muted={installmentTitle != null}>
                          {t.isAggregate || t.installmentPlanId ? monthLabel(monthKeyOf(t.effectiveDate)) : dateLabel(t.effectiveDate)}
                          {t.installmentNo ? `  ·  ${tr.installments.nthInstallment(t.installmentNo)}` : ""}
                          {t.isAggregate ? `  ·  ${tr.bulk.aggregateBadge}` : ""}
                          {!selfIds.has(t.personId) ? `  ·  ${personName.get(t.personId) ?? ""}` : ""}
                        </Body>
                        {t.note && t.note !== installmentTitle ? <Text style={[type.small, { color: palette.textMuted }]}>{t.note}</Text> : null}
                        {t.status === "pending" ? <Badge text={tr.tx.futureNote} tone="warning" /> : null}
                      </View>
                      <Row gap={spacing.sm}>
                        <Amount minor={t.type === "income" ? t.amountTryMinor : -t.amountTryMinor} />
                        <IconButton icon={Pencil} size={32} label={tr.common.edit} onPress={() => router.push({ pathname: "/transaction", params: { id: t.id } })} />
                        <IconButton icon={Trash2} size={32} tone="danger" label={tr.common.delete} haptic="none" onPress={() => void removeTx(t.id)} />
                      </Row>
                    </Spread>
                    {index < txs.length - 1 ? <Divider /> : null}
                  </View>
                  );
                })}
                <CellNoteEditor userId={userId} month={month!} categoryId={categoryId} existing={note} />
              </View>
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}

function CellNoteEditor({
  userId,
  month,
  categoryId,
  existing,
}: {
  userId: string;
  month: string;
  categoryId: string;
  existing?: { id: string; body: string };
}) {
  const [text, setText] = useState(existing?.body ?? "");
  const save = async () => {
    await writeRows(userId, [
      {
        table: "cell_notes",
        row: { id: existing?.id ?? newId(), month, categoryId, body: text.trim(), deletedAt: text.trim() === "" ? new Date().toISOString() : null },
      },
    ]);
  };
  return (
    <View style={{ marginTop: spacing.sm }}>
      <Field label={tr.cashflow.cellNote} value={text} onChangeText={setText} multiline placeholder="…" />
      <Button label={tr.common.save} variant="secondary" size="sm" onPress={() => void save()} disabled={text === (existing?.body ?? "")} />
    </View>
  );
}
