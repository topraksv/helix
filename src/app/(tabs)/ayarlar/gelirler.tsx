/** Recurring income rules (approved feature): salary-like incomes generate
 *  monthly expected items; the real amount is corrected at confirm time. */

import React, { useState } from "react";
import { View } from "react-native";
import { newId } from "../../../db/ids";
import { restoreRow, softDelete, writeRows } from "../../../db/mutations";
import { useCategories, usePersons, useRecurringIncomes, useUserId } from "../../../data/hooks";
import { runMaintenance } from "../../../data/repo";
import { formatMinor } from "../../../domain/money";
import { scheduleSync } from "../../../sync/engine";
import { tr } from "../../../i18n/tr";
import { Body, Button, Card, ChipPicker, Divider, Field, Label, MoneyField, Row, Screen, Spread } from "../../../ui/components";
import { useUndo } from "../../../ui/undo";
import { spacing } from "../../../ui/theme";

export default function IncomeRulesScreen() {
  const userId = useUserId();
  const incomes = useRecurringIncomes();
  const persons = usePersons();
  const categories = useCategories();
  const undo = useUndo();
  const [name, setName] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [payDayStr, setPayDayStr] = useState("15");
  const [personId, setPersonId] = useState<string | null>(persons.find((p) => p.isSelf)?.id ?? null);
  const [categoryId, setCategoryId] = useState<string | null>(
    categories.find((c) => c.kind === "income" && c.name.toLocaleLowerCase("tr-TR").includes("maaş"))?.id ?? null,
  );

  const payDay = Number(payDayStr);
  const valid =
    name.trim() !== "" && amountMinor != null && amountMinor > 0 && Number.isInteger(payDay) && payDay >= 1 && payDay <= 31 && personId != null;

  const add = async () => {
    if (!valid || !personId) return;
    await writeRows(userId, [
      {
        table: "recurring_incomes",
        row: {
          id: newId(),
          name: name.trim(),
          defaultAmountMinor: amountMinor!,
          currency: "TRY",
          payDay,
          personId,
          categoryId,
          isActive: true,
          note: null,
          deletedAt: null,
        },
      },
    ]);
    await runMaintenance(userId); // generate this month's expected income immediately
    scheduleSync(userId);
    setName("");
    setAmountRaw("");
    setAmountMinor(null);
  };

  const remove = async (r: (typeof incomes)[number]) => {
    const snapshot = await softDelete(userId, "recurring_incomes", r.id);
    scheduleSync(userId);
    if (snapshot) undo.show(`${r.name} — ${tr.common.deleted}`, () => void restoreRow(userId, "recurring_incomes", snapshot));
  };

  return (
    <Screen>
      <Card>
        <Field label={tr.settings.addIncomeRule} value={name} onChangeText={setName} placeholder="Maaş" />
        <MoneyField
          label={`${tr.settings.defaultAmount} (₺)`}
          value={amountRaw}
          onChangeMinor={(raw, minor) => {
            setAmountRaw(raw);
            setAmountMinor(minor);
          }}
        />
        <Field label={tr.settings.payDay} value={payDayStr} onChangeText={setPayDayStr} keyboardType="number-pad" />
        {persons.length > 1 ? (
          <>
            <Label>{tr.tx.person}</Label>
            <ChipPicker options={persons.map((p) => ({ value: p.id, label: p.name }))} value={personId} onChange={setPersonId} />
          </>
        ) : null}
        <Label>{tr.tx.category}</Label>
        <ChipPicker
          options={categories.filter((c) => c.kind === "income").map((c) => ({ value: c.id, label: c.name }))}
          value={categoryId}
          onChange={setCategoryId}
        />
        <Button label={tr.common.add} onPress={() => void add()} disabled={!valid} />
      </Card>

      <Card>
        {incomes.map((r) => (
          <View key={r.id}>
            <Spread style={{ paddingVertical: spacing.sm }}>
              <View>
                <Body>{r.name}</Body>
                <Body muted>
                  {formatMinor(r.defaultAmountMinor, r.currency)} · {tr.settings.payDay}: {r.payDay}
                </Body>
              </View>
              <Row gap={spacing.sm}>
                <Button label={tr.common.delete} variant="ghost" onPress={() => void remove(r)} />
              </Row>
            </Spread>
            <Divider />
          </View>
        ))}
      </Card>
    </Screen>
  );
}
