import React, { useMemo, useState } from "react";
import { View } from "react-native";
import Pencil from "lucide-react-native/icons/pencil";
import Target from "lucide-react-native/icons/target";
import Trash2 from "lucide-react-native/icons/trash-2";
import { useAllTransactionsState, useCategoryBudgetsState, useCategoriesState, usePersonsState, useTxLike, useUserId } from "../../../data/hooks";
import { combineLiveStates } from "../../../data/live-state";
import { deleteCategoryBudget, restoreCategoryBudget, upsertCategoryBudget } from "../../../data/repo";
import { budgetProgress } from "../../../domain/budgets";
import { monthKeyOf, todayISO } from "../../../domain/dates";
import { formatMinorCompact, formatMinorInput } from "../../../domain/money";
import { tr } from "../../../i18n/tr";
import { scheduleSync } from "../../../sync/engine";
import { Body, Button, Card, CardList, DataStateNotice, EmptyState, IconButton, MoneyField, MonthStepper, PanelHeader, Row, Screen, SectionHeader, SegmentBar, Select, Spread } from "../../../ui/components";
import { categoryIcon } from "../../../domain/category-icons";
import { useDirtyExitGuard } from "../../../ui/dirty-exit";
import { useOperationGuard } from "../../../ui/operation-guard";
import { WorkspaceSplit } from "../../../ui/workspace-layout";
import { spacing, type, useTheme } from "../../../ui/theme";
import { useUndo } from "../../../ui/undo";
import { appAlert } from "../../../ui/dialog";

function BudgetMeter({ spentMinor, limitMinor }: { spentMinor: number; limitMinor: number }) {
  const { palette } = useTheme();
  const ratio = Math.max(0, limitMinor > 0 ? spentMinor / limitMinor : 0);
  const over = spentMinor > limitMinor;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={tr.budgets.progress(formatMinorCompact(spentMinor), formatMinorCompact(limitMinor))}
      style={{ marginBottom: spacing.lg }}
    >
      <SegmentBar ratio={ratio} tone={over ? palette.negative : palette.positive} />
      <Body muted style={{ fontSize: type.caption.fontSize, textAlign: "center", marginTop: spacing.sm }}>
        {tr.budgets.progress(formatMinorCompact(spentMinor), formatMinorCompact(limitMinor))}
      </Body>
    </View>
  );
}

