/** Category & column management — the personalization core: names, kinds,
 *  column visibility all belong to the user (nothing is hardcoded). */

import React, { useState } from "react";
import { Switch, View } from "react-native";
import { useRouter } from "expo-router";
import { newId } from "../../../db/ids";
import { restoreRow, softDelete, writeRows } from "../../../db/mutations";
import { useCategories, useUserId } from "../../../data/hooks";
import { categoryIcon, suggestCategoryIcon } from "../../../data/category-icons";
import { scheduleSync } from "../../../sync/engine";
import { tr } from "../../../i18n/tr";
import { ChevronDown, ChevronUp, LayoutTemplate, Pencil, Trash2 } from "lucide-react-native";
import { Body, Button, Card, CardList, Field, Heading, IconButton, Row, Screen, Segmented, Spread } from "../../../ui/components";
import { placeholderPools, useRotatingPlaceholder } from "../../../ui/placeholders";
import { useUndo } from "../../../ui/undo";
import { spacing } from "../../../ui/theme";

export default function CategoriesScreen() {
  const userId = useUserId();
  const router = useRouter();
  const categories = useCategories();
  const undo = useUndo();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const add = async () => {
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
  };

  const update = async (c: (typeof categories)[number], patch: Partial<(typeof categories)[number]>) => {
    await writeRows(userId, [{ table: "categories", row: { ...c, ...patch } }]);
    scheduleSync(userId);
  };

  // Reorder a category within its kind group (which is what the Mali Tablo
  // matrix renders as its column/row order). `sortOrder` is a synced column, so
  // the new order propagates to every device — consistent with how the rest of
  // the workspace syncs (there is no device-local ordering pref here). We
  // reassign the group's items onto their own existing sortOrder slots in the
  // new order, so the other kind's rows keep their positions untouched.
  const move = async (c: (typeof categories)[number], dir: -1 | 1) => {
    const group = categories.filter((x) => x.kind === c.kind); // already sortOrder-sorted
    const idx = group.findIndex((x) => x.id === c.id);
    const j = idx + dir;
    if (j < 0 || j >= group.length) return;
    const slots = group.map((x) => x.sortOrder);
    const reordered = [...group];
    [reordered[idx], reordered[j]] = [reordered[j], reordered[idx]];
    await writeRows(
      userId,
      reordered.map((cat, k) => ({ table: "categories", row: { ...cat, sortOrder: slots[k] } })),
    );
    scheduleSync(userId);
  };

  const remove = async (c: (typeof categories)[number]) => {
    const snapshot = await softDelete(userId, "categories", c.id);
    scheduleSync(userId);
    if (snapshot) undo.show(`${c.name} · ${tr.common.deleted}`, () => void restoreRow(userId, "categories", snapshot));
  };

  return (
    <Screen>
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
        <Button label={tr.common.add} onPress={() => void add()} disabled={!name.trim()} />
        <Button
          icon={LayoutTemplate}
          variant="ghost"
          size="sm"
          label={tr.settings.addSuggested}
          onPress={() => router.push("/workspace-template")}
        />
      </Card>

      {(["expense", "income"] as const).map((k) => (
        <CardList
          key={k}
          items={categories.filter((c) => c.kind === k)}
          keyExtractor={(c) => c.id}
          header={<Heading style={{ marginTop: 0 }}>{k === "expense" ? tr.settings.kindExpense : tr.settings.kindIncome}</Heading>}
          renderItem={(c) =>
            editingId === c.id ? (
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
            ) : (
              <View style={{ paddingVertical: spacing.sm }}>
                <Spread>
                  <Body style={{ flex: 1, paddingRight: spacing.sm }}>
                    {categoryIcon(c)} {c.name}
                  </Body>
                  <Row gap={spacing.xs} style={{ alignItems: "center" }}>
                    {(() => {
                      const group = categories.filter((x) => x.kind === c.kind);
                      const gi = group.findIndex((x) => x.id === c.id);
                      return (
                        <>
                          <IconButton icon={ChevronUp} size={32} label={tr.common.moveUp} disabled={gi <= 0} onPress={() => void move(c, -1)} />
                          <IconButton icon={ChevronDown} size={32} label={tr.common.moveDown} disabled={gi >= group.length - 1} onPress={() => void move(c, 1)} />
                        </>
                      );
                    })()}
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
                  <Switch value={c.isColumn} onValueChange={(v) => void update(c, { isColumn: v })} />
                </Spread>
              </View>
            )
          }
        />
      ))}
    </Screen>
  );
}
