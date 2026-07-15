/** Payment source management: cards / cash / bank, per-person, due day. */

import React, { useState } from "react";
import { View } from "react-native";
import { newId } from "../../../db/ids";
import { restoreRow, writeRows } from "../../../db/mutations";
import { usePersons, useSources, useUserId } from "../../../data/hooks";
import {
  deleteUnreferencedPaymentSource,
  paymentSourceReferenceUsage,
  reassignAndDeletePaymentSource,
  ReferencedRecordError,
  type PaymentSourceReferenceUsage,
} from "../../../data/repo";
import { PAYMENT_SOURCE_TYPES, type PaymentSourceType } from "../../../domain/types";
import { scheduleSync } from "../../../sync/engine";
import { tr } from "../../../i18n/tr";
import { Pencil, Trash2 } from "lucide-react-native";
import { Body, Button, Card, CardList, ChipPicker, Field, IconButton, InitialsBadge, Label, Row, Screen, Spread } from "../../../ui/components";
import { placeholderPools, useRotatingPlaceholder } from "../../../ui/placeholders";
import { useUndo } from "../../../ui/undo";
import { spacing } from "../../../ui/theme";
import { appAlert, appConfirm } from "../../../ui/dialog";

const TYPES = PAYMENT_SOURCE_TYPES.map((value) => ({ value, label: tr.sources[value] }));
const NO_SOURCE = "__none__";

