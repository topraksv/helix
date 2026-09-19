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
import { assignedPersonId, PersonAssignment } from "../../../ui/person-assignment";

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

type Income = ReturnType<typeof useRecurringIncomesState>["data"][number];

interface IncomeDraft {
  kind: IncomeKind;
  name: string;
  /** The kind provides the default title until a title is typed. */
  nameTouched: boolean;
  amountRaw: string;
  amountMinor: number | null;
  payDayStr: string;
  recurrence: IncomeRecurrence;
  anchorDate: ISODate;
  personChoice: string | null;
  categoryChoice: string | null;
}

const newIncomeDraft = (): IncomeDraft => ({
  kind: "salary", name: "", nameTouched: false, amountRaw: "", amountMinor: null, payDayStr: "15", recurrence: "monthly",
  anchorDate: todayISO(), personChoice: null, categoryChoice: null,
});

const incomeDraftOf = (income: Income): IncomeDraft => ({
  kind: income.kind as IncomeKind,
  name: income.name,
  nameTouched: true,
  amountRaw: formatMinorInput(income.defaultAmountMinor),
  amountMinor: income.defaultAmountMinor,
  payDayStr: String(income.payDay),
  recurrence: income.recurrence,
  anchorDate: income.anchorDate ?? todayISO(),
  personChoice: income.personId,
  categoryChoice: income.categoryId ?? null,
});

/**
 * Whether the form says anything its starting point does not. The owner's own
 * category choice is compared, not the derived fallback: a legacy income with
 * no category resolves to a default nobody picked, which is not an edit.
 */
function incomeDraftDirty(draft: IncomeDraft, start: IncomeDraft): boolean {
  const said = (d: IncomeDraft) => [d.kind, d.nameTouched ? d.name.trim() : "", d.amountRaw.trim(), d.payDayStr, d.recurrence, d.anchorDate, d.personChoice, d.categoryChoice];
  return JSON.stringify(said(draft)) !== JSON.stringify(said(start));
}

/** The income column a rule files under until the owner picks one: the salary column, else the first. */
function defaultIncomeCategory(categories: { id: string; name: string }[]) {
  const salary = tr.template.categoryNames.salary.toLocaleLowerCase("tr-TR");
  return (categories.find((c) => c.name.toLocaleLowerCase("tr-TR").includes(salary)) ?? categories[0])?.id ?? null;
}

function useIncomeForm(incomes: Income[]) {
  const userId = useUserId();
  const operationGuard = useOperationGuard();
  // Persons and categories load live, so their defaults are derived.
  const persons = usePersonsState().data;
  const incomeCategories = useCategoriesState().data.filter((c) => c.kind === "income");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(newIncomeDraft);
  const [busy, setBusy] = useState(false);
  const patch = (next: Partial<IncomeDraft>) => setDraft((current) => ({ ...current, ...next }));
  const editing = editingId ? incomes.find((income) => income.id === editingId) : undefined;
  const { confirmDiscard } = useDirtyExitGuard(incomeDraftDirty(draft, editing ? incomeDraftOf(editing) : newIncomeDraft()) && !busy);
  const personId = assignedPersonId(draft.personChoice, persons);
  const categoryId = draft.categoryChoice ?? defaultIncomeCategory(incomeCategories);
  // The kind provides the default title; a hand-typed title always wins.
  const name = draft.nameTouched && draft.name.trim() !== "" ? draft.name : tr.incomeKinds[draft.kind];
  const dayValid = isMonthDay(draft.payDayStr);
  const scheduleValid = draft.recurrence === "monthly" ? dayValid : Boolean(draft.anchorDate);
  const valid = name.trim() !== "" && draft.amountMinor != null && draft.amountMinor > 0 && scheduleValid && personId != null && categoryId != null;

  const reset = () => {
    setEditingId(null);
    setDraft(newIncomeDraft());
  };

  const save = () => operationGuard.run(async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const monthly = draft.recurrence === "monthly";
      await upsertRecurringIncome(userId, {
        id: editingId ?? undefined,
        name: name.trim(),
        kind: draft.kind,
        defaultAmountMinor: draft.amountMinor!,
        currency: "TRY",
        payDay: monthly ? Number(draft.payDayStr) : Number(draft.anchorDate.slice(8, 10)),
        recurrence: draft.recurrence,
        anchorDate: monthly ? null : draft.anchorDate,
        personId: personId!,
        categoryId: categoryId!,
        isActive: editing ? editing.isActive : true,
        note: editing?.note ?? null,
      });
      scheduleSync(userId);
      reset();
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    } finally {
      setBusy(false);
    }
  });

  return {
    editingId, draft, patch, busy, valid, save, reset, persons, personId, incomeCategories, categoryId, dayValid,
    startEdit: (income: Income) => confirmDiscard(() => {
      setEditingId(income.id);
      setDraft(incomeDraftOf(income));
    }),
  };
}

