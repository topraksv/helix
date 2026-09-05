/**
 * Recurring income rules. Unlike a plain category, a rule *generates* an
 * expected income on its pay day every month: it shows up under Yaklaşan
 * Ödemeler, sends a reminder, and adds to the balance when you confirm it
 * (with the real amount, since salaries vary).
 */

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Banknote from "lucide-react-native/icons/banknote";
import { useCategoriesState, usePersonsState, useRecurringIncomesState, useUserId } from "../../../data/hooks";
import { combineLiveStates } from "../../../data/live-state";
import { deleteRecurringIncomeWithExpected, restoreDeletedRule, upsertRecurringIncome } from "../../../data/repo";
import { scheduleSync } from "../../../sync/engine";
import { shortDateLabel, tr } from "../../../i18n/tr";
import { categoryIconComponent } from "../../../ui/category-icon";
import { Body, Button, Card, CardList, ChipPicker, DataGateScreen, DataStateNotice, EmptyState, FadeIn, Field, Label, MoneyField, PanelHeader, Row, Screen, SectionHeader, Select } from "../../../ui/components";
import { RuleRow } from "../../../ui/rule-row";
import { useUndo } from "../../../ui/undo";
import { font, radius, spacing, type, useTheme } from "../../../ui/theme";
import { useOperationGuard } from "../../../ui/operation-guard";
import { useDirtyExitGuard } from "../../../ui/dirty-exit";
import { WorkspaceSplit } from "../../../ui/workspace-layout";
import { addDaysISO, addMonthsToKey, clampDayToMonth, daysBetweenISO, isISODate, isMonthDay, monthKeyOf, monthOf, todayISO, yearOf, type ISODate } from "../../../domain/dates";
import { formatMinorInput } from "../../../domain/money";
import { DateField } from "../../../ui/calendar";
import { MonthDayField } from "../../../ui/month-day-field";
import { appAlert } from "../../../ui/dialog";
import { PersonAssignment } from "../../../ui/person-assignment";

type IncomeKind = "salary" | "rent" | "allowance" | "other";
type IncomeRecurrence = "monthly" | "weekly" | "biweekly";
const KINDS: IncomeKind[] = ["salary", "rent", "allowance", "other"];
const QUICK_DAYS = [1, 5, 10, 15, 25, 28] as const;

function firstIntervalDate(anchorDate: ISODate, intervalDays: number, today: ISODate): ISODate {
  const safeAnchor = isISODate(anchorDate) ? anchorDate : today;
  if (safeAnchor >= today) return safeAnchor;
  const elapsedDays = daysBetweenISO(safeAnchor, today);
  return addDaysISO(safeAnchor, Math.ceil(elapsedDays / intervalDays) * intervalDays);
}

function IncomeCadence({
  recurrence,
  payDay,
  anchorDate,
}: {
  recurrence: IncomeRecurrence;
  payDay: number;
  anchorDate: ISODate;
}) {
  const { palette } = useTheme();
  const today = todayISO();
  const description = recurrence === "monthly"
    ? tr.incomes.everyMonth(payDay)
    : tr.incomes.everyInterval(recurrence);
  const dates = recurrence === "monthly"
    ? (() => {
        const thisMonth = monthKeyOf(today);
        const thisMonthDate = clampDayToMonth(yearOf(thisMonth), monthOf(thisMonth), payDay);
        const firstMonth = thisMonthDate >= today ? thisMonth : addMonthsToKey(thisMonth, 1);
        return Array.from({ length: 4 }, (_, index) => {
          const month = addMonthsToKey(firstMonth, index);
          return clampDayToMonth(yearOf(month), monthOf(month), payDay);
        });
      })()
    : (() => {
        const intervalDays = recurrence === "weekly" ? 7 : 14;
        const first = firstIntervalDate(anchorDate, intervalDays, today);
        return Array.from({ length: 4 }, (_, index) => addDaysISO(first, index * intervalDays));
      })();
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={tr.incomes.cadenceA11y(`${description}: ${dates.map(shortDateLabel).join(", ")}`)}
      style={{ marginBottom: spacing.lg }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {dates.map((date, index) => (
          <React.Fragment key={`${recurrence}-${date}`}>
            {index > 0 ? (
              <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: palette.border }} />
            ) : null}
            <FadeIn
              delay={index * 38}
              style={{
                width: 48,
                height: 32,
                borderRadius: radius.lg,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: index === 0 ? palette.positive + "14" : palette.surfaceAlt,
              }}
            >
              <Text style={[type.small, { color: index === 0 ? palette.positiveText : palette.text, fontFamily: font.bold, fontSize: type.micro.fontSize }]}>
                {shortDateLabel(date).replace(/ \d{4}$/, "")}
              </Text>
            </FadeIn>
          </React.Fragment>
        ))}
      </View>
      <Body muted style={{ fontSize: type.caption.fontSize, textAlign: "center", marginTop: spacing.sm }}>{description}</Body>
    </View>
  );
}

