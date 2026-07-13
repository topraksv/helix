/**
 * Recurring income rules. Unlike a plain category, a rule *generates* an
 * expected income on its pay day every month: it shows up under Yaklaşan
 * Ödemeler, sends a reminder, and adds to the balance when you confirm it
 * (with the real amount, since salaries vary).
 */

import React, { useState } from "react";
import { View } from "react-native";
import { Banknote, Pencil, Trash2 } from "lucide-react-native";
import { newId } from "../../../db/ids";
import { restoreRow, softDelete, writeRows } from "../../../db/mutations";
import { useCategories, usePersons, useRecurringIncomes, useUserId } from "../../../data/hooks";
import { runMaintenance } from "../../../data/repo";
import { formatMinor } from "../../../domain/money";
import { scheduleSync } from "../../../sync/engine";
import { tr } from "../../../i18n/tr";
import { Body, Button, Card, CardList, ChipPicker, EmptyState, Field, IconButton, Label, MoneyField, Row, Screen, Segmented, Select, Spread } from "../../../ui/components";
import { useUndo } from "../../../ui/undo";
import { spacing } from "../../../ui/theme";

type IncomeKind = "salary" | "rent" | "allowance" | "other";
const KINDS: IncomeKind[] = ["salary", "rent", "allowance", "other"];
const QUICK_DAYS = ["1", "5", "10", "15", "25", "28"] as const;

export default function IncomeRulesScreen() {
  const userId = useUserId();
  const incomes = useRecurringIncomes();
  const persons = usePersons();
  const categories = useCategories();
  const undo = useUndo();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [kind, setKind] = useState<IncomeKind>("salary");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [amountRaw, setAmountRaw] = useState("");
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [payDayStr, setPayDayStr] = useState("15");
  const [busy, setBusy] = useState(false);
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

  const resetForm = () => {
    setEditingId(null);
    setKind("salary");
    setName("");
    setNameTouched(false);
    setAmountRaw("");
    setAmountMinor(null);
    setPayDayStr("15");
    setPersonChoice(null);
    setCategoryChoice(null);
  };

  const startEdit = (r: (typeof incomes)[number]) => {
    setEditingId(r.id);
    setKind(r.kind as IncomeKind);
    setName(r.name);
    setNameTouched(true);
    setAmountRaw((r.defaultAmountMinor / 100).toFixed(2).replace(".", ","));
    setAmountMinor(r.defaultAmountMinor);
    setPayDayStr(String(r.payDay));
    setPersonChoice(r.personId);
    setCategoryChoice(r.categoryId ?? null);
  };

  const save = async () => {
    if (busy || !valid || !personId) return;
    setBusy(true);
    try {
      const existing = editingId ? incomes.find((r) => r.id === editingId) : null;
      await writeRows(userId, [
        {
          table: "recurring_incomes",
          row: {
            ...(existing ?? { note: null }),
            id: editingId ?? newId(),
            name: effectiveName.trim(),
            kind,
            defaultAmountMinor: amountMinor!,
            currency: "TRY",
            payDay,
            personId,
            categoryId,
            isActive: existing ? existing.isActive : true,
            deletedAt: null,
          },
        },
      ]);
      await runMaintenance(userId); // (re)generate this month's expected income immediately
      scheduleSync(userId);
      resetForm();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: (typeof incomes)[number]) => {
    const snapshot = await softDelete(userId, "recurring_incomes", r.id);
    scheduleSync(userId);
    if (snapshot) undo.show(`${r.name} · ${tr.common.deleted}`, () => void restoreRow(userId, "recurring_incomes", snapshot));
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
        {editingId ? (
          <Row>
            <View style={{ flex: 1 }}>
              <Button label={tr.common.save} onPress={() => void save()} disabled={!valid || busy} loading={busy} />
            </View>
            <Button label={tr.common.cancel} variant="ghost" onPress={resetForm} />
          </Row>
        ) : (
          <Button label={tr.settings.addIncomeRule} onPress={() => void save()} disabled={!valid || busy} loading={busy} />
        )}
      </Card>

      {incomes.length === 0 ? (
        <EmptyState icon={Banknote} title={tr.incomes.emptyTitle} hint={tr.incomes.emptyHint} />
      ) : (
        <CardList
          items={incomes}
          keyExtractor={(r) => r.id}
          renderItem={(r) => (
            <Spread style={{ paddingVertical: spacing.sm }}>
              <View style={{ flex: 1, paddingRight: spacing.sm }}>
                <Body>{r.name}</Body>
                <Body muted>
                  {tr.incomeKinds[r.kind]} · {formatMinor(r.defaultAmountMinor, r.currency)} · {tr.incomes.everyMonth(r.payDay)}
                </Body>
              </View>
              <Row gap={spacing.sm}>
                <IconButton icon={Pencil} size={32} label={tr.common.edit} onPress={() => startEdit(r)} />
                <IconButton icon={Trash2} size={32} tone="danger" label={tr.common.delete} onPress={() => void remove(r)} />
              </Row>
            </Spread>
          )}
        />
      )}
    </Screen>
  );
}
