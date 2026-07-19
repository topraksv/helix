/**
 * Matrix cell editor (spreadsheet habit, spec follow-up): tapping a month ×
 * category cell shows its transactions, the cell note, and a quick-entry box
 * that accepts sum expressions ("300+400+500") saved as one dated row. The
 * transaction list is a real FlatList, so a 1.000+ row cell mounts lazily.
 */

import React, { useEffect, useState } from "react";
import { FlatList, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { restoreRow } from "../db/mutations";
import { addTransaction, deleteTransaction } from "../data/repo";
import { saveCellNote } from "../data/cell-notes";
import { useCategories, useLive, usePersons, usePlans, useTransactionsBetween, useUserId } from "../data/hooks";
import { dateForMonthEntry, firstDayOf, isMonthKey, lastDayOf, monthKeyOf, todayISO } from "../domain/dates";
import { installmentDisplayTitle } from "../domain/installments";
import { formatMinor, parseAmountExpression } from "../domain/money";
import { signedBalanceEffectOf } from "../domain/transactions";
import { transactionDateText } from "../ui/transaction-date";
import { monthLabel, tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { Amount, Body, Button, EmptyState, Field, MoneyField, Row, Screen, SectionHeader, Spread } from "../ui/components";
import { TransactionRow } from "../ui/transaction-row";
import { placeholderPools, useRotatingPlaceholder } from "../ui/placeholders";
import { useUndo } from "../ui/undo";
import { spacing, type, useTheme } from "../ui/theme";
import { navigateBack } from "../ui/navigation";
import { useOperationGuard } from "../ui/operation-guard";
import { useDirtyExitGuard } from "../ui/dirty-exit";

export default function CellEditorModal() {
  const { month, categoryId } = useLocalSearchParams<{ month: string; categoryId: string }>();
  const userId = useUserId();
  const router = useRouter();
  const categories = useCategories();
  const persons = usePersons();
  const plans = usePlans();
  // This screen is only ever opened from a real matrix cell, but the route is
  // still directly addressable (a bookmark, a shared URL, or the Pages 404
  // shell resolving a bare path). Trusting the params crashed the render, so
  // an unusable link returns to the table instead. Substituting a default
  // month is deliberately NOT an option — it would show another cell's money.
  const validMonth = isMonthKey(month) ? month : null;
  const rangeMonth = validMonth ?? monthKeyOf(todayISO());
  useEffect(() => {
    if (!validMonth || !categoryId) navigateBack(router, "/(tabs)/cash-flow");
  }, [validMonth, categoryId, router]);
  const transactions = useTransactionsBetween(firstDayOf(rangeMonth), lastDayOf(rangeMonth));
  const undo = useUndo();
  const { palette } = useTheme();
  const [entryRaw, setEntryRaw] = useState("");
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const operationGuard = useOperationGuard();

  const category = categories.find((c) => c.id === categoryId);
  const selfIds = new Set(persons.filter((p) => p.isSelf).map((p) => p.id));
  const planTitle = new Map(plans.map((plan) => [plan.id, plan.title]));
  const cellTx = transactions.filter((t) => t.categoryId === categoryId);
  const selfSum = cellTx
    .filter((t) => selfIds.has(t.personId))
    .reduce((sum, t) => sum + signedBalanceEffectOf(t.type, t.amountTryMinor, category?.kind ?? null), 0);

  const note = useLive(
    getDb()
      .select()
      .from(s.cellNotes)
      .where(
        and(
          eq(s.cellNotes.userId, userId),
          eq(s.cellNotes.month, rangeMonth),
          eq(s.cellNotes.categoryId, categoryId!),
          isNull(s.cellNotes.deletedAt),
        ),
      ),
    [userId, rangeMonth, categoryId],
    ["cell_notes"],
  ).data[0];

  useDirtyExitGuard(
    (entryRaw.trim() !== "" || (noteDraft != null && noteDraft !== (note?.body ?? ""))) && !busy,
  );

  const entryMinor = parseAmountExpression(entryRaw);

  const addEntry = async () => {
    const selfId = persons.find((p) => p.isSelf)?.id;
    if (!selfId || !category || entryMinor == null || entryMinor === 0) return;
    await operationGuard.run(async () => {
      setBusy(true);
      try {
        const today = todayISO();
        // A negative amount is a reversal of this category: an expense refund
        // reduces spending, an income correction reduces income, and an
        // investment withdrawal reduces the transfer total without changing the
        // category/type invariant.
        const baseType = category.name.toLocaleLowerCase("tr-TR").includes("yatırım") ? "transfer" : category.kind;
        const hasExpr = entryRaw.includes("+") || entryRaw.trim().slice(1).includes("-");
        await addTransaction(userId, {
          type: baseType,
          amountMinor: entryMinor,
          currency: "TRY",
          fxRate: null,
          amountTryMinor: entryMinor,
          effectiveDate: dateForMonthEntry(rangeMonth, today),
          categoryId: category.id,
          paymentSourceId: null,
          personId: selfId,
          note: hasExpr ? entryRaw.trim() : null,
          // An arithmetic expression is still one dated transaction. Aggregate
          // means an intentionally dateless monthly total, not "the user typed +".
          isAggregate: false,
        });
        scheduleSync(userId);
        setEntryRaw("");
      } finally {
        setBusy(false);
      }
    });
  };

  const saveNote = async (body: string) => {
    if (!category) return;
    await saveCellNote(userId, rangeMonth, category.id, body, note);
    setNoteDraft(null);
  };

  const removeTx = async (id: string) => {
    const snapshot = await deleteTransaction(userId, id);
    if (snapshot) undo.show(tr.tx.deletedUndo, () => void restoreRow(userId, "transactions", snapshot), "warning");
  };

  const header = (
    <View>
      <Spread style={{ marginBottom: spacing.md }}>
        <Body muted style={{ flexShrink: 0 }}>{tr.cell.total}</Body>
        <ScrollView
          horizontal
          bounces={false}
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1, marginLeft: spacing.md }}
          contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}
        >
          <Amount minor={selfSum} large style={{ flexShrink: 0 }} />
        </ScrollView>
      </Spread>

      {/* Quick entry */}
      <SectionHeader>{tr.cell.quickEntry}</SectionHeader>
      <Body muted style={{ marginBottom: spacing.sm, fontSize: 12 }}>
        {tr.cell.quickEntryHint}
      </Body>
      <MoneyField
        accessibilityLabel={tr.cell.quickEntry}
        value={entryRaw}
        onChangeMinor={(raw) => setEntryRaw(raw)}
        placeholder={useRotatingPlaceholder(placeholderPools.amount)}
        expression
      />
      {entryMinor != null && (entryRaw.includes("+") || entryRaw.includes("-")) ? (
        <Body muted style={{ marginBottom: spacing.sm }}>
          = {formatMinor(entryMinor)}
        </Body>
      ) : null}
      <Button
        label={tr.common.add}
        onPress={() => void addEntry()}
        disabled={entryMinor == null || entryMinor === 0}
        loading={busy}
      />

      {/* Cell note */}
      <SectionHeader>{tr.cashflow.cellNote}</SectionHeader>
      {noteDraft === null ? (
        <View style={{ marginBottom: spacing.md }}>
          {note?.body ? (
            <Text style={[type.body, { color: palette.text, marginBottom: spacing.sm }]}>{note.body}</Text>
          ) : (
            <Body muted style={{ marginBottom: spacing.sm }}>
              {tr.cell.noNote}
            </Body>
          )}
          <Button
            label={note?.body ? tr.common.edit : tr.cell.addNote}
            variant="secondary"
            size="sm"
            onPress={() => setNoteDraft(note?.body ?? "")}
          />
        </View>
      ) : (
        <View style={{ marginBottom: spacing.md }}>
          <Field accessibilityLabel={tr.common.note} value={noteDraft} onChangeText={setNoteDraft} multiline placeholder={tr.cell.notePlaceholder} />
          <Row gap={spacing.sm}>
            <View style={{ flex: 1 }}>
              <Button label={tr.common.save} size="sm" onPress={() => void saveNote(noteDraft)} />
            </View>
            <Button label={tr.common.cancel} variant="ghost" size="sm" onPress={() => setNoteDraft(null)} />
          </Row>
        </View>
      )}

      <SectionHeader>{tr.cashflow.cellTransactions}</SectionHeader>
    </View>
  );

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ title: `${category?.name ?? ""} · ${monthLabel(rangeMonth)}` }} />
      <FlatList
        data={cellTx}
        keyExtractor={(t) => t.id}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState title={tr.cashflow.emptyMonth} />}
        renderItem={({ item: t, index }) => {
          const installmentTitle = t.installmentPlanId
            ? installmentDisplayTitle(planTitle.get(t.installmentPlanId), t.note, tr.installments.plan)
            : null;
          return (
            <TransactionRow
              installmentTitle={installmentTitle}
              dateText={
                transactionDateText(t) +
                (t.installmentNo ? `  ·  ${tr.installments.nthInstallment(t.installmentNo)}` : "") +
                (t.isAggregate ? `  ·  ${tr.bulk.aggregateBadge}` : "")
              }
              note={t.note}
              pending={t.status === "pending"}
              reversalBadge={
                t.amountTryMinor < 0
                  ? { text: tr.tx.reversalLabel(t.type), tone: t.type === "income" ? "negative" : "positive" }
                  : null
              }
              amountMinor={signedBalanceEffectOf(t.type, t.amountTryMinor, category?.kind ?? null)}
              onEdit={() => router.push({ pathname: "/transaction", params: { id: t.id } })}
              onDelete={() => void removeTx(t.id)}
              divider={index < cellTx.length - 1}
            />
          );
        }}
      />
    </Screen>
  );
}
