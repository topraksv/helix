/** Payment source management: cards / cash / bank, per-person, due day. */

import React, { useState } from "react";
import { View } from "react-native";
import { newId } from "../../../db/ids";
import { restoreRow, softDelete, writeRows } from "../../../db/mutations";
import { usePersons, useSources, useUserId } from "../../../data/hooks";
import { PAYMENT_SOURCE_TYPES, type PaymentSourceType } from "../../../domain/types";
import { scheduleSync } from "../../../sync/engine";
import { tr } from "../../../i18n/tr";
import { Trash2 } from "lucide-react-native";
import { Body, Button, Card, ChipPicker, Divider, Field, IconButton, InitialsBadge, Row, Screen, Spread } from "../../../ui/components";
import { placeholderPools, useRotatingPlaceholder } from "../../../ui/placeholders";
import { useUndo } from "../../../ui/undo";
import { spacing } from "../../../ui/theme";

const TYPES = PAYMENT_SOURCE_TYPES.map((value) => ({ value, label: tr.sources[value] }));

export default function SourcesScreen() {
  const userId = useUserId();
  const sources = useSources();
  const persons = usePersons();
  const undo = useUndo();
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<PaymentSourceType>("credit_card");
  // persons load async (live query) — derive the default owner.
  const [personChoice, setPersonChoice] = useState<string | null>(null);
  const personId = personChoice ?? persons.find((p) => p.isSelf)?.id ?? persons[0]?.id ?? null;
  const [dueDayStr, setDueDayStr] = useState("");

  const dueDay = dueDayStr.trim() === "" ? null : Number(dueDayStr);
  const dueDayValid = dueDay === null || (Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31);

  const add = async () => {
    if (!personId) return;
    await writeRows(userId, [
      {
        table: "payment_sources",
        row: {
          id: newId(),
          name: name.trim(),
          type: sourceType,
          personId,
          dueDay,
          statementDay: null,
          color: null,
          logoSource: "initials",
          logoRef: null,
          isActive: true,
          deletedAt: null,
        },
      },
    ]);
    scheduleSync(userId);
    setName("");
    setDueDayStr("");
  };

  const remove = async (s: (typeof sources)[number]) => {
    const snapshot = await softDelete(userId, "payment_sources", s.id);
    scheduleSync(userId);
    if (snapshot) undo.show(`${s.name} — ${tr.common.deleted}`, () => void restoreRow(userId, "payment_sources", snapshot));
  };

  return (
    <Screen>
      <Card>
        <Field label={tr.onboarding.addSource} value={name} onChangeText={setName} placeholder={useRotatingPlaceholder(placeholderPools.source)} />
        <ChipPicker options={TYPES.map((t) => ({ value: t.value, label: t.label }))} value={sourceType} onChange={setSourceType} />
        {persons.length > 1 ? (
          <ChipPicker options={persons.map((p) => ({ value: p.id, label: p.name }))} value={personId} onChange={setPersonChoice} />
        ) : null}
        {sourceType === "credit_card" ? (
          <Field label={tr.sources.dueDay} placeholder={tr.common.optionalHint} value={dueDayStr} onChangeText={setDueDayStr} keyboardType="number-pad" />
        ) : null}
        <Button label={tr.common.add} onPress={() => void add()} disabled={!name.trim() || !personId || !dueDayValid} />
      </Card>

      <Card>
        {sources.map((s) => (
          <View key={s.id}>
            <Spread style={{ paddingVertical: spacing.sm }}>
              <Row style={{ flex: 1 }}>
                <InitialsBadge name={s.name} size={32} />
                <View style={{ flex: 1 }}>
                  <Body>{s.name}</Body>
                  <Body muted>
                    {TYPES.find((t) => t.value === s.type)?.label}
                    {s.dueDay ? ` · ${tr.sources.dueDay}: ${s.dueDay}` : ""}
                    {persons.length > 1 ? ` · ${persons.find((p) => p.id === s.personId)?.name ?? ""}` : ""}
                  </Body>
                </View>
              </Row>
              <IconButton icon={Trash2} size={32} tone="danger" label={tr.common.delete} onPress={() => void remove(s)} />
            </Spread>
            <Divider />
          </View>
        ))}
      </Card>
    </Screen>
  );
}
