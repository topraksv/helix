/**
 * Matrix cell editor (spreadsheet habit, spec follow-up): tapping a month ×
 * category cell shows its transactions, the cell note, and a quick-entry box
 * that accepts sum expressions ("300+400+500") saved as one aggregate row.
 */

import React, { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { and, eq, isNull } from "drizzle-orm";
import { Pencil, Trash2 } from "lucide-react-native";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { newId } from "../db/ids";
import { restoreRow, writeRows } from "../db/mutations";
import { addTransaction, deleteTransaction } from "../data/repo";
import { useCategories, useLive, usePersons, useTransactionsBetween, useUserId } from "../data/hooks";
import { firstDayOf, lastDayOf, todayISO } from "../domain/dates";
import { formatMinor, parseAmountExpression } from "../domain/money";
import { dateLabel, monthLabel, tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { Amount, Badge, Body, Button, Divider, EmptyState, Field, IconButton, Row, Screen, SectionHeader, Spread } from "../ui/components";
import { useUndo } from "../ui/undo";
import { spacing, type, useTheme } from "../ui/theme";

export default function CellEditorModal() {
  const { month, categoryId } = useLocalSearchParams<{ month: string; categoryId: string }>();
  const userId = useUserId();
  const router = useRouter();
  const categories = useCategories();
  const persons = usePersons();
  const transactions = useTransactionsBetween(firstDayOf(month!), lastDayOf(month!));
  const undo = useUndo();
  const { palette } = useTheme();
  const [entryRaw, setEntryRaw] = useState("");
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const category = categories.find((c) => c.id === categoryId);
  const selfIds = useMemo(() => new Set(persons.filter((p) => p.isSelf).map((p) => p.id)), [persons]);
  const cellTx = transactions.filter((t) => t.categoryId === categoryId);
  const selfSum = cellTx
    .filter((t) => selfIds.has(t.personId))
    .reduce((sum, t) => sum + (t.type === "income" ? t.amountTryMinor : -t.amountTryMinor), 0);

  const note = useLive(
    getDb()
      .select()
      .from(s.cellNotes)
      .where(
        and(
          eq(s.cellNotes.userId, userId),
          eq(s.cellNotes.month, month!),
          eq(s.cellNotes.categoryId, categoryId!),
          isNull(s.cellNotes.deletedAt),
        ),
      ),
    [userId, month, categoryId],
  ).data[0];

  const entryMinor = parseAmountExpression(entryRaw);
  const entryInvalid = entryRaw.trim() !== "" && entryMinor == null;

  const addEntry = async () => {
    const selfId = persons.find((p) => p.isSelf)?.id;
    if (!selfId || !category || entryMinor == null || entryMinor === 0) return;
    setBusy(true);
    try {
      const today = todayISO();
      const inMonth = today >= firstDayOf(month!) && today <= lastDayOf(month!);
      // A negative amount flips the flow (an expense cell entered as "-500"
      // records income, and vice-versa) — mirrors the importer so the sign is
      // never silently dropped. Transfers keep their direction.
      const negative = entryMinor < 0;
      const baseType = category.name.toLocaleLowerCase("tr-TR").includes("yatırım") ? "transfer" : category.kind;
      const type = negative && baseType !== "transfer" ? (baseType === "expense" ? "income" : "expense") : baseType;
      const hasExpr = entryRaw.includes("+") || entryRaw.trim().slice(1).includes("-");
      await addTransaction(userId, {
        type,
        amountMinor: Math.abs(entryMinor),
        currency: "TRY",
        fxRate: null,
        amountTryMinor: Math.abs(entryMinor),
        effectiveDate: inMonth ? today : `${month}-15`,
        categoryId: category.id,
        paymentSourceId: null,
        personId: selfId,
        note: hasExpr ? entryRaw.trim() : null,
        isAggregate: hasExpr,
      });
      scheduleSync(userId);
      setEntryRaw("");
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async (body: string) => {
    await writeRows(userId, [
      {
        table: "cell_notes",
        row: {
          id: note?.id ?? newId(),
          month: month!,
          categoryId: categoryId!,
          body: body.trim(),
          deletedAt: body.trim() === "" ? new Date().toISOString() : null,
        },
      },
    ]);
    scheduleSync(userId);
    setNoteDraft(null);
  };

  const removeTx = async (id: string) => {
    const snapshot = await deleteTransaction(userId, id);
    if (snapshot) undo.show(tr.tx.deletedUndo, () => void restoreRow(userId, "transactions", snapshot));
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: `${category?.name ?? ""} · ${monthLabel(month!)}` }} />

      <Spread style={{ marginBottom: spacing.md }}>
        <Body muted>{tr.cell.total}</Body>
        <Amount minor={selfSum} large />
      </Spread>

      {/* Quick entry */}
      <SectionHeader>{tr.cell.quickEntry}</SectionHeader>
      <Body muted style={{ marginBottom: spacing.sm, fontSize: 12 }}>
        {tr.cell.quickEntryHint}
      </Body>
      <Field
        value={entryRaw}
        onChangeText={setEntryRaw}
        placeholder={tr.cell.quickEntryPlaceholder}
        keyboardType="numbers-and-punctuation"
        inputMode="text"
        autoCapitalize="none"
        error={entryInvalid ? tr.common.invalidAmount : null}
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
          <Field value={noteDraft} onChangeText={setNoteDraft} multiline placeholder={tr.cell.notePlaceholder} />
          <Row gap={spacing.sm}>
            <View style={{ flex: 1 }}>
              <Button label={tr.common.save} size="sm" onPress={() => void saveNote(noteDraft)} />
            </View>
            <Button label={tr.common.cancel} variant="ghost" size="sm" onPress={() => setNoteDraft(null)} />
          </Row>
        </View>
      )}

      {/* Transactions in this cell */}
      <SectionHeader>{tr.cashflow.cellTransactions}</SectionHeader>
      {cellTx.length === 0 ? (
        <EmptyState title={tr.cashflow.emptyMonth} />
      ) : (
        cellTx.map((t) => (
          <View key={t.id}>
            <Spread style={{ paddingVertical: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Body>
                  {dateLabel(t.effectiveDate)}
                  {t.installmentNo ? `  ·  ${t.installmentNo}. taksit` : ""}
                </Body>
                <Row gap={spacing.sm} style={{ marginTop: 2 }}>
                  {t.isAggregate ? <Badge text={tr.bulk.aggregateBadge} /> : null}
                  {t.status === "pending" ? <Badge text={tr.tx.futureNote} tone="warning" /> : null}
                  {t.note ? (
                    <Text style={[type.small, { color: palette.textMuted, flexShrink: 1 }]}>
                      {t.note}
                    </Text>
                  ) : null}
                </Row>
              </View>
              <Row gap={spacing.sm}>
                <Amount minor={t.type === "income" ? t.amountTryMinor : -t.amountTryMinor} />
                <IconButton icon={Pencil} size={32} label={tr.common.edit} onPress={() => router.push({ pathname: "/transaction", params: { id: t.id } })} />
                <IconButton icon={Trash2} size={32} tone="danger" label={tr.common.delete} onPress={() => void removeTx(t.id)} />
              </Row>
            </Spread>
            <Divider />
          </View>
        ))
      )}
    </Screen>
  );
}
