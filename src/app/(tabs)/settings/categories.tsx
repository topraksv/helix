/** Category & column management — the personalization core: names, kinds,
 *  column visibility all belong to the user (nothing is hardcoded). */

import React, { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useCategoriesState, useUserId } from "../../../data/hooks";
import { combineLiveStates } from "../../../data/live-state";
import { categoryReferenceUsage, createCategory, deleteCategoryWithBudgets, reorderCategoryGroup, restoreCategoryWithBudgets, updateCategory } from "../../../data/repo";
import type { CategoryReferenceUsage } from "../../../data/repo";
import { categoryIcon } from "../../../data/category-icons";
import { scheduleSync } from "../../../sync/engine";
import { appAlert, appConfirm } from "../../../ui/dialog";
import { tr } from "../../../i18n/tr";
import ArrowDownLeft from "lucide-react-native/icons/arrow-down-left";
import ArrowUpRight from "lucide-react-native/icons/arrow-up-right";
import Columns3 from "lucide-react-native/icons/columns-3";
import LayoutTemplate from "lucide-react-native/icons/layout-template";
import Pencil from "lucide-react-native/icons/pencil";
import Plus from "lucide-react-native/icons/plus";
import Trash2 from "lucide-react-native/icons/trash-2";
import { Badge, Body, Button, Card, ChipPicker, DataStateNotice, Divider, EmptyState, FadeIn, Field, IconButton, PanelHeader, Row, Screen, Select, Spread, Toggle } from "../../../ui/components";
import { DraggableList, ReorderGrip } from "../../../ui/draggable-list";
import { placeholderPools, useRotatingPlaceholder } from "../../../ui/placeholders";
import { useUndo } from "../../../ui/undo";
import { radius, spacing, type, useTheme } from "../../../ui/theme";
import { useOperationGuard } from "../../../ui/operation-guard";
import { useDirtyExitGuard } from "../../../ui/dirty-exit";
import { WorkspaceSplit } from "../../../ui/workspace-layout";

const UNCATEGORIZED_CHOICE = "__uncategorized__";
type CategoryItem = ReturnType<typeof useCategoriesState>["data"][number];

function CategoryLedgerMap({ expenseCount, incomeCount }: { expenseCount: number; incomeCount: number }) {
  const { palette } = useTheme();
  const node = {
    width: 52,
    height: 52,
    borderRadius: radius.xl,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };
  return (
    <View
      testID="category-ledger-map"
      accessible
      accessibilityRole="image"
      accessibilityLabel={tr.settings.categoryMapA11y(expenseCount, incomeCount)}
      style={{ marginBottom: spacing.lg }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <FadeIn style={{ alignItems: "center", gap: spacing.xs }}>
          <View style={[node, { backgroundColor: palette.negative + "14" }]}>
            <ArrowUpRight accessible={false} size={20} color={palette.negative} />
          </View>
          <Body muted style={{ fontSize: type.small.fontSize }}>{tr.settings.expenseCount(expenseCount)}</Body>
        </FadeIn>
        <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginHorizontal: spacing.sm }} />
        <FadeIn delay={70} style={{ alignItems: "center", gap: spacing.xs }}>
          <View style={[node, { backgroundColor: palette.primarySoft }]}>
            <Columns3 accessible={false} size={21} color={palette.primary} />
          </View>
          <Body muted style={{ fontSize: type.small.fontSize }}>{tr.cashflow.title}</Body>
        </FadeIn>
        <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginHorizontal: spacing.sm }} />
        <FadeIn delay={140} style={{ alignItems: "center", gap: spacing.xs }}>
          <View style={[node, { backgroundColor: palette.positive + "14" }]}>
            <ArrowDownLeft accessible={false} size={20} color={palette.positive} />
          </View>
          <Body muted style={{ fontSize: type.small.fontSize }}>{tr.settings.incomeCountShort(incomeCount)}</Body>
        </FadeIn>
      </View>
    </View>
  );
}

