import React, { useState } from "react";
import { View } from "react-native";
import { PiggyBank, Pencil, Trash2 } from "lucide-react-native";
import { useAllTransactions, useCategoryBudgets, useCategories, usePersons, useUserId, toTxLike } from "../../../data/hooks";
import { deleteCategoryBudget, upsertCategoryBudget } from "../../../data/repo";
import { restoreRow } from "../../../db/mutations";
import { budgetProgress } from "../../../domain/budgets";
import { monthKeyOf, todayISO } from "../../../domain/dates";
import { formatMinor } from "../../../domain/money";
import { tr } from "../../../i18n/tr";
import { scheduleSync } from "../../../sync/engine";
import { Body, Button, Card, CardList, EmptyState, IconButton, MoneyField, MonthStepper, Row, Screen, Select, Spread } from "../../../ui/components";
import { useDirtyExitGuard } from "../../../ui/dirty-exit";
import { useOperationGuard } from "../../../ui/operation-guard";
import { spacing, useTheme } from "../../../ui/theme";
import { useUndo } from "../../../ui/undo";

export default function BudgetsScreen() {
  const userId = useUserId();
  const categories = useCategories();
  const budgets = useCategoryBudgets();
  const transactions = useAllTransactions();
  const persons = usePersons();
  const { palette } = useTheme();
  const undo = useUndo();
  const guard = useOperationGuard();
  const [month, setMonth] = useState(monthKeyOf(todayISO()));
  const [categoryChoice, setCategoryChoice] = useState<string | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const expenseCategories = categories.filter((category) => category.kind === "expense");
  const monthBudgets = budgets.filter((budget) => budget.month === month);
  const categoryId = categoryChoice ?? expenseCategories.find((category) => !monthBudgets.some((budget) => budget.categoryId === category.id))?.id ?? null;
  const editing = categoryChoice ? monthBudgets.find((budget) => budget.categoryId === categoryChoice) : null;
  const progress = budgetProgress(monthBudgets, toTxLike(transactions, persons, categories), month, todayISO());
  const progressById = new Map(progress.map((row) => [row.id, row]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  useDirtyExitGuard(Boolean(amountRaw.trim()) && !busy);

  const reset = () => {
    setCategoryChoice(null);
    setAmountRaw("");
    setAmountMinor(null);
  };
  const changeMonth = (next: string) => {
    reset();
    setMonth(next);
  };
  const startEdit = (budget: (typeof budgets)[number]) => {
    setCategoryChoice(budget.categoryId);
    setAmountRaw((budget.amountMinor / 100).toFixed(2).replace(".", ","));
    setAmountMinor(budget.amountMinor);
  };
  const save = async () => {
    if (!categoryId || amountMinor == null || amountMinor <= 0) return;
    await guard.run(async () => {
      setBusy(true);
      try {
        await upsertCategoryBudget(userId, { month, categoryId, amountMinor });
        scheduleSync(userId);
        reset();
      } finally {
        setBusy(false);
      }
    });
  };
  const remove = async (budget: (typeof budgets)[number]) => {
    const snapshot = await deleteCategoryBudget(userId, budget.id);
    scheduleSync(userId);
    const categoryName = categoryById.get(budget.categoryId)?.name ?? tr.budgets.title;
    if (snapshot) undo.show(`${categoryName} · ${tr.common.deleted}`, () => void restoreRow(userId, "category_budgets", snapshot).then(() => scheduleSync(userId)), "warning");
    if (categoryChoice === budget.categoryId) reset();
  };

  return (
    <Screen>
      <Body muted style={{ marginBottom: spacing.md }}>{tr.budgets.intro}</Body>
      <MonthStepper value={month} onChange={changeMonth} />
      <Card>
        <Select
          label={tr.budgets.category}
          options={expenseCategories.map((category) => ({ value: category.id, label: category.name }))}
          value={categoryId}
          placeholder={tr.budgets.pickCategory}
          onChange={(value) => {
            setCategoryChoice(value);
            const existing = monthBudgets.find((budget) => budget.categoryId === value);
            setAmountRaw(existing ? (existing.amountMinor / 100).toFixed(2).replace(".", ",") : "");
            setAmountMinor(existing?.amountMinor ?? null);
          }}
        />
        <MoneyField
          label={tr.budgets.amount}
          value={amountRaw}
          onChangeMinor={(raw, minor) => {
            setAmountRaw(raw);
            setAmountMinor(minor);
          }}
        />
        <Row>
          <View style={{ flex: 1 }}>
            <Button label={editing ? tr.common.save : tr.budgets.add} onPress={() => void save()} disabled={!categoryId || amountMinor == null || amountMinor <= 0 || busy} loading={busy} />
          </View>
          {editing ? <Button label={tr.common.cancel} variant="ghost" onPress={reset} /> : null}
        </Row>
      </Card>

      {monthBudgets.length === 0 ? (
        <EmptyState icon={PiggyBank} title={tr.budgets.emptyTitle} hint={tr.budgets.emptyHint} />
      ) : (
        <CardList
          items={monthBudgets}
          keyExtractor={(budget) => budget.id}
          renderItem={(budget) => {
            const category = categoryById.get(budget.categoryId);
            const state = progressById.get(budget.id);
            const ratio = Math.max(0, Math.min(state?.ratio ?? 0, 1));
            return (
              <View style={{ paddingVertical: spacing.sm }}>
                <Spread>
                  <View style={{ flex: 1, paddingRight: spacing.sm }}>
                    <Body>{category?.name ?? tr.common.none}</Body>
                    <Body muted style={{ fontSize: 12 }}>
                      {state ? tr.budgets.progress(formatMinor(state.spentMinor), formatMinor(budget.amountMinor)) : formatMinor(budget.amountMinor)}
                    </Body>
                  </View>
                  <Row gap={spacing.sm}>
                    <IconButton icon={Pencil} size={32} label={tr.common.edit} onPress={() => startEdit(budget)} />
                    <IconButton icon={Trash2} size={32} tone="danger" label={tr.common.delete} haptic="none" onPress={() => void remove(budget)} />
                  </Row>
                </Spread>
                <View style={{ height: 7, borderRadius: 4, backgroundColor: palette.surfaceAlt, marginTop: spacing.sm, overflow: "hidden" }}>
                  <View style={{ height: "100%", width: `${ratio * 100}%`, backgroundColor: (state?.remainingMinor ?? 0) < 0 ? palette.negative : palette.positive }} />
                </View>
                {state && state.remainingMinor < 0 ? <Body style={{ fontSize: 12, color: palette.negativeText, marginTop: spacing.xs }}>{tr.budgets.over(formatMinor(-state.remainingMinor))}</Body> : null}
              </View>
            );
          }}
        />
      )}
    </Screen>
  );
}
