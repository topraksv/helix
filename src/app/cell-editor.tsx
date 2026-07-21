/**
 * Matrix cell editor (spreadsheet habit, spec follow-up): tapping a month ×
 * category cell shows its transactions, the cell note, and a quick-entry box
 * that accepts sum expressions ("300+400+500") saved as one dated row. The
 * transaction list is a real FlatList, so a 1.000+ row cell mounts lazily.
 */

import React, { useState } from "react";
import { FlatList, ScrollView, Text, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { addTransaction, deleteTransaction, restoreTransaction, saveCellNote } from "../data/repo";
import {
  useCategoriesState,
  useCellNotesState,
  usePersonsState,
  usePlansState,
  useTransactionsBetweenState,
  useUserId,
} from "../data/hooks";
import { combineLiveQueryStatus } from "../data/live-state";
import { dateForMonthEntry, firstDayOf, lastDayOf, todayISO } from "../domain/dates";
import { isValidCellParams } from "../domain/route-params";
import { installmentDisplayTitle } from "../domain/installments";
import { formatMinor, parseAmountExpression } from "../domain/money";
import { categoryTableEntryType, signedBalanceEffectOf } from "../domain/transactions";
import { transactionDateText } from "../ui/transaction-date";
import { monthLabel, tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { Amount, Body, Button, DataStateNotice, EmptyState, Field, MoneyField, Row, Screen, SectionHeader, Spread } from "../ui/components";
import { TransactionRow } from "../ui/transaction-row";
import { placeholderPools, useRotatingPlaceholder } from "../ui/placeholders";
import { useUndo } from "../ui/undo";
import { spacing, type, useTheme } from "../ui/theme";
import { useOperationGuard } from "../ui/operation-guard";
import { useDirtyExitGuard } from "../ui/dirty-exit";
import { appAlert } from "../ui/dialog";

/**
 * Both params are hostile input: the route is directly addressable (bookmark,
 * shared link, or the Pages 404 shell resolving a bare path).
 *
 * The gate is here, in the OUTER component, so an invalid link never reaches a
 * database query — the editor below only mounts with validated params and takes
 * them as REQUIRED props. Two earlier shapes were wrong: `categoryId!` with the
 * redirect in an effect (the effect runs after the query is built, so
 * `undefined` was already bound into drizzle's `eq`), and a sentinel id, which
 * hid invalid input inside a well-formed query instead of refusing it.
 *
 * Recovery is a declarative `Redirect`, not a dead-end error screen: the
 * established contract — asserted by `e2e/resilience.spec.ts` "hostile route
 * parameters recover instead of white-screening" — is that the user lands
 * somewhere they can act from, the cash-flow table.
 */
export default function CellEditorModal() {
  const { month, categoryId } = useLocalSearchParams<{ month: string; categoryId: string }>();
  const params = isValidCellParams(month, categoryId);
  if (!params) return <Redirect href="/(tabs)/cash-flow" />;
  return <CellEditor month={params.month} categoryId={params.categoryId} />;
}

function CellEditor({ month, categoryId }: { month: string; categoryId: string }) {
  const userId = useUserId();
  const router = useRouter();
  const categoriesState = useCategoriesState();
  const personsState = usePersonsState();
  const plansState = usePlansState();
  const categories = categoriesState.data;
  const persons = personsState.data;
  const plans = plansState.data;
  const rangeMonth = month;
  const transactionsState = useTransactionsBetweenState(firstDayOf(rangeMonth), lastDayOf(rangeMonth));
  const transactions = transactionsState.data;
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

  const cellNotesState = useCellNotesState();
  const note = cellNotesState.data.find(
    (row) => row.month === rangeMonth && row.categoryId === categoryId,
  );
  const liveStates = [categoriesState, personsState, plansState, transactionsState, cellNotesState];
  const dataStatus = combineLiveQueryStatus(liveStates);
  const dataReady = liveStates.every((state) => state.updatedAt != null);
  const retryData = () => {
    categoriesState.retry();
    personsState.retry();
    plansState.retry();
    transactionsState.retry();
    cellNotesState.retry();
  };

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
        const baseType = categoryTableEntryType(category);
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
      } catch {
        void appAlert(tr.errors.saveFailed, tr.errors.title);
      } finally {
        setBusy(false);
      }
    });
  };

  const saveNote = async (body: string) => {
    if (!category) return;
    await operationGuard.run(async () => {
      setBusy(true);
      try {
        await saveCellNote(userId, rangeMonth, category.id, body, note);
        setNoteDraft(null);
      } catch {
        void appAlert(tr.errors.saveFailed, tr.errors.title);
      } finally {
        setBusy(false);
      }
    });
  };

  const removeTx = async (id: string) => {
    try {
      const snapshot = await deleteTransaction(userId, id);
      if (snapshot) undo.show(tr.tx.deletedUndo, () => restoreTransaction(userId, snapshot), "warning");
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    }
  };

  const header = (
    <View>
      <DataStateNotice status={dataStatus} retry={retryData} />
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
              <Button label={tr.common.save} size="sm" onPress={() => void saveNote(noteDraft)} loading={busy} disabled={busy} />
            </View>
            <Button label={tr.common.cancel} variant="ghost" size="sm" onPress={() => setNoteDraft(null)} />
          </Row>
        </View>
      )}

      <SectionHeader>{tr.cashflow.cellTransactions}</SectionHeader>
    </View>
  );

  if (!dataReady) {
    return (
      <Screen>
        <Stack.Screen options={{ title: monthLabel(rangeMonth) }} />
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

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