export default function CategoriesScreen({ header }: { header?: ReactNode } = {}) {
  const userId = useUserId();
  const router = useRouter();
  const categoriesState = useCategoriesState();
  const categories = categoriesState.data;
  const undo = useUndo();
  const { palette } = useTheme();
  const operationGuard = useOperationGuard();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [isInvestment, setIsInvestment] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  // "Yatırım kategorisi" is a rarely-changed classification of the category,
  // not a per-row switch: it belongs to the row being edited, alongside its
  // name. It is persisted as `isTransfer` — the product concept is investment,
  // the stored column keeps its original name (see ARCHITECTURE.md).
  const [editInvestment, setEditInvestment] = useState(false);
  const [deleteResolution, setDeleteResolution] = useState<{
    category: CategoryItem;
    usage: CategoryReferenceUsage;
    replacementId: string | null;
  } | null>(null);
  // Freeze the screen's scroll while a row is being dragged, so the vertical
  // drag reorders instead of scrolling the page.
  const [dragging, setDragging] = useState(false);
  const editingCategory = editingId ? categories.find((category) => category.id === editingId) : null;
  const editDraftDirty = Boolean(
    editingCategory &&
      (editName.trim() !== editingCategory.name || editInvestment !== editingCategory.isTransfer),
  );
  const { confirmDiscard } = useDirtyExitGuard(name.trim() !== "" || editDraftDirty);
  const startEditing = (category: (typeof categories)[number]) => {
    confirmDiscard(() => {
      setEditingId(category.id);
      setEditName(category.name);
      setEditInvestment(category.isTransfer);
    }, editDraftDirty);
  };
  const categoryPlaceholder = useRotatingPlaceholder(placeholderPools.category);
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([categoriesState]);

  const add = async () => {
    if (!name.trim()) return;
    await operationGuard.run(async () => {
      setAdding(true);
      try {
        await createCategory(userId, { name, kind, isTransfer: isInvestment, sortOrder: categories.length });
        scheduleSync(userId);
        setName("");
        setIsInvestment(false);
      } catch {
        void appAlert(tr.errors.saveFailed, tr.errors.title);
      } finally {
        setAdding(false);
      }
    });
  };

  const update = async (c: (typeof categories)[number], patch: Parameters<typeof updateCategory>[2]) => {
    try {
      await updateCategory(userId, c, patch);
      scheduleSync(userId);
      return true;
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
      return false;
    }
  };

  // Commit a drag reorder within a kind group (which is what the Mali Tablo
  // matrix renders as its column/row order). `sortOrder` is a synced column, so
  // the new order propagates to every device — consistent with how the rest of
  // the workspace syncs (there is no device-local ordering pref here). We
  // reassign the group's own existing sortOrder slots onto the new order, so
  // the other kind's rows keep their positions untouched.
  const applyOrder = async (kind: "expense" | "income", orderedIds: string[]) => {
    try {
      await reorderCategoryGroup(userId, categories, kind, orderedIds);
      scheduleSync(userId);
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    }
  };

  const deleteCategory = async (c: CategoryItem, replacementChoice?: string | null) => {
    const replacementId = replacementChoice === UNCATEGORIZED_CHOICE ? null : replacementChoice;
    const snapshot = replacementChoice === undefined
      ? await deleteCategoryWithBudgets(userId, c.id)
      : await deleteCategoryWithBudgets(userId, c.id, replacementId);
    scheduleSync(userId);
    setDeleteResolution(null);
    if (snapshot) {
      undo.show(`${c.name} · ${tr.common.deleted}`, () => {
        return restoreCategoryWithBudgets(userId, snapshot).then(() => scheduleSync(userId));
      }, "warning");
    }
  };

  const remove = async (c: CategoryItem) => {
    try {
      const usage = await categoryReferenceUsage(userId, c.id);
      if (usage.total > 0) {
        const candidates = categories.filter((candidate) =>
          candidate.id !== c.id && candidate.kind === c.kind && candidate.isTransfer === c.isTransfer,
        );
        const normalizedName = c.name.trim().toLocaleLowerCase("tr-TR");
        const sameName = candidates.find((candidate) => candidate.name.trim().toLocaleLowerCase("tr-TR") === normalizedName);
        const canLeaveUncategorized = usage.subscriptions === 0 && usage.recurringIncomes === 0 && usage.cellNotes === 0;
        setDeleteResolution({
          category: c,
          usage,
          // Same-name columns (the common Excel year split) are selected first,
          // but the user can choose any compatible live column before confirming.
          replacementId: sameName?.id ?? (canLeaveUncategorized ? UNCATEGORIZED_CHOICE : candidates[0]?.id ?? null),
        });
        return;
      }
      const ok = await appConfirm(tr.settings.deleteCategoryTitle, tr.settings.deleteCategoryBody(0), {
        confirmLabel: tr.common.delete,
        danger: true,
      });
      if (ok) await deleteCategory(c);
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    }
  };

  const replacementCandidates = deleteResolution
    ? categories.filter((candidate) =>
        candidate.id !== deleteResolution.category.id
        && candidate.kind === deleteResolution.category.kind
        && candidate.isTransfer === deleteResolution.category.isTransfer,
      )
    : [];
  const canLeaveUncategorized = deleteResolution
    ? deleteResolution.usage.subscriptions === 0
      && deleteResolution.usage.recurringIncomes === 0
      && deleteResolution.usage.cellNotes === 0
    : false;
  const replacementOptions = deleteResolution
    ? [
        ...(canLeaveUncategorized ? [{ value: UNCATEGORIZED_CHOICE, label: tr.settings.deleteCategoryUncategorized }] : []),
        ...replacementCandidates.map((candidate) => ({ value: candidate.id, label: candidate.name })),
      ]
    : [];

  if (!dataReady) {
    return (
      <Screen>
        {header}
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

  return (
    <Screen scrollEnabled={!dragging} width="workspace">
      {header}
      <DataStateNotice status={dataStatus} retry={retryData} />
      {deleteResolution ? (
        <Card tone="warning" testID="category-delete-resolution">
          <PanelHeader
            icon={Trash2}
            title={tr.settings.deleteCategoryReplacementTitle}
            description={tr.settings.deleteCategoryReplacementHint(deleteResolution.category.name, deleteResolution.usage.total)}
            tone="warning"
          />
          <Select
            label={tr.settings.deleteCategoryReplacementLabel}
            options={replacementOptions}
            value={deleteResolution.replacementId}
            onChange={(replacementId) => setDeleteResolution((current) => current ? { ...current, replacementId } : current)}
            placeholder={tr.settings.deleteCategoryReplacementPlaceholder}
            disabled={replacementOptions.length === 0}
            testID="category-delete-replacement"
          />
          {replacementOptions.length === 0 ? <Body muted style={{ marginTop: spacing.sm }}>{tr.settings.deleteCategoryReplacementMissing}</Body> : null}
          <Row gap={spacing.sm} style={{ marginTop: spacing.md, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <Button label={tr.common.cancel} size="sm" variant="ghost" onPress={() => setDeleteResolution(null)} />
            <Button
              label={tr.common.delete}
              size="sm"
              variant="danger"
              disabled={!deleteResolution.replacementId || replacementOptions.length === 0}
              onPress={() => {
                const current = deleteResolution;
                if (!current?.replacementId) return;
                void appConfirm(
                  tr.settings.deleteCategoryTitle,
                  tr.settings.deleteCategoryReplacementConfirm(current.category.name, current.replacementId === UNCATEGORIZED_CHOICE
                    ? tr.settings.deleteCategoryUncategorized
                    : categories.find((candidate) => candidate.id === current.replacementId)?.name ?? tr.common.none),
                  { confirmLabel: tr.common.delete, danger: true },
                ).then((ok) => ok ? deleteCategory(current.category, current.replacementId) : undefined).catch(() => {
                  void appAlert(tr.errors.saveFailed, tr.errors.title);
                });
              }}
            />
          </Row>
        </Card>
      ) : null}
      <WorkspaceSplit
        testID="categories-workspace"
        wideLayout={categories.length === 0 ? "stack" : "split"}
        primary={(
          <Card>
            <PanelHeader icon={Plus} title={tr.settings.createItemTitle} description={tr.settings.createItemHint} />
            <CategoryLedgerMap
              expenseCount={categories.filter((category) => category.kind === "expense").length}
              incomeCount={categories.filter((category) => category.kind === "income").length}
            />
            <Field label={tr.settings.addCategory} value={name} onChangeText={setName} placeholder={categoryPlaceholder} />
            <ChipPicker
              options={[
                { value: "expense", label: tr.settings.kindExpense },
                { value: "income", label: tr.settings.kindIncome },
              ]}
              value={kind}
              onChange={(value) => {
                setKind(value);
                if (value === "income") setIsInvestment(false);
              }}
            />
            {kind === "expense" ? (
              <Spread style={{ marginBottom: spacing.md }}>
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Body>{tr.settings.investmentCategory}</Body>
                  <Body muted style={{ fontSize: type.small.fontSize }}>{tr.settings.investmentCategoryDesc}</Body>
                </View>
                <Toggle label={tr.settings.investmentCategory} value={isInvestment} onValueChange={setIsInvestment} />
              </Spread>
            ) : null}
            <Button label={tr.common.add} onPress={() => void add()} disabled={!name.trim() || adding} loading={adding} />
            <Button
              icon={LayoutTemplate}
              variant="ghost"
              size="sm"
              label={tr.settings.addSuggested}
              onPress={() => router.push("/workspace-template")}
            />
          </Card>
        )}
        secondary={(
          <View>
            {categories.length === 0 ? (
              <EmptyState
                icon={Columns3}
                title={tr.settings.categoriesEmptyTitle}
                hint={tr.settings.categoriesEmptyHint}
              />
            ) : (["expense", "income"] as const).map((k) => {
              const group = categories.filter((c) => c.kind === k);
              if (group.length === 0) return null;
              return (
                <Card key={k}>
            <PanelHeader
              icon={k === "expense" ? ArrowUpRight : ArrowDownLeft}
              title={k === "expense" ? tr.settings.kindExpense : tr.settings.kindIncome}
              description={tr.settings.reorderHint}
            />
            <DraggableList
              items={group}
              keyExtractor={(c) => c.id}
              onReorder={(ids) => applyOrder(k, ids)}
              onDragStateChange={setDragging}
              disabled={editingId != null}
              renderRow={(c, handle, index) =>
                editingId === c.id ? (
                  <View>
                    <View style={{ paddingVertical: spacing.sm, gap: spacing.sm }}>
                      {/* The name is the point of this row, so it gets the
                          whole width; two full-size actions beside it left
                          about a third of a phone for what was renamed. */}
                      <Field accessibilityLabel={`${tr.common.edit} · ${c.name}`} noMargin value={editName} onChangeText={setEditName} />
                      <Row gap={spacing.sm} style={{ justifyContent: "flex-end" }}>
                        <Button label={tr.common.cancel} size="sm" variant="ghost" onPress={() => setEditingId(null)} />
                        <Button
                          label={tr.common.save}
                          size="sm"
                          variant="secondary"
                          disabled={!editName.trim()}
                          onPress={() => {
                            void update(
                              c,
                              c.kind === "expense"
                                ? { name: editName.trim(), isTransfer: editInvestment }
                                : { name: editName.trim() },
                            ).then((saved) => {
                              if (saved) setEditingId(null);
                            });
                          }}
                        />
                      </Row>
                    </View>
                    {c.kind === "expense" ? (
                      <Spread style={{ paddingBottom: spacing.sm }}>
                        <View style={{ flex: 1, paddingRight: spacing.md }}>
                          <Body style={{ fontSize: type.small.fontSize }}>{tr.settings.investmentCategory}</Body>
                          <Body muted style={{ fontSize: type.small.fontSize }}>{tr.settings.investmentCategoryDesc}</Body>
                        </View>
                        <Toggle
                          label={`${c.name} · ${tr.settings.investmentCategory}`}
                          value={editInvestment}
                          onValueChange={setEditInvestment}
                        />
                      </Spread>
                    ) : null}
                    {index < group.length - 1 ? <Divider /> : null}
                  </View>
                ) : (
                  <View
                    style={{
                      paddingVertical: spacing.sm,
                      borderBottomWidth: index < group.length - 1 ? StyleSheet.hairlineWidth : 0,
                      borderColor: palette.border,
                      backgroundColor: handle.active ? palette.surfaceAlt : palette.surface,
                    }}
                  >
                    <Spread>
                      <Row gap={spacing.sm} style={{ flex: 1, alignItems: "center", paddingRight: spacing.sm }}>
                        <ReorderGrip handle={handle} position={index + 1} count={group.length} />
                        <Body style={{ flex: 1 }}>
                          {categoryIcon(c)} {c.name}
                        </Body>
                        {c.isTransfer ? <Badge text={tr.cashflow.transfer} /> : null}
                      </Row>
                      <Row gap={spacing.sm} style={{ alignItems: "center" }}>
                        {/* Every column repeats these two controls, so the
                            accessible name has to say WHICH column it acts on
                            — "Düzenle" alone was ambiguous once per row. */}
                        <IconButton
                          icon={Pencil}
                          label={`${tr.common.edit} · ${c.name}`}
                          onPress={() => startEditing(c)}
                        />
                        <IconButton icon={Trash2} tone="danger" label={`${tr.common.delete} · ${c.name}`} haptic="none" onPress={() => void remove(c)} />
                      </Row>
                    </Spread>
                    <Spread style={{ marginTop: spacing.xs }}>
                      <Body muted style={{ fontSize: type.small.fontSize, flex: 1, paddingRight: spacing.sm }}>{tr.settings.columnVisible}</Body>
                      <Toggle label={`${c.name} · ${tr.settings.columnVisible}`} value={c.isColumn} onValueChange={(v) => void update(c, { isColumn: v })} />
                    </Spread>
                  </View>
                )
              }
            />
                </Card>
              );
            })}
          </View>
        )}
      />
    </Screen>
  );
}
