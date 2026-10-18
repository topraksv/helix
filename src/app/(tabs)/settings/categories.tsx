/** Category & column management — the personalization core: names, kinds,
 *  column visibility all belong to the user (nothing is hardcoded). */

import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useBalanceColumns, useCategoriesState, useUserId } from "../../../data/hooks";
import { combineLiveStates } from "../../../data/live-state";
import { categoryReferenceUsage, createCategory, deleteCategoryWithBudgets, reorderCategoryGroup, restoreCategoryWithBudgets, setBalanceColumns, updateCategory, type CategoryReferenceUsage } from "../../../data/repo";
import { CategoryIcon } from "../../../ui/category-icon";
import { scheduleSync } from "../../../sync/engine";
import { appAlert, appConfirm } from "../../../ui/dialog";
import { tr } from "../../../i18n/tr";
import ArrowDownLeft from "lucide-react-native/icons/arrow-down-left";
import ArrowUpRight from "lucide-react-native/icons/arrow-up-right";
import Columns3 from "lucide-react-native/icons/columns-3";
import Scale from "lucide-react-native/icons/scale";
import LayoutTemplate from "lucide-react-native/icons/layout-template";
import Pencil from "lucide-react-native/icons/pencil";
import Plus from "lucide-react-native/icons/plus";
import Trash from "lucide-react-native/icons/trash";
import { Badge, Body, Button, Card, ChipPicker, CardListSkeleton, DataGateScreen, DataStateNotice, Divider, EmptyState, FadeIn, Field, IconButton, InlineEditRow, PanelHeader, Row, Screen, Spread, Toggle, ToggleRow } from "../../../ui/components";
import { CategoryDeleteSheet, UNCATEGORIZED_CHOICE } from "../../../ui/category-delete-sheet";
import { DraggableList, ReorderGrip } from "../../../ui/draggable-list";
import { useRotatingPlaceholder } from "../../../ui/placeholders";
import { useUndo } from "../../../ui/undo";
import { iconSize, radius, spacing, type, useTheme } from "../../../ui/theme";
import { useOperationGuard } from "../../../ui/operation-guard";
import { useDirtyExitGuard } from "../../../ui/dirty-exit";
import { WorkspaceSplit } from "../../../ui/workspace-layout";
import { MAX_BALANCE_COLUMN_LABEL } from "../../../domain/matrix-preferences";

