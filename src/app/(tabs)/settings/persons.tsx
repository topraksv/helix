/** Person management (§2.8): named people; non-self people are watch-only. */

import React, { useState } from "react";
import { View } from "react-native";
import { newId } from "../../../db/ids";
import { restoreRow, softDelete, writeRows } from "../../../db/mutations";
import { usePersons, useUserId } from "../../../data/hooks";
import { scheduleSync } from "../../../sync/engine";
import { tr } from "../../../i18n/tr";
import { Trash2 } from "lucide-react-native";
import { Badge, Body, Button, Card, CardList, Field, IconButton, Row, Screen, Spread } from "../../../ui/components";
import { placeholderPools, useRotatingPlaceholder } from "../../../ui/placeholders";
import { useUndo } from "../../../ui/undo";
import { spacing } from "../../../ui/theme";

export default function PersonsScreen() {
  const userId = useUserId();
  const persons = usePersons();
  const undo = useUndo();
  const [name, setName] = useState("");

  const add = async () => {
    await writeRows(userId, [
      { table: "persons", row: { id: newId(), name: name.trim(), isSelf: persons.length === 0, deletedAt: null } },
    ]);
    scheduleSync(userId);
    setName("");
  };

  const remove = async (p: (typeof persons)[number]) => {
    const snapshot = await softDelete(userId, "persons", p.id);
    scheduleSync(userId);
    if (snapshot) undo.show(`${p.name} — ${tr.common.deleted}`, () => void restoreRow(userId, "persons", snapshot));
  };

  return (
    <Screen>
      <Body muted style={{ marginBottom: spacing.md }}>{tr.onboarding.personsHint}</Body>
      <Card>
        <Row>
          <View style={{ flex: 1 }}>
            <Field value={name} onChangeText={setName} placeholder={useRotatingPlaceholder(placeholderPools.person)} />
          </View>
          <Button label={tr.common.add} onPress={() => void add()} disabled={!name.trim()} />
        </Row>
      </Card>
      <CardList
        items={[...persons].sort((a, b) => Number(b.isSelf) - Number(a.isSelf))}
        keyExtractor={(p) => p.id}
        renderItem={(p) => (
          <Spread style={{ paddingVertical: spacing.sm }}>
            <Row gap={spacing.sm}>
              <Body>{p.name}</Body>
              {p.isSelf ? <Badge text={tr.persons.selfBadge} tone="primary" /> : <Badge text={tr.installments.watchOnly} />}
            </Row>
            {!p.isSelf ? <IconButton icon={Trash2} size={32} tone="danger" label={tr.common.delete} onPress={() => void remove(p)} /> : null}
          </Spread>
        )}
      />
    </Screen>
  );
}
