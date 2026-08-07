/** Person management (§2.8): named people; non-self people are watch-only. */

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { usePersonsState, useUserId } from "../../../data/hooks";
import { combineLiveStates } from "../../../data/live-state";
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
import Eye from "lucide-react-native/icons/eye";
import Pencil from "lucide-react-native/icons/pencil";
import Plus from "lucide-react-native/icons/plus";
import Trash2 from "lucide-react-native/icons/trash-2";
import UserRound from "lucide-react-native/icons/user-round";
import { Badge, Body, Button, Card, CardList, ChipPicker, DataStateNotice, FadeIn, Field, IconButton, PanelHeader, Row, Screen, SectionHeader, Spread } from "../../../ui/components";
import { appAlert, appConfirm } from "../../../ui/dialog";
import { placeholderPools, useRotatingPlaceholder } from "../../../ui/placeholders";
import { useUndo } from "../../../ui/undo";
import { circle, font, radius, spacing, type, useTheme } from "../../../ui/theme";
import { useOperationGuard } from "../../../ui/operation-guard";
import { useDirtyExitGuard } from "../../../ui/dirty-exit";
import { WorkspaceSplit } from "../../../ui/workspace-layout";

function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase("tr-TR") ?? "•";
}

function PeopleOverview({ people }: { people: { id: string; name: string; isSelf: boolean }[] }) {
  const { palette } = useTheme();
  const self = people.find((person) => person.isSelf);
  const watched = people.filter((person) => !person.isSelf);
  if (watched.length === 0) {
    return (
      <Body muted style={{ fontSize: type.small.fontSize, marginBottom: spacing.md }}>{tr.persons.soloOverview}</Body>
    );
  }
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.lg }}>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={tr.persons.overviewA11y(people.length, watched.length)}
          style={{
            width: 96,
            height: 96,
            borderRadius: radius.lg,
            backgroundColor: palette.surfaceAlt,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.border,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <View style={{ position: "absolute", width: 78, height: 78, borderRadius: circle(78), borderWidth: StyleSheet.hairlineWidth, borderColor: palette.secondary + "80" }} />
          <View style={{ width: 42, height: 42, borderRadius: radius.xl, backgroundColor: palette.primary, alignItems: "center", justifyContent: "center", zIndex: 1 }}>
            <Text style={[type.heading, { color: palette.onPrimary, fontFamily: font.bold }]}>
              {initialOf(self?.name ?? tr.onboarding.me)}
            </Text>
          </View>
          <View style={{ position: "absolute", bottom: 6, borderRadius: radius.full, backgroundColor: palette.surface, paddingHorizontal: 7, paddingVertical: 2, zIndex: 2 }}>
            <Text style={[type.small, { color: palette.primaryText, fontFamily: font.bold, fontSize: type.micro.fontSize }]}>
              {tr.persons.selfBadge}
            </Text>
          </View>
          {watched.slice(0, 3).map((person, index) => {
            const positions = [
              { top: 8, right: 12 },
              { top: 8, left: 12 },
              { bottom: 8, right: 10 },
            ];
            return (
              <FadeIn
                key={person.id}
                delay={index * 70}
                style={[
                  {
                    position: "absolute",
                    width: 25,
                    height: 25,
                    borderRadius: radius.md,
                    backgroundColor: palette.secondarySoft,
                    borderWidth: 2,
                    borderColor: palette.surfaceAlt,
                    alignItems: "center",
                    justifyContent: "center",
                  },
                  positions[index],
                ]}
              >
                <Text style={[type.small, { color: palette.secondaryText, fontFamily: font.bold, fontSize: type.micro.fontSize }]}>
                  {initialOf(person.name)}
                </Text>
              </FadeIn>
            );
          })}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" style={[type.heading, { color: palette.text, marginBottom: spacing.xs }]}>
            {tr.persons.overviewTitle}
          </Text>
          <Body muted>{tr.persons.overviewHint}</Body>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm }}>
            <Badge text={tr.persons.totalCount(people.length)} tone="primary" />
            <Badge text={tr.persons.watchedCount(watched.length)} />
          </View>
        </View>
      </View>
    </Card>
  );
}