/** The two balance columns, named by the owner; neither categories nor computed columns. */
function BalanceColumnsCard() {
  const userId = useUserId();
  const { palette } = useTheme();
  const current = useBalanceColumns();
  const [editing, setEditing] = useState<"opening" | "closing" | null>(null);
  const [draft, setDraft] = useState("");

  /** A name equal to the default stores null, so a later rename of the default still reaches this account. */
  const stored = (value: string, fallback: string) => {
    const trimmed = value.trim();
    return trimmed === "" || trimmed === fallback ? null : trimmed;
  };

  const write = (next: { openingLabel: string | null; closingLabel: string | null; showOpening: boolean }) => {
    void setBalanceColumns(userId, next)
      .then(() => {
        setEditing(null);
        scheduleSync(userId);
      })
      .catch(() => void appAlert(tr.errors.saveFailed, tr.errors.title));
  };

  const saved = (which: "opening" | "closing") => ({
    openingLabel: which === "opening"
      ? stored(draft, tr.cashflow.opening)
      : stored(current.openingLabel, tr.cashflow.opening),
    closingLabel: which === "closing"
      ? stored(draft, tr.cashflow.closing)
      : stored(current.closingLabel, tr.cashflow.closing),
    showOpening: current.showOpening,
  });

  const row = (which: "opening" | "closing", name: string, fieldLabel: string, fallback: string, below?: ReactNode) => (
    <View style={{ paddingVertical: spacing.sm }}>
      {editing === which ? (
        <InlineEditRow
          field={(
            <Field
              label={fieldLabel}
              noMargin
              autoFocus
              value={draft}
              maxLength={MAX_BALANCE_COLUMN_LABEL}
              placeholder={tr.settings.balanceColumnsPlaceholder(fallback)}
              onChangeText={setDraft}
            />
          )}
          onCancel={() => setEditing(null)}
          onSave={() => write(saved(which))}
        />
      ) : (
        <>
          <Spread>
            <Body style={{ flex: 1, paddingRight: spacing.sm }}>{name}</Body>
            <IconButton
              icon={Pencil}
              label={`${tr.common.edit} · ${name}`}
              onPress={() => {
                setDraft(name);
                setEditing(which);
              }}
            />
          </Spread>
          {below}
        </>
      )}
    </View>
  );

  return (
    <Card testID="balance-columns-card">
      <PanelHeader icon={Scale} title={tr.settings.balanceColumnsTitle} description={tr.settings.balanceColumnsHint} />
      {row("closing", current.closingLabel, tr.settings.balanceClosingLabel, tr.cashflow.closing)}
      <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.border }} />
      {/* The visibility switch belongs to the opening row only; the closing balance is always shown. */}
      {row("opening", current.openingLabel, tr.settings.balanceOpeningLabel, tr.cashflow.opening, (
        <ToggleRow
          name={current.openingLabel}
          text={tr.settings.columnVisible}
          value={current.showOpening}
          onValueChange={(showOpening) => write({
            openingLabel: stored(current.openingLabel, tr.cashflow.opening),
            closingLabel: stored(current.closingLabel, tr.cashflow.closing),
            showOpening,
          })}
        />
      ))}
    </Card>
  );
}

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
  const [attempted, setAttempted] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  // Persisted as `isTransfer`; the product calls it investment (see ARCHITECTURE.md).
  const [editInvestment, setEditInvestment] = useState(false);
  const [deleteResolution, setDeleteResolution] = useState<{
    category: CategoryItem;
    usage: CategoryReferenceUsage;
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
  const categoryPlaceholder = useRotatingPlaceholder(tr.placeholders.category);
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([categoriesState]);

  const add = async () => {
    if (!name.trim()) return setAttempted(true);
    await operationGuard.run(async () => {
      setAdding(true);
      try {
        await createCategory(userId, { name, kind, isTransfer: isInvestment, sortOrder: categories.length });
        scheduleSync(userId);
        setName("");
        setAttempted(false);
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

  // Reuses the group's own sortOrder slots, so the other kind keeps its positions. sortOrder syncs.
  const applyOrder = async (kind: "expense" | "income", orderedIds: string[]) => {
    await reorderCategoryGroup(userId, categories, kind, orderedIds);
    scheduleSync(userId);
  };

  const deleteCategory = async (c: CategoryItem, replacementChoice?: string | null) => {
    const replacementId = replacementChoice === UNCATEGORIZED_CHOICE ? null : replacementChoice;
    const snapshot = await deleteCategoryWithBudgets(userId, c.id, replacementId);
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
        setDeleteResolution({ category: c, usage });
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

  if (!dataReady) {
    return (
      <DataGateScreen status={dataStatus} retry={retryData} skeleton={<CardListSkeleton />}>
        {header}
      </DataGateScreen>
    );
  }

  return (
    <Screen scrollEnabled={!dragging} width="workspace">
      {header}
      <DataStateNotice status={dataStatus} retry={retryData} />
      {deleteResolution ? (
        <CategoryDeleteSheet
          categoryName={deleteResolution.category.name}
          usage={deleteResolution.usage}
          candidates={replacementCandidates.map((candidate) => ({ id: candidate.id, name: candidate.name }))}
          onCancel={() => setDeleteResolution(null)}
          onConfirm={async (choice) => {
            try {
              await deleteCategory(deleteResolution.category, choice);
            } catch {
              setDeleteResolution(null);
              void appAlert(tr.errors.saveFailed, tr.errors.title);
            }
          }}
        />
      ) : null}
      <WorkspaceSplit
        testID="categories-workspace"
        wideLayout={categories.length === 0 ? "stack" : "split"}
        primary={(
          <View>
          <Card>
            <PanelHeader icon={Plus} title={tr.settings.createItemTitle} description={tr.settings.createItemHint} />
            <CategoryLedgerMap
              expenseCount={categories.filter((category) => category.kind === "expense").length}
              incomeCount={categories.filter((category) => category.kind === "income").length}
            />
            <Field label={tr.settings.addCategory} value={name} onChangeText={setName} placeholder={categoryPlaceholder} error={attempted && !name.trim() ? tr.required.name : null} />
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
            <Button label={tr.common.add} onPress={() => void add()} disabled={adding} loading={adding} />
            <Button
              icon={LayoutTemplate}
              variant="ghost"
              size="sm"
              label={tr.settings.addSuggested}
              onPress={() => router.push("/workspace-template")}
            />
          </Card>
          {/* Under the maker: two more columns of the same table, not a page footer. */}
          <BalanceColumnsCard />
          </View>
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
                    {/* The name gets the row's full width while it is edited. */}
                    <InlineEditRow
                      style={{ paddingVertical: spacing.sm }}
                      field={<Field accessibilityLabel={`${tr.common.edit} · ${c.name}`} noMargin value={editName} onChangeText={setEditName} />}
                      onCancel={() => setEditingId(null)}
                      saveDisabled={!editName.trim()}
                      onSave={() => {
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
                    {index < group.length - 1 ? <Divider flush /> : null}
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
                        <CategoryIcon category={c} size={iconSize.control} />
                        <Body style={{ flex: 1 }}>{c.name}</Body>
                        {c.isTransfer ? <Badge testID="category-transfer-marker" text={tr.cashflow.transfer} /> : null}
                      </Row>
                      <Row gap={spacing.sm} style={{ alignItems: "center" }}>
                        <IconButton
                          icon={Pencil}
                          label={`${tr.common.edit} · ${c.name}`}
                          onPress={() => startEditing(c)}
                        />
                        <IconButton icon={Trash} tone="danger" label={`${tr.common.delete} · ${c.name}`} haptic="none" onPress={() => void remove(c)} />
                      </Row>
                    </Spread>
                    <ToggleRow name={c.name} text={tr.settings.columnVisible} value={c.isColumn} onValueChange={(v) => void update(c, { isColumn: v })} />
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