export default function SourcesScreen() {
  const userId = useUserId();
  const sources = useSources();
  const persons = usePersons();
  const undo = useUndo();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<PaymentSourceType>("credit_card");
  // persons load async (live query) — derive the default owner.
  const [personChoice, setPersonChoice] = useState<string | null>(null);
  const personId = personChoice ?? persons.find((p) => p.isSelf)?.id ?? persons[0]?.id ?? null;
  const [dueDayStr, setDueDayStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState<{ source: (typeof sources)[number]; usage: PaymentSourceReferenceUsage } | null>(null);
  const [replacementChoice, setReplacementChoice] = useState<string>(NO_SOURCE);

  const dueDay = dueDayStr.trim() === "" ? null : Number(dueDayStr);
  const dueDayValid = dueDay === null || (Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setSourceType("credit_card");
    setPersonChoice(null);
    setDueDayStr("");
  };

  const startEdit = (src: (typeof sources)[number]) => {
    setEditingId(src.id);
    setName(src.name);
    setSourceType(src.type);
    setPersonChoice(src.personId);
    setDueDayStr(src.dueDay != null ? String(src.dueDay) : "");
  };

  const save = async () => {
    if (busy || !name.trim() || !personId || !dueDayValid) return;
    setBusy(true);
    try {
      const existing = editingId ? sources.find((s) => s.id === editingId) : null;
      await writeRows(userId, [
        {
          table: "payment_sources",
          row: {
            ...(existing ?? { statementDay: null, color: null, logoSource: "initials", logoRef: null, isActive: true }),
            id: editingId ?? newId(),
            name: name.trim(),
            type: sourceType,
            personId,
            dueDay,
            deletedAt: null,
          },
        },
      ]);
      scheduleSync(userId);
      resetForm();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: (typeof sources)[number]) => {
    if (busy) return;
    setBusy(true);
    try {
      const usage = await paymentSourceReferenceUsage(userId, s.id);
      if (usage.total > 0) {
        setResolving({ source: s, usage });
        setReplacementChoice(sources.find((source) => source.id !== s.id)?.id ?? NO_SOURCE);
        return;
      }
      if (!(await appConfirm(s.name, tr.references.deleteUnusedSource, { confirmLabel: tr.common.delete, danger: true }))) return;
      const snapshot = await deleteUnreferencedPaymentSource(userId, s.id);
      scheduleSync(userId);
      if (snapshot) {
        undo.show(`${s.name} · ${tr.common.deleted}`, () => {
          void restoreRow(userId, "payment_sources", snapshot).then(() => scheduleSync(userId));
        }, "warning");
      }
    } catch (error) {
      if (error instanceof ReferencedRecordError) {
        const usage = await paymentSourceReferenceUsage(userId, s.id);
        setResolving({ source: s, usage });
      } else {
        void appAlert(tr.errors.saveFailed, tr.errors.title);
      }
    } finally {
      setBusy(false);
    }
  };

  const reassign = async () => {
    if (!resolving || busy) return;
    const replacementId = replacementChoice === NO_SOURCE ? null : replacementChoice;
    const replacementName = replacementId
      ? sources.find((source) => source.id === replacementId)?.name ?? tr.references.noSource
      : tr.references.noSource;
    const confirmed = await appConfirm(
      resolving.source.name,
      tr.references.reassignSourceConfirm(resolving.usage.total, replacementName),
      { confirmLabel: tr.references.reassignAndDelete, danger: true },
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await reassignAndDeletePaymentSource(userId, resolving.source.id, replacementId);
      scheduleSync(userId);
      setResolving(null);
      setReplacementChoice(NO_SOURCE);
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    } finally {
      setBusy(false);
    }
  };

  const usageRows = resolving
    ? [
        [tr.references.installmentPlans, resolving.usage.installmentPlans],
        [tr.references.transactions, resolving.usage.transactions],
        [tr.references.subscriptions, resolving.usage.subscriptions],
      ].filter(([, count]) => Number(count) > 0)
    : [];

  return (
    <Screen>
      <Card>
        {editingId ? <Label>{tr.common.edit}</Label> : null}
        <Field label={tr.onboarding.addSource} value={name} onChangeText={setName} placeholder={useRotatingPlaceholder(placeholderPools.source)} />
        <ChipPicker options={TYPES.map((t) => ({ value: t.value, label: t.label }))} value={sourceType} onChange={setSourceType} />
        {persons.length > 1 ? (
          <ChipPicker options={persons.map((p) => ({ value: p.id, label: p.name }))} value={personId} onChange={setPersonChoice} />
        ) : null}
        {sourceType === "credit_card" ? (
          <Field label={tr.sources.dueDay} placeholder={tr.common.optionalHint} value={dueDayStr} onChangeText={setDueDayStr} keyboardType="number-pad" />
        ) : null}
        {editingId ? (
          <Row>
            <View style={{ flex: 1 }}>
              <Button label={tr.common.save} onPress={() => void save()} disabled={!name.trim() || !personId || !dueDayValid || busy} loading={busy} />
            </View>
            <Button label={tr.common.cancel} variant="ghost" onPress={resetForm} />
          </Row>
        ) : (
          <Button label={tr.common.add} onPress={() => void save()} disabled={!name.trim() || !personId || !dueDayValid || busy} loading={busy} />
        )}
      </Card>

      {resolving ? (
        <Card>
          <Body style={{ marginBottom: spacing.xs }}>{tr.references.sourceInUse(resolving.source.name)}</Body>
          <Body muted style={{ marginBottom: spacing.md }}>{tr.references.resolveBeforeDelete}</Body>
          {usageRows.map(([label, count]) => (
            <Spread key={String(label)} style={{ marginBottom: spacing.xs }}>
              <Body muted>{label}</Body>
              <Body>{String(count)}</Body>
            </Spread>
          ))}
          <Body style={{ marginTop: spacing.sm, marginBottom: spacing.sm }}>{tr.references.chooseSource}</Body>
          <ChipPicker
            options={[
              { value: NO_SOURCE, label: tr.references.noSource },
              ...sources.filter((source) => source.id !== resolving.source.id).map((source) => ({ value: source.id, label: source.name })),
            ]}
            value={replacementChoice}
            onChange={setReplacementChoice}
          />
          <Row>
            <View style={{ flex: 1 }}>
              <Button label={tr.references.reassignAndDelete} onPress={() => void reassign()} disabled={busy} loading={busy} />
            </View>
            <Button label={tr.common.cancel} variant="ghost" onPress={() => setResolving(null)} disabled={busy} />
          </Row>
        </Card>
      ) : null}

      <CardList
        items={sources}
        keyExtractor={(s) => s.id}
        renderItem={(s) => (
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
            <Row gap={spacing.sm}>
              <IconButton icon={Pencil} size={32} label={tr.common.edit} onPress={() => startEdit(s)} />
              <IconButton icon={Trash2} size={32} tone="danger" label={tr.common.delete} haptic="none" onPress={() => void remove(s)} />
            </Row>
          </Spread>
        )}
      />
    </Screen>
  );
}