export default function BudgetsScreen() {
  /**
   * An undo that fails must say so — the snackbar dismisses on tap either way,
   * so a swallowed rejection left the row deleted with no message.
   */
  const userId = useUserId();
  const categoriesState = useCategoriesState();
  const budgetsState = useCategoryBudgetsState();
  const transactionsState = useAllTransactionsState();
  const personsState = usePersonsState();
  const categories = categoriesState.data;
  const budgets = budgetsState.data;
  const txLike = useTxLike();
  const { palette } = useTheme();
  const undo = useUndo();
  const guard = useOperationGuard();
  const currentMonth = monthKeyOf(todayISO());
  const [month, setMonth] = useState(currentMonth);
  const [categoryChoice, setCategoryChoice] = useState<string | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  /**
   * What the editor was OPENED with. Dirtiness is this compared against the
   * field, not "is the field non-empty" — tapping an existing budget prefills
   * it, so the emptiness test called every untouched visit unsaved and asked
   * the user to discard changes they had not made.
   */
  const [loadedAmountRaw, setLoadedAmountRaw] = useState("");
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const expenseCategories = categories.filter((category) => category.kind === "expense");
  const monthBudgets = budgets.filter((budget) => budget.month === month);
  const categoryId = categoryChoice ?? expenseCategories.find((category) => !monthBudgets.some((budget) => budget.categoryId === category.id))?.id ?? null;
  const editing = categoryChoice ? monthBudgets.find((budget) => budget.categoryId === categoryChoice) : null;
  const progress = useMemo(() => budgetProgress(monthBudgets, txLike, month, todayISO()), [monthBudgets, txLike, month]);
  const progressById = new Map(progress.map((row) => [row.id, row]));
  const editingProgress = editing ? progressById.get(editing.id) : null;
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const { confirmDiscard } = useDirtyExitGuard(amountRaw !== loadedAmountRaw && !busy);
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([categoriesState, budgetsState, transactionsState, personsState]);

  const reset = () => {
    setCategoryChoice(null);
    setAmountRaw("");
    setLoadedAmountRaw("");
    setAmountMinor(null);
  };
  const changeMonth = (next: string) => {
    confirmDiscard(() => {
      reset();
      setMonth(next);
    });
  };
  const startEdit = (budget: (typeof budgets)[number]) => {
    confirmDiscard(() => {
      const loaded = formatMinorInput(budget.amountMinor);
      setCategoryChoice(budget.categoryId);
      setAmountRaw(loaded);
      setLoadedAmountRaw(loaded);
      setAmountMinor(budget.amountMinor);
    });
  };
  const save = async () => {
    if (!categoryId || amountMinor == null || amountMinor <= 0) return;
    await guard.run(async () => {
      setBusy(true);
      try {
        await upsertCategoryBudget(userId, { month, categoryId, amountMinor });
        scheduleSync(userId);
        reset();
      } catch {
        void appAlert(tr.errors.saveFailed, tr.errors.title);
      } finally {
        setBusy(false);
      }
    });
  };
  const remove = async (budget: (typeof budgets)[number]) => {
    try {
      const snapshot = await deleteCategoryBudget(userId, budget.id);
      scheduleSync(userId);
      const categoryName = categoryById.get(budget.categoryId)?.name ?? tr.budgets.title;
      if (snapshot) undo.show(`${categoryName} · ${tr.common.deleted}`, () => restoreCategoryBudget(userId, snapshot).then(() => scheduleSync(userId)), "warning");
      if (categoryChoice === budget.categoryId) reset();
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    }
  };

  if (!dataReady) {
    return (
      <Screen>
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

  return (
    <Screen width="workspace">
      <DataStateNotice status={dataStatus} retry={retryData} />
      <WorkspaceSplit
        testID="budgets-workspace"
        wideLayout={monthBudgets.length === 0 ? "stack" : "split"}
        primary={(
          <View>
          {/* Forward only. A limit is something to steer by, and a month that
              has already happened cannot be steered — setting one there would
              only rewrite how a closed month scores itself. */}
          <MonthStepper value={month} onChange={changeMonth} min={currentMonth} />
          <Card>
        <PanelHeader icon={Target} title={editing ? tr.budgets.editTitle : tr.budgets.add} description={tr.budgets.formHint} />
        {editingProgress ? (
          <BudgetMeter spentMinor={editingProgress.spentMinor} limitMinor={editingProgress.amountMinor} />
        ) : null}
        <Select
          label={tr.budgets.category}
          options={expenseCategories.map((category) => ({ value: category.id, label: category.name, icon: categoryIcon(category) }))}
          value={categoryId}
          placeholder={tr.budgets.pickCategory}
          onChange={(value) => confirmDiscard(() => {
            setCategoryChoice(value);
            const existing = monthBudgets.find((budget) => budget.categoryId === value);
            const loaded = existing ? formatMinorInput(existing.amountMinor) : "";
            setAmountRaw(loaded);
            setLoadedAmountRaw(loaded);
            setAmountMinor(existing?.amountMinor ?? null);
          })}
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
          </View>
        )}
        secondary={(
          <View>
            <SectionHeader description={tr.budgets.limitsHint}>{tr.budgets.limitsTitle}</SectionHeader>
            {monthBudgets.length === 0 ? (
              <EmptyState icon={Target} title={tr.budgets.emptyTitle} hint={tr.budgets.emptyHint} />
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
                    <Body muted style={{ fontSize: type.small.fontSize }}>
                      {state ? tr.budgets.progress(formatMinorCompact(state.spentMinor), formatMinorCompact(budget.amountMinor)) : formatMinorCompact(budget.amountMinor)}
                    </Body>
                  </View>
                  <Row gap={spacing.sm}>
                    <IconButton icon={Pencil} label={`${tr.common.edit} · ${category?.name ?? tr.common.none}`} onPress={() => startEdit(budget)} />
                    <IconButton icon={Trash2} tone="danger" label={`${tr.common.delete} · ${category?.name ?? tr.common.none}`} haptic="none" onPress={() => void remove(budget)} />
                  </Row>
                </Spread>
                <View style={{ height: 7, borderRadius: 4, backgroundColor: palette.surfaceAlt, marginTop: spacing.sm, overflow: "hidden" }}>
                  <View style={{ height: "100%", width: `${ratio * 100}%`, backgroundColor: (state?.remainingMinor ?? 0) < 0 ? palette.negative : palette.positive }} />
                </View>
                {state && state.remainingMinor < 0 ? <Body style={{ fontSize: type.small.fontSize, color: palette.negativeText, marginTop: spacing.xs }}>{tr.budgets.over(formatMinorCompact(-state.remainingMinor))}</Body> : null}
              </View>
            );
              }}
              />
            )}
          </View>
        )}
      />
    </Screen>
  );
}
