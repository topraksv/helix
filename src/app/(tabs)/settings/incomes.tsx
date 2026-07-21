/**
 * Recurring income rules. Unlike a plain category, a rule *generates* an
 * expected income on its pay day every month: it shows up under Yaklaşan
 * Ödemeler, sends a reminder, and adds to the balance when you confirm it
 * (with the real amount, since salaries vary).
 */

import { Stack, useLocalSearchParams, type Href } from "expo-router";
import { resolveBackTarget } from "../../../ui/navigation";
import { HeaderBackButton } from "../../../ui/header-back";
import React, { useState } from "react";
import { View } from "react-native";
import { Banknote } from "lucide-react-native";
import { useCategoriesState, usePersonsState, useRecurringIncomesState, useUserId } from "../../../data/hooks";
import { combineLiveQueryStatus } from "../../../data/live-state";
import { deleteRecurringIncomeWithExpected, restoreDeletedRule, upsertRecurringIncome } from "../../../data/repo";
import { scheduleSync } from "../../../sync/engine";
import { tr } from "../../../i18n/tr";
import { Body, Button, Card, CardList, ChipPicker, DataStateNotice, EmptyState, Field, Label, MoneyField, Row, Screen, Segmented, Select } from "../../../ui/components";
import { RuleRow } from "../../../ui/rule-row";
import { useUndo } from "../../../ui/undo";
import { spacing } from "../../../ui/theme";
import { useOperationGuard } from "../../../ui/operation-guard";
import { useDirtyExitGuard } from "../../../ui/dirty-exit";
import { isMonthDay, todayISO } from "../../../domain/dates";
import { DateField } from "../../../ui/calendar";
import { MonthDayField } from "../../../ui/month-day-field";
import { appAlert } from "../../../ui/dialog";

type IncomeKind = "salary" | "rent" | "allowance" | "other";
type IncomeRecurrence = "monthly" | "weekly" | "biweekly";
const KINDS: IncomeKind[] = ["salary", "rent", "allowance", "other"];
const QUICK_DAYS = [1, 5, 10, 15, 25, 28] as const;

