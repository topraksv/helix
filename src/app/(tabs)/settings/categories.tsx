/** Category & column management — the personalization core: names, kinds,
 *  column visibility all belong to the user (nothing is hardcoded). */

import React, { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useCategoriesState, useUserId } from "../../../data/hooks";
import { combineLiveQueryStatus } from "../../../data/live-state";
import { countTransactionsForCategory, createCategory, deleteCategoryWithBudgets, reorderCategoryGroup, restoreCategoryWithBudgets, updateCategory } from "../../../data/repo";
import { categoryIcon } from "../../../data/category-icons";
import { scheduleSync } from "../../../sync/engine";
import { appAlert, appConfirm } from "../../../ui/dialog";
import { tr } from "../../../i18n/tr";
import { LayoutTemplate, Pencil, Trash2 } from "lucide-react-native";
import { Body, Button, Card, DataStateNotice, Divider, Field, Heading, IconButton, Row, Screen, Segmented, Spread, Toggle } from "../../../ui/components";
import { DraggableList, ReorderGrip } from "../../../ui/draggable-list";
import { placeholderPools, useRotatingPlaceholder } from "../../../ui/placeholders";
import { useUndo } from "../../../ui/undo";
import { spacing, useTheme } from "../../../ui/theme";
import { useOperationGuard } from "../../../ui/operation-guard";
import { useDirtyExitGuard } from "../../../ui/dirty-exit";

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
  const [isTransfer, setIsTransfer] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  // Freeze the screen's scroll while a row is being dragged, so the vertical
  // drag reorders instead of scrolling the page.
  const [dragging, setDragging] = useState(false);
  const editingCategory = editingId ? categories.find((category) => category.id === editingId) : null;
  useDirtyExitGuard(
    name.trim() !== "" || Boolean(editingCategory && editName.trim() !== editingCategory.name),
  );
  const categoryPlaceholder = useRotatingPlaceholder(placeholderPools.category);
  const dataStatus = combineLiveQueryStatus([categoriesState]);
  const dataReady = categoriesState.updatedAt != null;

  const add = async () => {
    if (!name.trim()) return;
    await operationGuard.run(async () => {
      setAdding(true);
      try {
        await createCategory(userId, { name, kind, isTransfer, sortOrder: categories.length });
        scheduleSync(userId);
        setName("");
        setIsTransfer(false);
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

  const remove = async (c: (typeof categories)[number]) => {
    try {
      // A category with records is never a one-tap delete: warn with the count so
      // the user knows the rows survive (as "uncategorized") rather than vanishing.
      const usage = await countTransactionsForCategory(userId, c.id);
      if (usage > 0) {
        const ok = await appConfirm(tr.settings.deleteCategoryTitle, tr.settings.deleteCategoryBody(usage), {
          confirmLabel: tr.common.delete,
          danger: true,
        });
        if (!ok) return;
      }
      // The category's monthly budgets go with it in the same atomic write, so
      // no orphan budget row can linger in lists or totals; undo restores both.
      const snapshot = await deleteCategoryWithBudgets(userId, c.id);
      scheduleSync(userId);
      if (snapshot) {
        undo.show(`${c.name} · ${tr.common.deleted}`, () => {
          return restoreCategoryWithBudgets(userId, snapshot).then(() => scheduleSync(userId));
        }, "warning");
      }
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    }
  };

  if (!dataReady) {
    return (
      <Screen>
        {header}
        <DataStateNotice status={dataStatus} retry={categoriesState.retry} />
      </Screen>
    );
  }

  return (
    <Screen scrollEnabled={!dragging}>
      {header}
      <DataStateNotice status={dataStatus} retry={categoriesState.retry} />
      <Body muted style={{ marginBottom: spacing.md }}>{tr.settings.categoriesDesc}</Body>
      <Card>
        <Field label={tr.settings.addCategory} value={name} onChangeText={setName} placeholder={categoryPlaceholder} />
        <Segmented
          options={[
            { value: "expense", label: tr.settings.kindExpense },
            { value: "income", label: tr.settings.kindIncome },
          ]}
          value={kind}
          onChange={(value) => {
            setKind(value);
            if (value === "income") setIsTransfer(false);
          }}
        />
        {kind === "expense" ? (
          <Spread style={{ marginBottom: spacing.md }}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Body>{tr.settings.transferCategory}</Body>
              <Body muted style={{ fontSize: 12 }}>{tr.settings.transferCategoryDesc}</Body>
            </View>
            <Toggle label={tr.settings.transferCategory} value={isTransfer} onValueChange={setIsTransfer} />
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

      {(["expense", "income"] as const).map((k) => {
        const group = categories.filter((c) => c.kind === k);
        if (group.length === 0) return null;
        return (
          <Card key={k}>
            <Heading style={{ marginTop: 0 }}>{k === "expense" ? tr.settings.kindExpense : tr.settings.kindIncome}</Heading>
            <Body muted style={{ fontSize: 12, marginBottom: spacing.xs }}>{tr.settings.reorderHint}</Body>
            <DraggableList
              items={group}
              keyExtractor={(c) => c.id}
              onReorder={(ids) => applyOrder(k, ids)}
              onDragStateChange={setDragging}
              disabled={editingId != null}
              renderRow={(c, handle, index) =>
                editingId === c.id ? (
                  <View>
                    <Row style={{ paddingVertical: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <Field accessibilityLabel={`${tr.common.edit} · ${c.name}`} noMargin value={editName} onChangeText={setEditName} autoFocus />
                      </View>
                      <Button
                        label={tr.common.save}
                        variant="secondary"
                        disabled={!editName.trim()}
                        onPress={() => {
                          void update(c, { name: editName.trim() }).then((saved) => {
                            if (saved) setEditingId(null);
                          });
                        }}
                      />
                      <Button label={tr.common.cancel} variant="ghost" onPress={() => setEditingId(null)} />
                    </Row>
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
                      </Row>
                      <Row gap={spacing.sm} style={{ alignItems: "center" }}>
                        <IconButton
                          icon={Pencil}
                          size={32}
                          label={tr.common.edit}
                          onPress={() => {
                            setEditingId(c.id);
                            setEditName(c.name);
                          }}
                        />
                        <IconButton icon={Trash2} size={32} tone="danger" label={tr.common.delete} haptic="none" onPress={() => void remove(c)} />
                      </Row>
                    </Spread>
                    <Spread style={{ marginTop: spacing.xs }}>
                      <Body muted style={{ fontSize: 12, flex: 1, paddingRight: spacing.sm }}>{tr.settings.columnVisible}</Body>
                      <Toggle label={`${c.name} · ${tr.settings.columnVisible}`} value={c.isColumn} onValueChange={(v) => void update(c, { isColumn: v })} />
                    </Spread>
                    {c.kind === "expense" ? (
                      <Spread style={{ marginTop: spacing.xs }}>
                        <Body muted style={{ fontSize: 12, flex: 1, paddingRight: spacing.sm }}>{tr.settings.transferCategory}</Body>
                        <Toggle
                          label={`${c.name} · ${tr.settings.transferCategory}`}
                          value={c.isTransfer}
                          onValueChange={(value) => void update(c, { isTransfer: value })}
                        />
                      </Spread>
                    ) : null}
                  </View>
                )
              }
            />
          </Card>
        );
      })}
    </Screen>
  );
}