function IncomeFormCard({ form }: { form: ReturnType<typeof useIncomeForm> }) {
  const { draft, patch } = form;
  const submit = <Button label={form.editingId ? tr.common.save : tr.settings.addIncomeRule} onPress={() => void form.save()} disabled={!form.valid || form.busy} loading={form.busy} />;
  return (
    <Card>
      <PanelHeader icon={Banknote} title={form.editingId ? tr.incomes.editTitle : tr.incomes.formTitle} description={tr.incomes.formHint} />
      <IncomeCadence recurrence={draft.recurrence} payDay={form.dayValid ? Number(draft.payDayStr) : 15} anchorDate={draft.anchorDate} />
      <Label>{tr.incomes.kindLabel}</Label>
      <ChipPicker options={KINDS.map((k) => ({ value: k, label: tr.incomeKinds[k] }))} value={draft.kind} onChange={(kind) => patch({ kind })} />
      <Field
        label={tr.incomes.nameLabel}
        value={draft.nameTouched ? draft.name : ""}
        onChangeText={(name) => patch({ name, nameTouched: true })}
        placeholder={tr.incomeKinds[draft.kind]}
      />
      <MoneyField label={tr.settings.defaultAmount} value={draft.amountRaw} onChangeMinor={(amountRaw, amountMinor) => patch({ amountRaw, amountMinor })} />
      <Label>{tr.incomes.recurrenceLabel}</Label>
      <ChipPicker
        options={[{ value: "monthly", label: tr.incomes.monthly }, { value: "weekly", label: tr.incomes.weekly }, { value: "biweekly", label: tr.incomes.biweekly }]}
        value={draft.recurrence}
        onChange={(recurrence) => patch({ recurrence })}
      />
      {draft.recurrence === "monthly" ? (
        <MonthDayField
          label={tr.settings.payDay}
          value={draft.payDayStr}
          onChange={(payDayStr) => patch({ payDayStr })}
          quickDays={QUICK_DAYS}
          error={draft.payDayStr !== "" && !form.dayValid ? tr.incomes.dayError : null}
        />
      ) : (
        <DateField label={tr.incomes.firstPaymentDate} value={draft.anchorDate} onChange={(anchorDate) => patch({ anchorDate: anchorDate as ISODate })} />
      )}
      <PersonAssignment people={form.persons} value={form.personId} onChange={(personChoice) => patch({ personChoice })} />
      {form.incomeCategories.length > 1 ? (
        <Select
          label={tr.incomes.categoryLabel}
          options={form.incomeCategories.map((c) => ({ value: c.id, label: c.name, icon: categoryIconComponent(c) }))}
          value={form.categoryId}
          onChange={(categoryChoice) => patch({ categoryChoice })}
        />
      ) : null}
      {form.editingId ? (
        <Row>
          <View style={{ flex: 1 }}>{submit}</View>
          <Button label={tr.common.cancel} variant="ghost" onPress={form.reset} />
        </Row>
      ) : submit}
    </Card>
  );
}

export default function IncomeRulesScreen() {
  const userId = useUserId();
  const incomesState = useRecurringIncomesState();
  const personsState = usePersonsState();
  const categoriesState = useCategoriesState();
  const incomes = incomesState.data;
  const undo = useUndo();
  const form = useIncomeForm(incomes);
  const { status, ready, retry } = combineLiveStates([incomesState, personsState, categoriesState]);

  const remove = async (income: Income) => {
    try {
      const snapshot = await deleteRecurringIncomeWithExpected(userId, income.id);
      scheduleSync(userId);
      if (snapshot) undo.show(`${income.name} · ${tr.common.deleted}`, () => restoreDeletedRule(userId, snapshot).then(() => scheduleSync(userId)), "warning");
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    }
  };

  if (!ready) return <DataGateScreen status={status} retry={retry} />;
  return (
    <Screen width="workspace">
      <DataStateNotice status={status} retry={retry} />
      <WorkspaceSplit
        testID="incomes-workspace"
        wideLayout={incomes.length === 0 ? "stack" : "split"}
        primary={<IncomeFormCard form={form} />}
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
                    badges={[{ text: r.recurrence === "monthly" ? tr.incomes.everyMonth(r.payDay) : tr.incomes.everyInterval(r.recurrence) }]}
                    amountMinor={r.defaultAmountMinor}
                    currency={r.currency}
                    onPress={() => form.startEdit(r)}
                    onEdit={() => form.startEdit(r)}
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