export default function PersonsScreen() {
  const userId = useUserId();
  const personsState = usePersonsState();
  const persons = personsState.data;
  const undo = useUndo();
  const { palette } = useTheme();
  const operationGuard = useOperationGuard();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [resolving, setResolving] = useState<{ person: (typeof persons)[number]; usage: PersonReferenceUsage } | null>(null);
  const [replacementId, setReplacementId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const editingPerson = editingId ? persons.find((person) => person.id === editingId) : null;
  const editDraftDirty = Boolean(editingPerson && editName.trim() !== editingPerson.name);
  const { confirmDiscard } = useDirtyExitGuard(name.trim() !== "" || editDraftDirty);
  const personPlaceholder = useRotatingPlaceholder(placeholderPools.person);
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([personsState]);

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
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

  return (
    <Screen width="workspace">
      <DataStateNotice status={dataStatus} retry={retryData} />
      <PeopleOverview people={persons} />
      <WorkspaceSplit
        testID="persons-workspace"
        wideLayout={persons.length === 0 ? "stack" : "split"}
        primary={(
          <View>
          <Card>
        <PanelHeader icon={Plus} title={tr.persons.addTitle} description={tr.persons.addHint} />
        <Row style={{ alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <Field accessibilityLabel={tr.onboarding.addPerson} noMargin value={name} onChangeText={setName} placeholder={personPlaceholder} />
          </View>
          <Button label={tr.common.add} onPress={() => void add()} disabled={!name.trim() || adding} loading={adding} />
        </Row>
          </Card>
          {resolving ? (
            <Card>
          <PanelHeader
            icon={Trash2}
            title={tr.references.personInUse(resolving.person.name)}
            description={tr.references.resolveBeforeDelete}
          />
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
          </View>
        )}
        secondary={(
          <View>
          <SectionHeader description={tr.persons.listHint}>{tr.persons.listTitle}</SectionHeader>
          <CardList
            items={[...persons].sort((a, b) => Number(b.isSelf) - Number(a.isSelf))}
            keyExtractor={(p) => p.id}
            renderItem={(p) =>
          editingId === p.id ? (
            // The name is the point of this row, so it gets the whole width.
            // Sharing one line with two full-size actions left it about a third
            // of a phone — you could not read the thing you were renaming.
            <View style={{ paddingVertical: spacing.sm, gap: spacing.sm }}>
              <Field accessibilityLabel={`${tr.common.edit} · ${p.name}`} noMargin value={editName} onChangeText={setEditName} />
              <Row gap={spacing.sm} style={{ justifyContent: "flex-end" }}>
                <Button label={tr.common.cancel} size="sm" variant="ghost" onPress={() => setEditingId(null)} />
                <Button label={tr.common.save} size="sm" variant="secondary" disabled={!editName.trim()} onPress={() => void rename(p, editName)} />
              </Row>
            </View>
          ) : (
            <Spread
              style={{
                paddingVertical: spacing.sm,
                paddingLeft: spacing.sm,
                borderLeftWidth: 2,
                borderLeftColor: p.isSelf ? palette.primary : palette.secondary,
              }}
            >
              <Row gap={spacing.sm} style={{ flex: 1, paddingRight: spacing.sm }}>
                <View
                  style={{
                    width: 38,
                    height: 38,
                    flexShrink: 0,
                    borderRadius: radius.lg,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: p.isSelf ? palette.primarySoft : palette.secondarySoft,
                  }}
                >
                  {p.isSelf ? (
                    <UserRound accessible={false} size={18} color={palette.primary} />
                  ) : (
                    <Eye accessible={false} size={18} color={palette.secondary} />
                  )}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Body style={{ fontFamily: font.semibold }}>{p.name}</Body>
                  <Text style={[type.small, { color: p.isSelf ? palette.primaryText : palette.textSecondary, marginTop: 2 }]}>
                    {p.isSelf ? tr.persons.ownerHint : tr.persons.watchedHint}
                  </Text>
                </View>
              </Row>
              <Row gap={spacing.sm}>
                <IconButton
                  icon={Pencil}
                  label={`${tr.common.edit} · ${p.name}`}
                  onPress={() => confirmDiscard(() => {
                    setEditingId(p.id);
                    setEditName(p.name);
                  }, editDraftDirty)}
                />
                {!p.isSelf ? <IconButton icon={Trash2} tone="danger" label={`${tr.common.delete} · ${p.name}`} haptic="none" onPress={() => void remove(p)} /> : null}
              </Row>
            </Spread>
          )
            }
          />
          </View>
        )}
      />
    </Screen>
  );
}
