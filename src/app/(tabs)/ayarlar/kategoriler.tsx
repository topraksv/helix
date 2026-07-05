/** Category & column management — the personalization core: names, kinds,
 *  column visibility all belong to the user (nothing is hardcoded). */

import React, { useState } from "react";
import { Switch, View } from "react-native";
import { newId } from "../../../db/ids";
import { restoreRow, softDelete, writeRows } from "../../../db/mutations";
import { useCategories, useUserId } from "../../../data/hooks";
import { scheduleSync } from "../../../sync/engine";
import { tr } from "../../../i18n/tr";
import { Body, Button, Card, Divider, Field, Heading, Row, Screen, Segmented, Spread } from "../../../ui/components";
import { useUndo } from "../../../ui/undo";
import { spacing } from "../../../ui/theme";

export default function CategoriesScreen() {
  const userId = useUserId();
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
          icon: null,
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

  const remove = async (c: (typeof categories)[number]) => {
    const snapshot = await softDelete(userId, "categories", c.id);
    scheduleSync(userId);
    if (snapshot) undo.show(`${c.name} — ${tr.common.deleted}`, () => void restoreRow(userId, "categories", snapshot));
  };

  return (
    <Screen>
      <Body muted style={{ marginBottom: spacing.md }}>{tr.settings.categoriesDesc}</Body>
      <Card>
        <Field label={tr.settings.addCategory} value={name} onChangeText={setName} placeholder="Ör. Market, Akaryakıt…" />
        <Segmented
          options={[
            { value: "expense", label: tr.settings.kindExpense },
            { value: "income", label: tr.settings.kindIncome },
          ]}
          value={kind}
          onChange={setKind}
        />
        <Button label={tr.common.add} onPress={() => void add()} disabled={!name.trim()} />
      </Card>

      {(["expense", "income"] as const).map((k) => {
        const list = categories.filter((c) => c.kind === k);
        if (list.length === 0) return null;
        return (
          <Card key={k}>
            <Heading style={{ marginTop: 0 }}>{k === "expense" ? tr.settings.kindExpense : tr.settings.kindIncome}</Heading>
            {list.map((c) => (
              <View key={c.id}>
                {editingId === c.id ? (
                  <Row style={{ paddingVertical: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Field value={editName} onChangeText={setEditName} />
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
                  <Spread style={{ paddingVertical: spacing.sm }}>
                    <Body>
                      {c.icon ? `${c.icon} ` : ""}
                      {c.name}
                    </Body>
                    <Row gap={spacing.sm}>
                      <Body muted>{tr.settings.columnVisible}</Body>
                      <Switch value={c.isColumn} onValueChange={(v) => void update(c, { isColumn: v })} />
                      <Button
                        label={tr.common.edit}
                        variant="ghost"
                        onPress={() => {
                          setEditingId(c.id);
                          setEditName(c.name);
                        }}
                      />
                      <Button label={tr.common.delete} variant="ghost" onPress={() => void remove(c)} />
                    </Row>
                  </Spread>
                )}
                <Divider />
              </View>
            ))}
          </Card>
        );
      })}
    </Screen>
  );
}
