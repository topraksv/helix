/** Month detail: per-column breakdown; expand a column to see and manage its transactions + cell note. */

import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { and, eq, isNull } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { getDb } from "../../../db/client";
import * as s from "../../../db/schema";
import { newId } from "../../../db/ids";
import { writeRows } from "../../../db/mutations";
import { deleteTransaction } from "../../../data/repo";
import { restoreRow } from "../../../db/mutations";
import { firstDayOf, lastDayOf } from "../../../domain/dates";
import { useCategories, useLedger, usePersons, useTransactionsBetween, useUserId } from "../../../data/hooks";
import { dateLabel, monthLabel, tr } from "../../../i18n/tr";
import { Amount, Badge, Body, Button, Card, Divider, EmptyState, Field, Heading, Row, Screen, Spread } from "../../../ui/components";
import { useUndo } from "../../../ui/undo";
import { spacing, type, useTheme } from "../../../ui/theme";
import { yearOf } from "../../../domain/dates";

export default function MonthDetailScreen() {
  const { month } = useLocalSearchParams<{ month: string }>();
  const userId = useUserId();
  const categories = useCategories();
  const persons = usePersons();
  const transactions = useTransactionsBetween(firstDayOf(month!), lastDayOf(month!));
  const bundle = useLedger(yearOf(month!));
  const [expanded, setExpanded] = useState<string | null>(null);
  const { palette } = useTheme();
  const undo = useUndo();

  const ledgerMonth = bundle?.ledger.find((m) => m.month === month);
  const personName = useMemo(() => new Map(persons.map((p) => [p.id, p.name])), [persons]);
  const selfIds = useMemo(() => new Set(persons.filter((p) => p.isSelf).map((p) => p.id)), [persons]);

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

  const cellNotes = useLiveQuery(
    getDb()
      .select()
      .from(s.cellNotes)
      .where(and(eq(s.cellNotes.userId, userId), eq(s.cellNotes.month, month!), isNull(s.cellNotes.deletedAt))),
    [userId, month],
  ).data;

  const removeTx = async (id: string) => {
    const snapshot = await deleteTransaction(userId, id);
    if (snapshot) {
      undo.show(tr.tx.deletedUndo, () => void restoreRow(userId, "transactions", snapshot));
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
          <Spread>
            <Body muted>{tr.cashflow.income}</Body>
            <Amount minor={ledgerMonth.incomeMinor} colorized={false} />
          </Spread>
          <Spread>
            <Body muted>{tr.cashflow.expense}</Body>
            <Amount minor={-ledgerMonth.expenseMinor} />
          </Spread>
          {ledgerMonth.transferMinor !== 0 ? (
            <Spread>
              <Body muted>{tr.cashflow.transfer}</Body>
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

      {transactions.length === 0 ? <EmptyState text={tr.cashflow.emptyMonth} /> : null}

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
            <Pressable onPress={() => setExpanded(open ? null : categoryId)} accessibilityRole="button">
              <Spread>
                <Row gap={spacing.sm}>
                  <Heading style={{ marginVertical: 0 }}>
                    {category?.icon ? `${category.icon} ` : ""}
                    {title}
                  </Heading>
                  {note ? <Badge text="🗒" /> : null}
                </Row>
                <Amount minor={selfSum} />
              </Spread>
            </Pressable>
            {open ? (
              <View style={{ marginTop: spacing.md }}>
                {txs.map((t) => (
                  <View key={t.id}>
                    <Spread style={{ paddingVertical: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <Body>
                          {dateLabel(t.effectiveDate)}
                          {t.installmentNo ? `  ·  ${t.installmentNo}. taksit` : ""}
                          {t.isAggregate ? `  ·  ${tr.bulk.aggregateBadge}` : ""}
                          {!selfIds.has(t.personId) ? `  ·  ${personName.get(t.personId) ?? ""}` : ""}
                        </Body>
                        {t.note ? <Text style={[type.small, { color: palette.textMuted }]}>{t.note}</Text> : null}
                        {t.status === "pending" ? <Badge text={tr.tx.futureNote} tone="warning" /> : null}
                      </View>
                      <Row gap={spacing.md}>
                        <Amount minor={t.type === "income" ? t.amountTryMinor : -t.amountTryMinor} />
                        <Button label={tr.common.delete} variant="ghost" onPress={() => void removeTx(t.id)} />
                      </Row>
                    </Spread>
                    <Divider />
                  </View>
                ))}
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
      <Button label={tr.common.save} variant="secondary" onPress={() => void save()} disabled={text === (existing?.body ?? "")} />
    </View>
  );
}
