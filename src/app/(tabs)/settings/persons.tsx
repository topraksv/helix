/** Person management (§2.8): named people; non-self people are watch-only. */

import React, { useState } from "react";
import { View } from "react-native";
import { newId } from "../../../db/ids";
import { restoreRow, softDelete, writeRows } from "../../../db/mutations";
import { usePersons, useUserId } from "../../../data/hooks";
import { scheduleSync } from "../../../sync/engine";
import { tr } from "../../../i18n/tr";
import { Pencil, Trash2 } from "lucide-react-native";
import { Badge, Body, Button, Card, CardList, Field, IconButton, Row, Screen, Spread } from "../../../ui/components";
import { placeholderPools, useRotatingPlaceholder } from "../../../ui/placeholders";
import { useUndo } from "../../../ui/undo";
import { spacing } from "../../../ui/theme";

export default function PersonsScreen() {
  const userId = useUserId();
  const persons = usePersons();
  const undo = useUndo();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const rename = async (p: (typeof persons)[number], newName: string) => {
    await writeRows(userId, [{ table: "persons", row: { ...p, name: newName.trim() } }]);
    scheduleSync(userId);
    setEditingId(null);
  };

  const add = async () => {
    if (adding || !name.trim()) return;
    setAdding(true);
    try {
      await writeRows(userId, [
        { table: "persons", row: { id: newId(), name: name.trim(), isSelf: persons.length === 0, deletedAt: null } },
      ]);
      scheduleSync(userId);
      setName("");
    } finally {
      setAdding(false);
    }
  };

  const remove = async (p: (typeof persons)[number]) => {
    const snapshot = await softDelete(userId, "persons", p.id);
    scheduleSync(userId);
    if (snapshot) undo.show(`${p.name} · ${tr.common.deleted}`, () => void restoreRow(userId, "persons", snapshot), "warning");
  };

  return (
    <Screen>
      <Body muted style={{ marginBottom: spacing.md }}>{tr.onboarding.personsHint}</Body>
      <Card>
        <Row>
          <View style={{ flex: 1 }}>
            <Field noMargin value={name} onChangeText={setName} placeholder={useRotatingPlaceholder(placeholderPools.person)} />
          </View>
          <Button label={tr.common.add} onPress={() => void add()} disabled={!name.trim() || adding} loading={adding} />
        </Row>
      </Card>
      <CardList
        items={[...persons].sort((a, b) => Number(b.isSelf) - Number(a.isSelf))}
        keyExtractor={(p) => p.id}
        renderItem={(p) =>
          editingId === p.id ? (
            <Row style={{ paddingVertical: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Field noMargin value={editName} onChangeText={setEditName} autoFocus />
              </View>
              <Button label={tr.common.save} variant="secondary" disabled={!editName.trim()} onPress={() => void rename(p, editName)} />
              <Button label={tr.common.cancel} variant="ghost" onPress={() => setEditingId(null)} />
            </Row>
          ) : (
            <Spread style={{ paddingVertical: spacing.sm }}>
              <Row gap={spacing.sm} style={{ flex: 1, paddingRight: spacing.sm }}>
                <Body style={{ flexShrink: 1 }}>{p.name}</Body>
                {p.isSelf ? <Badge text={tr.persons.selfBadge} tone="primary" /> : <Badge text={tr.installments.watchOnly} />}
              </Row>
              <Row gap={spacing.sm}>
                <IconButton icon={Pencil} size={32} label={tr.common.edit} onPress={() => { setEditingId(p.id); setEditName(p.name); }} />
                {!p.isSelf ? <IconButton icon={Trash2} size={32} tone="danger" label={tr.common.delete} haptic="none" onPress={() => void remove(p)} /> : null}
              </Row>
            </Spread>
          )
        }
      />
    </Screen>
  );
}
