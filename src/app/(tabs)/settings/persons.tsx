/** Person management (§2.8): named people; non-self people are watch-only. */

import React, { useState } from "react";
import { View } from "react-native";
import { usePersonsState, useUserId } from "../../../data/hooks";
import { combineLiveQueryStatus } from "../../../data/live-state";
import {
  deleteUnreferencedPerson,
  createPerson,
  personReferenceUsage,
  reassignAndDeletePerson,
  ReferencedRecordError,
  renamePerson,
  restorePerson,
  type PersonReferenceUsage,
} from "../../../data/repo";
import { scheduleSync } from "../../../sync/engine";
import { tr } from "../../../i18n/tr";
import { Pencil, Trash2 } from "lucide-react-native";
import { Badge, Body, Button, Card, CardList, ChipPicker, DataStateNotice, Field, IconButton, Row, Screen, Spread } from "../../../ui/components";
import { appAlert, appConfirm } from "../../../ui/dialog";
import { placeholderPools, useRotatingPlaceholder } from "../../../ui/placeholders";
import { useUndo } from "../../../ui/undo";
import { spacing } from "../../../ui/theme";
import { useOperationGuard } from "../../../ui/operation-guard";
import { useDirtyExitGuard } from "../../../ui/dirty-exit";

export default function PersonsScreen() {
  const userId = useUserId();
  const personsState = usePersonsState();
  const persons = personsState.data;
  const undo = useUndo();
  const operationGuard = useOperationGuard();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [resolving, setResolving] = useState<{ person: (typeof persons)[number]; usage: PersonReferenceUsage } | null>(null);
  const [replacementId, setReplacementId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const editingPerson = editingId ? persons.find((person) => person.id === editingId) : null;
  useDirtyExitGuard(
    name.trim() !== "" || Boolean(editingPerson && editName.trim() !== editingPerson.name),
  );
  const personPlaceholder = useRotatingPlaceholder(placeholderPools.person);
  const dataStatus = combineLiveQueryStatus([personsState]);
  const dataReady = personsState.updatedAt != null;

  const rename = async (p: (typeof persons)[number], newName: string) => {
    try {
      await renamePerson(userId, p, newName);
      scheduleSync(userId);
      setEditingId(null);
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    }
  };

  const add = async () => {
    if (!name.trim()) return;
    await operationGuard.run(async () => {
      setAdding(true);
      try {
        await createPerson(userId, name);
        scheduleSync(userId);
        setName("");
      } catch {
        void appAlert(tr.errors.saveFailed, tr.errors.title);
      } finally {
        setAdding(false);
      }
    });
  };

  const remove = async (p: (typeof persons)[number]) => {
    if (deleting) return;
    setDeleting(true);
    try {
      const usage = await personReferenceUsage(userId, p.id);
      if (usage.total > 0) {
        setResolving({ person: p, usage });
        setReplacementId(persons.find((person) => person.id !== p.id && person.isSelf)?.id ?? persons.find((person) => person.id !== p.id)?.id ?? null);
        return;
      }
      if (!(await appConfirm(p.name, tr.references.deleteUnusedPerson, { confirmLabel: tr.common.delete, danger: true }))) return;
      const snapshot = await deleteUnreferencedPerson(userId, p.id);
      scheduleSync(userId);
      if (snapshot) {
        undo.show(`${p.name} · ${tr.common.deleted}`, () => {
          return restorePerson(userId, snapshot).then(() => scheduleSync(userId));
        }, "warning");
      }
    } catch (error) {
      if (error instanceof ReferencedRecordError) {
        const usage = await personReferenceUsage(userId, p.id);
        setResolving({ person: p, usage });
      } else {
        void appAlert(tr.errors.saveFailed, tr.errors.title);
      }
    } finally {
      setDeleting(false);
    }
  };

  const reassign = async () => {
    if (!resolving || !replacementId || deleting) return;
    const target = persons.find((person) => person.id === replacementId);
    if (!target) return;
    const confirmed = await appConfirm(
      resolving.person.name,
      tr.references.reassignPersonConfirm(resolving.usage.total, target.name),
      { confirmLabel: tr.references.reassignAndDelete, danger: true },
    );
    if (!confirmed) return;
    setDeleting(true);
    try {
      await reassignAndDeletePerson(userId, resolving.person.id, replacementId);
      scheduleSync(userId);
      setResolving(null);
      setReplacementId(null);
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    } finally {
      setDeleting(false);
    }
  };

  const usageRows = resolving
    ? [
        [tr.references.paymentSources, resolving.usage.paymentSources],
        [tr.references.installmentPlans, resolving.usage.installmentPlans],
        [tr.references.transactions, resolving.usage.transactions],
        [tr.references.subscriptions, resolving.usage.subscriptions],
        [tr.references.recurringIncomes, resolving.usage.recurringIncomes],
      ].filter(([, count]) => Number(count) > 0)
    : [];

  if (!dataReady) {
    return (
      <Screen>
        <DataStateNotice status={dataStatus} retry={personsState.retry} />
      </Screen>
    );
  }

  return (
    <Screen>
      <DataStateNotice status={dataStatus} retry={personsState.retry} />
      <Body muted style={{ marginBottom: spacing.md }}>{tr.onboarding.personsHint}</Body>
      <Card>
        <Row>
          <View style={{ flex: 1 }}>
            <Field accessibilityLabel={tr.onboarding.addPerson} noMargin value={name} onChangeText={setName} placeholder={personPlaceholder} />
          </View>
          <Button label={tr.common.add} onPress={() => void add()} disabled={!name.trim() || adding} loading={adding} />
        </Row>
      </Card>
      {resolving ? (
        <Card>
          <Body style={{ marginBottom: spacing.xs }}>{tr.references.personInUse(resolving.person.name)}</Body>
          <Body muted style={{ marginBottom: spacing.md }}>{tr.references.resolveBeforeDelete}</Body>
          {usageRows.map(([label, count]) => (
            <Spread key={String(label)} style={{ marginBottom: spacing.xs }}>
              <Body muted>{label}</Body>
              <Body>{String(count)}</Body>
            </Spread>
          ))}
          <Body style={{ marginTop: spacing.sm, marginBottom: spacing.sm }}>{tr.references.choosePerson}</Body>
          <ChipPicker
            options={persons.filter((person) => person.id !== resolving.person.id).map((person) => ({ value: person.id, label: person.name }))}
            value={replacementId}
            onChange={setReplacementId}
          />
          <Row>
            <View style={{ flex: 1 }}>
              <Button label={tr.references.reassignAndDelete} onPress={() => void reassign()} disabled={!replacementId || deleting} loading={deleting} />
            </View>
            <Button label={tr.common.cancel} variant="ghost" onPress={() => setResolving(null)} disabled={deleting} />
          </Row>
        </Card>
      ) : null}
      <CardList
        items={[...persons].sort((a, b) => Number(b.isSelf) - Number(a.isSelf))}
        keyExtractor={(p) => p.id}
        renderItem={(p) =>
          editingId === p.id ? (
            <Row style={{ paddingVertical: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Field accessibilityLabel={`${tr.common.edit} · ${p.name}`} noMargin value={editName} onChangeText={setEditName} autoFocus />
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
