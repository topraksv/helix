/**
 * Recurring income rules. Unlike a plain category, a rule *generates* an
 * expected income on its pay day every month: it shows up under Yaklaşan
 * Ödemeler, sends a reminder, and adds to the balance when you confirm it
 * (with the real amount, since salaries vary).
 */

import React, { useState } from "react";
import { View } from "react-native";
import { Banknote, Trash2 } from "lucide-react-native";
import { newId } from "../../../db/ids";
import { restoreRow, softDelete, writeRows } from "../../../db/mutations";
import { useCategories, usePersons, useRecurringIncomes, useUserId } from "../../../data/hooks";
import { runMaintenance } from "../../../data/repo";
import { formatMinor } from "../../../domain/money";
import { scheduleSync } from "../../../sync/engine";
import { tr } from "../../../i18n/tr";
import { Body, Button, Card, ChipPicker, Divider, EmptyState, Field, IconButton, Label, MoneyField, Screen, Segmented, Select, Spread } from "../../../ui/components";
import { useUndo } from "../../../ui/undo";
import { spacing } from "../../../ui/theme";

type IncomeKind = "salary" | "rent" | "allowance" | "other";
const KINDS: IncomeKind[] = ["salary", "rent", "allowance", "other"];
const QUICK_DAYS = ["1", "5", "10", "15", "20", "25", "28"] as const;

export default function IncomeRulesScreen() {
  const userId = useUserId();
  const incomes = useRecurringIncomes();
  const persons = usePersons();
  const categories = useCategories();
  const undo = useUndo();
  const [kind, setKind] = useState<IncomeKind>("salary");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [amountRaw, setAmountRaw] = useState("");
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [payDayStr, setPayDayStr] = useState("15");
  // persons/categories load async (live queries) — derive the defaults.
  const [personChoice, setPersonChoice] = useState<string | null>(null);
  const personId = personChoice ?? persons.find((p) => p.isSelf)?.id ?? persons[0]?.id ?? null;
  const [categoryChoice, setCategoryChoice] = useState<string | null>(null);
  const incomeCategories = categories.filter((c) => c.kind === "income");
  const categoryId =
    categoryChoice ??
    incomeCategories.find((c) => c.name.toLocaleLowerCase("tr-TR").includes("maaş"))?.id ??
    incomeCategories[0]?.id ??
    null;

  // The kind provides the default title; a hand-typed title always wins.
  const effectiveName = nameTouched && name.trim() !== "" ? name : tr.incomeKinds[kind];

  const payDay = Number(payDayStr);
  const dayValid = Number.isInteger(payDay) && payDay >= 1 && payDay <= 31;
  const valid = effectiveName.trim() !== "" && amountMinor != null && amountMinor > 0 && dayValid && personId != null;

  const add = async () => {
    if (!valid || !personId) return;
    await writeRows(userId, [
      {
        table: "recurring_incomes",
        row: {
          id: newId(),
          name: effectiveName.trim(),
          kind,
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
    setNameTouched(false);
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
      <Body muted style={{ marginBottom: spacing.md }}>{tr.incomes.intro}</Body>
      <Card>
        <Label>{tr.incomes.kindLabel}</Label>
        <Segmented options={KINDS.map((k) => ({ value: k, label: tr.incomeKinds[k] }))} value={kind} onChange={setKind} />
        <Field
          label={tr.incomes.nameLabel}
          value={nameTouched ? name : ""}
          onChangeText={(v) => {
            setName(v);
            setNameTouched(true);
          }}
          placeholder={tr.incomeKinds[kind]}
        />
        <MoneyField
          label={tr.settings.defaultAmount}
          value={amountRaw}
          onChangeMinor={(raw, minor) => {
            setAmountRaw(raw);
            setAmountMinor(minor);
          }}
        />
        <Label>{tr.settings.payDay}</Label>
        <ChipPicker
          options={QUICK_DAYS.map((d) => ({ value: d, label: d }))}
          value={(QUICK_DAYS as readonly string[]).includes(payDayStr) ? (payDayStr as (typeof QUICK_DAYS)[number]) : null}
          onChange={setPayDayStr}
        />
        <Field
          label={tr.incomes.customDay}
          value={payDayStr}
          onChangeText={setPayDayStr}
          keyboardType="number-pad"
          error={payDayStr !== "" && !dayValid ? tr.incomes.dayError : null}
        />
        {persons.length > 1 ? (
          <>
            <Label>{tr.tx.person}</Label>
            <ChipPicker options={persons.map((p) => ({ value: p.id, label: p.name }))} value={personId} onChange={setPersonChoice} />
          </>
        ) : null}
        {incomeCategories.length > 1 ? (
          <Select
            label={tr.incomes.categoryLabel}
            options={incomeCategories.map((c) => ({ value: c.id, label: c.name }))}
            value={categoryId}
            onChange={setCategoryChoice}
          />
        ) : null}
        <Body muted style={{ marginBottom: spacing.md, fontSize: 12 }}>
          {tr.incomes.behaviorHint(dayValid ? payDay : 15)}
        </Body>
        <Button label={tr.settings.addIncomeRule} onPress={() => void add()} disabled={!valid} />
      </Card>

      {incomes.length === 0 ? (
        <EmptyState icon={Banknote} title={tr.incomes.emptyTitle} hint={tr.incomes.emptyHint} />
      ) : (
        <Card>
          {incomes.map((r) => (
            <View key={r.id}>
              <Spread style={{ paddingVertical: spacing.sm }}>
                <View>
                  <Body>{r.name}</Body>
                  <Body muted>
                    {tr.incomeKinds[r.kind]} · {formatMinor(r.defaultAmountMinor, r.currency)} · {tr.incomes.everyMonth(r.payDay)}
                  </Body>
                </View>
                <IconButton icon={Trash2} size={32} tone="danger" label={tr.common.delete} onPress={() => void remove(r)} />
              </Spread>
              <Divider />
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
