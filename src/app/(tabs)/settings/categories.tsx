/** Category & column management — the personalization core: names, kinds,
 *  column visibility all belong to the user (nothing is hardcoded). */

import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { newId } from "../../../db/ids";
import { restoreRow, softDelete, writeRows } from "../../../db/mutations";
import { useCategories, useUserId } from "../../../data/hooks";
import { countTransactionsForCategory } from "../../../data/repo";
import { categoryIcon, suggestCategoryIcon } from "../../../data/category-icons";
import { scheduleSync } from "../../../sync/engine";
import { appConfirm } from "../../../ui/dialog";
import { tr } from "../../../i18n/tr";
import { GripVertical, LayoutTemplate, Pencil, Trash2 } from "lucide-react-native";
import { Body, Button, Card, Divider, Field, Heading, IconButton, Row, Screen, Segmented, Spread, Toggle } from "../../../ui/components";
import { DraggableList } from "../../../ui/draggable-list";
import { placeholderPools, useRotatingPlaceholder } from "../../../ui/placeholders";
import { useUndo } from "../../../ui/undo";
import { spacing, useTheme } from "../../../ui/theme";

export default function CategoriesScreen() {
  const userId = useUserId();
  const router = useRouter();
  const categories = useCategories();
  const undo = useUndo();
  const { palette } = useTheme();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  // Freeze the screen's scroll while a row is being dragged, so the vertical
  // drag reorders instead of scrolling the page.
  const [dragging, setDragging] = useState(false);

  const add = async () => {
    if (adding || !name.trim()) return;
    setAdding(true);
    try {
      await writeRows(userId, [
        {
          table: "categories",
          row: {
            id: newId(),
            name: name.trim(),
            kind,
            icon: suggestCategoryIcon(name.trim(), kind),
            color: null,
            sortOrder: categories.length,
            isColumn: true,
            deletedAt: null,
          },
        },
      ]);
      scheduleSync(userId);
      setName("");
    } finally {
      setAdding(false);
    }
  };

  const update = async (c: (typeof categories)[number], patch: Partial<(typeof categories)[number]>) => {
    await writeRows(userId, [{ table: "categories", row: { ...c, ...patch } }]);
    scheduleSync(userId);
  };

  // Commit a drag reorder within a kind group (which is what the Mali Tablo
  // matrix renders as its column/row order). `sortOrder` is a synced column, so
  // the new order propagates to every device — consistent with how the rest of
  // the workspace syncs (there is no device-local ordering pref here). We
  // reassign the group's own existing sortOrder slots onto the new order, so
  // the other kind's rows keep their positions untouched.
  const applyOrder = async (kind: "expense" | "income", orderedIds: string[]) => {
    const group = categories.filter((x) => x.kind === kind); // sortOrder-sorted
    const slots = group.map((x) => x.sortOrder);
    const byId = new Map(group.map((c) => [c.id, c]));
    const writes = orderedIds.flatMap((id, k) => {
      const c = byId.get(id);
      return c ? [{ table: "categories" as const, row: { ...c, sortOrder: slots[k] } }] : [];
    });
    if (writes.length === 0) return;
    await writeRows(userId, writes);
    scheduleSync(userId);
  };

  const remove = async (c: (typeof categories)[number]) => {
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
    const snapshot = await softDelete(userId, "categories", c.id);
    scheduleSync(userId);
    if (snapshot) undo.show(`${c.name} · ${tr.common.deleted}`, () => void restoreRow(userId, "categories", snapshot));
  };

  return (
    <Screen scrollEnabled={!dragging}>
      <Body muted style={{ marginBottom: spacing.md }}>{tr.settings.categoriesDesc}</Body>
      <Card>
        <Field label={tr.settings.addCategory} value={name} onChangeText={setName} placeholder={useRotatingPlaceholder(placeholderPools.category)} />
        <Segmented
          options={[
            { value: "expense", label: tr.settings.kindExpense },
            { value: "income", label: tr.settings.kindIncome },
          ]}
          value={kind}
          onChange={setKind}
        />
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
              onReorder={(ids) => void applyOrder(k, ids)}
              onDragStateChange={setDragging}
              disabled={editingId != null}
              renderRow={(c, handle) =>
                editingId === c.id ? (
                  <View>
                    <Row style={{ paddingVertical: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <Field noMargin value={editName} onChangeText={setEditName} autoFocus />
                      </View>
                      <Button
                        label={tr.common.save}
                        variant="secondary"
                        disabled={!editName.trim()}
                        onPress={() => {
                          void update(c, { name: editName.trim() });
                          setEditingId(null);
                        }}
                      />
                      <Button label={tr.common.cancel} variant="ghost" onPress={() => setEditingId(null)} />
                    </Row>
                    <Divider />
                  </View>
                ) : (
                  <View
                    style={{
                      paddingVertical: spacing.sm,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderColor: palette.border,
                      backgroundColor: handle.active ? palette.surfaceAlt : palette.surface,
                    }}
                  >
                    <Spread>
                      <Row gap={spacing.sm} style={{ flex: 1, alignItems: "center", paddingRight: spacing.sm }}>
                        <View
                          {...handle.panHandlers}
                          accessibilityRole="adjustable"
                          accessibilityLabel={tr.settings.reorderHandle}
                          style={{ padding: 4, marginLeft: -4 }}
                        >
                          <GripVertical size={18} color={palette.textMuted} />
                        </View>
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
                        <IconButton icon={Trash2} size={32} tone="danger" label={tr.common.delete} onPress={() => void remove(c)} />
                      </Row>
                    </Spread>
                    <Spread style={{ marginTop: spacing.xs }}>
                      <Body muted style={{ fontSize: 12 }}>{tr.settings.columnVisible}</Body>
                      <Toggle value={c.isColumn} onValueChange={(v) => void update(c, { isColumn: v })} />
                    </Spread>
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