export default function IncomeRulesScreen() {
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
    ? formatMinorInput(editingIncome.defaultAmountMinor)
    : "";
  const incomeDraftDirty = editingIncome
    ? kind !== editingIncome.kind ||
      effectiveName.trim() !== editingIncome.name ||
      amountRaw !== editingAmountRaw ||
      payDayStr !== String(editingIncome.payDay) ||
      recurrence !== editingIncome.recurrence ||
      anchorDate !== (editingIncome.anchorDate ?? todayISO()) ||
      personId !== editingIncome.personId ||
      // The user's own choice, not the derived fallback: a legacy income with
      // no category resolves to a default the user never picked, and comparing
      // that would report an edit nobody made.
      categoryChoice !== editingIncome.categoryId
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
  const { confirmDiscard } = useDirtyExitGuard(incomeDraftDirty && !busy);
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([incomesState, personsState, categoriesState]);

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
    confirmDiscard(() => {
      setEditingId(r.id);
      setKind(r.kind as IncomeKind);
      setName(r.name);
      setNameTouched(true);
      setAmountRaw(formatMinorInput(r.defaultAmountMinor));
      setAmountMinor(r.defaultAmountMinor);
      setPayDayStr(String(r.payDay));
      setRecurrence(r.recurrence);
      setAnchorDate(r.anchorDate ?? todayISO());
      setPersonChoice(r.personId);
      setCategoryChoice(r.categoryId ?? null);
    });
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

  if (!dataReady) return <DataGateScreen status={dataStatus} retry={retryData} />;

  return (
    <Screen width="workspace">
      <DataStateNotice status={dataStatus} retry={retryData} />
      <WorkspaceSplit
        testID="incomes-workspace"
        wideLayout={incomes.length === 0 ? "stack" : "split"}
        primary={(
          <Card>
        <PanelHeader
          icon={Banknote}
          title={editingId ? tr.incomes.editTitle : tr.incomes.formTitle}
          description={tr.incomes.formHint}
        />
        <IncomeCadence
          recurrence={recurrence}
          payDay={dayValid ? payDay : 15}
          anchorDate={anchorDate}
        />
        <Label>{tr.incomes.kindLabel}</Label>
        <ChipPicker options={KINDS.map((k) => ({ value: k, label: tr.incomeKinds[k] }))} value={kind} onChange={setKind} />
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
        <ChipPicker
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
        <PersonAssignment people={persons} value={personId} onChange={setPersonChoice} />
        {incomeCategories.length > 1 ? (
          <Select
            label={tr.incomes.categoryLabel}
            options={incomeCategories.map((c) => ({ value: c.id, label: c.name, icon: categoryIconComponent(c) }))}
            value={categoryId}
            onChange={setCategoryChoice}
          />
        ) : null}
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
        )}
        secondary={(
          <View>
            <SectionHeader description={tr.incomes.listHint}>{tr.incomes.listTitle}</SectionHeader>
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
          </View>
        )}
      />
    </Screen>
  );
}