export default function IncomeRulesScreen() {
  // Reachable from more than one place, and every external push is anchored —
  // which mounts settings/index UNDERNEATH this screen, so plain history would
  // send the user back to a screen they never visited. The pusher records where
  // it came from; `resolveBackTarget` validates it (typeof string +
  // Object.hasOwn, so a hand-typed or prototype-polluting value cannot match)
  // and falls back to the settings hub for deep links with no recorded source.
  const { from } = useLocalSearchParams<{ from?: string }>();
  const back = resolveBackTarget<Href>(from, { upcoming: "/upcoming" as Href }, "/(tabs)/settings");
  const userId = useUserId();
  const incomesState = useRecurringIncomesState();
  const personsState = usePersonsState();
  const categoriesState = useCategoriesState();
  const incomes = incomesState.data;
  const persons = personsState.data;
  const categories = categoriesState.data;
  const undo = useUndo();
  const operationGuard = useOperationGuard();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [kind, setKind] = useState<IncomeKind>("salary");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [amountRaw, setAmountRaw] = useState("");
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [payDayStr, setPayDayStr] = useState("15");
  const [recurrence, setRecurrence] = useState<IncomeRecurrence>("monthly");
  const [anchorDate, setAnchorDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  // persons/categories load async (live queries) — derive the defaults.
  const [personChoice, setPersonChoice] = useState<string | null>(null);
  const personId = personChoice ?? persons.find((p) => p.isSelf)?.id ?? persons[0]?.id ?? null;
  const [categoryChoice, setCategoryChoice] = useState<string | null>(null);
  const incomeCategories = categories.filter((c) => c.kind === "income");
  const categoryId =
    categoryChoice ??
    incomeCategories.find((c) =>
      c.name
        .toLocaleLowerCase("tr-TR")
        .includes(tr.template.categoryNames.salary.toLocaleLowerCase("tr-TR")),
    )?.id ??
    incomeCategories[0]?.id ??
    null;

  // The kind provides the default title; a hand-typed title always wins.
  const effectiveName = nameTouched && name.trim() !== "" ? name : tr.incomeKinds[kind];
  const editingIncome = editingId ? incomes.find((income) => income.id === editingId) : null;
  const editingAmountRaw = editingIncome
    ? (editingIncome.defaultAmountMinor / 100).toFixed(2).replace(".", ",")
    : "";
  const incomeDraftDirty = editingIncome
    ? kind !== editingIncome.kind ||
      effectiveName.trim() !== editingIncome.name ||
      amountRaw !== editingAmountRaw ||
      payDayStr !== String(editingIncome.payDay) ||
      recurrence !== editingIncome.recurrence ||
      anchorDate !== (editingIncome.anchorDate ?? todayISO()) ||
      personId !== editingIncome.personId ||
      categoryId !== editingIncome.categoryId
    : Boolean(
      (nameTouched && name.trim()) ||
      amountRaw.trim() ||
      kind !== "salary" ||
      payDayStr !== "15" ||
      recurrence !== "monthly" ||
      anchorDate !== todayISO() ||
      personChoice ||
      categoryChoice
    );
  useDirtyExitGuard(incomeDraftDirty && !busy);
  const liveStates = [incomesState, personsState, categoriesState];
  const dataStatus = combineLiveQueryStatus(liveStates);
  const dataReady = liveStates.every((state) => state.updatedAt != null);
  const retryData = () => {
    incomesState.retry();
    personsState.retry();
    categoriesState.retry();
  };

  const payDay = Number(payDayStr);
  const dayValid = isMonthDay(payDayStr);
  const scheduleValid = recurrence === "monthly" ? dayValid : Boolean(anchorDate);
  const valid = effectiveName.trim() !== "" && amountMinor != null && amountMinor > 0 && scheduleValid && personId != null && categoryId != null;

  const resetForm = () => {
    setEditingId(null);
    setKind("salary");
    setName("");
    setNameTouched(false);
    setAmountRaw("");
    setAmountMinor(null);
    setPayDayStr("15");
    setRecurrence("monthly");
    setAnchorDate(todayISO());
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
    setRecurrence(r.recurrence);
    setAnchorDate(r.anchorDate ?? todayISO());
    setPersonChoice(r.personId);
    setCategoryChoice(r.categoryId ?? null);
  };

  const save = async () => {
    if (!valid || !personId || !categoryId) return;
    await operationGuard.run(async () => {
      setBusy(true);
      try {
        const existing = editingId ? incomes.find((r) => r.id === editingId) : null;
        await upsertRecurringIncome(userId, {
          id: editingId ?? undefined,
          name: effectiveName.trim(),
          kind,
          defaultAmountMinor: amountMinor!,
          currency: "TRY",
          payDay: recurrence === "monthly" ? payDay : Number(anchorDate.slice(8, 10)),
          recurrence,
          anchorDate: recurrence === "monthly" ? null : anchorDate,
          personId,
          categoryId,
          isActive: existing ? existing.isActive : true,
          note: existing?.note ?? null,
        });
        scheduleSync(userId);
        resetForm();
      } catch {
        void appAlert(tr.errors.saveFailed, tr.errors.title);
      } finally {
        setBusy(false);
      }
    });
  };

  const remove = async (r: (typeof incomes)[number]) => {
    try {
      const snapshot = await deleteRecurringIncomeWithExpected(userId, r.id);
      scheduleSync(userId);
      if (snapshot) {
        undo.show(`${r.name} · ${tr.common.deleted}`, () => {
          return restoreDeletedRule(userId, snapshot).then(() => scheduleSync(userId));
        }, "warning");
      }
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    }
  };

  if (!dataReady) {
    return (
      <Screen>
        <Stack.Screen options={{ headerLeft: () => <HeaderBackButton fallback={back.href} exact={back.exact} /> }} />
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerLeft: () => <HeaderBackButton fallback={back.href} exact={back.exact} /> }} />
      <DataStateNotice status={dataStatus} retry={retryData} />
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
        <Label>{tr.incomes.recurrenceLabel}</Label>
        <Segmented
          options={[
            { value: "monthly", label: tr.incomes.monthly },
            { value: "weekly", label: tr.incomes.weekly },
            { value: "biweekly", label: tr.incomes.biweekly },
          ]}
          value={recurrence}
          onChange={setRecurrence}
        />
        {recurrence === "monthly" ? (
          <MonthDayField
            label={tr.settings.payDay}
            value={payDayStr}
            onChange={setPayDayStr}
            quickDays={QUICK_DAYS}
            error={payDayStr !== "" && !dayValid ? tr.incomes.dayError : null}
          />
        ) : (
          <DateField label={tr.incomes.firstPaymentDate} value={anchorDate} onChange={setAnchorDate} />
        )}
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
          {recurrence === "monthly" ? tr.incomes.behaviorHint(dayValid ? payDay : 15) : tr.incomes.intervalHint(recurrence)}
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
            <RuleRow
              title={r.name}
              meta={tr.incomeKinds[r.kind]}
              badges={[
                { text: r.recurrence === "monthly" ? tr.incomes.everyMonth(r.payDay) : tr.incomes.everyInterval(r.recurrence) },
              ]}
              amountMinor={r.defaultAmountMinor}
              currency={r.currency}
              onPress={() => startEdit(r)}
              onEdit={() => startEdit(r)}
              onDelete={() => void remove(r)}
            />
          )}
        />
      )}
    </Screen>
  );
}
