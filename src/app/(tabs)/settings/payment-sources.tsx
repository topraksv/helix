/** Payment source management: cards / cash / bank, per-person, card cycle. */

import { Stack, useLocalSearchParams, type Href } from "expo-router";
import { resolveBackTarget } from "../../../ui/navigation";
import { HeaderBackButton } from "../../../ui/header-back";
import React, { useState } from "react";
import { View } from "react-native";
import { useAllTransactionsState, useCreditCardStatementsState, usePersonsState, useSourcesState, useUserId } from "../../../data/hooks";
import { combineLiveQueryStatus } from "../../../data/live-state";
import {
  CreditCardCycleRequiredError,
  deleteUnreferencedPaymentSource,
  paymentSourceReferenceUsage,
  reassignAndDeletePaymentSource,
  ReferencedRecordError,
  restorePaymentSource,
  upsertPaymentSource,
  type PaymentSourceReferenceUsage,
} from "../../../data/repo";
import { PAYMENT_SOURCE_TYPES, type PaymentSourceType } from "../../../domain/types";
import { dateLabel, monthLabel, tr } from "../../../i18n/tr";
import { formatMinor } from "../../../domain/money";
import { scheduleSync } from "../../../sync/engine";
import { Pencil, Trash2 } from "lucide-react-native";
import { Badge, Body, Button, Card, CardList, ChipPicker, DataStateNotice, Field, IconButton, InitialsBadge, Label, Row, Screen, Spread } from "../../../ui/components";
import { placeholderPools, useRotatingPlaceholder } from "../../../ui/placeholders";
import { useUndo } from "../../../ui/undo";
import { spacing } from "../../../ui/theme";
import { appAlert, appConfirm } from "../../../ui/dialog";
import { useOperationGuard } from "../../../ui/operation-guard";
import { useDirtyExitGuard } from "../../../ui/dirty-exit";
import { isMonthDay } from "../../../domain/dates";
import { MonthDayField, monthDayLabel } from "../../../ui/month-day-field";

const TYPES = PAYMENT_SOURCE_TYPES.map((value) => ({ value, label: tr.sources[value] }));
const NO_SOURCE = "__none__";

export default function SourcesScreen() {
  // Reachable from more than one place, and every external push is anchored —
  // which mounts settings/index UNDERNEATH this screen, so plain history would
  // send the user back to a screen they never visited. The pusher records where
  // it came from; `resolveBackTarget` validates it (typeof string +
  // Object.hasOwn, so a hand-typed or prototype-polluting value cannot match)
  // and falls back to the settings hub for deep links with no recorded source.
  const { from } = useLocalSearchParams<{ from?: string }>();
  const back = resolveBackTarget<Href>(from, { transaction: "/transaction", installment: "/installment-new", subscription: "/subscription-form", upcoming: "/upcoming" as Href }, "/(tabs)/settings");
  const userId = useUserId();
  const sourcesState = useSourcesState();
  const statementsState = useCreditCardStatementsState();
  const transactionsState = useAllTransactionsState();
  const personsState = usePersonsState();
  const sources = sourcesState.data;
  const statements = statementsState.data;
  const transactions = transactionsState.data;
  const persons = personsState.data;
  const undo = useUndo();
  const operationGuard = useOperationGuard();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<PaymentSourceType>("credit_card");
  // persons load async (live query) — derive the default owner.
  const [personChoice, setPersonChoice] = useState<string | null>(null);
  const personId = personChoice ?? persons.find((p) => p.isSelf)?.id ?? persons[0]?.id ?? null;
  const [dueDayStr, setDueDayStr] = useState("");
  const [statementDayStr, setStatementDayStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState<{ source: (typeof sources)[number]; usage: PaymentSourceReferenceUsage } | null>(null);
  const [replacementChoice, setReplacementChoice] = useState<string>(NO_SOURCE);

  const dueDay = dueDayStr.trim() === "" ? null : Number(dueDayStr);
  const statementDay = statementDayStr.trim() === "" ? null : Number(statementDayStr);
  const editingSource = editingId ? sources.find((source) => source.id === editingId) : null;
  const sourceDraftDirty = editingSource
    ? name.trim() !== editingSource.name ||
      sourceType !== editingSource.type ||
      personId !== editingSource.personId ||
      dueDay !== editingSource.dueDay ||
      statementDay !== editingSource.statementDay
    : Boolean(
      name.trim() ||
      sourceType !== "credit_card" ||
      personChoice ||
      dueDayStr.trim() ||
      statementDayStr.trim()
    );
  useDirtyExitGuard(sourceDraftDirty && !busy);
  const sourcePlaceholder = useRotatingPlaceholder(placeholderPools.source);
  const liveStates = [sourcesState, statementsState, transactionsState, personsState];
  const dataStatus = combineLiveQueryStatus(liveStates);
  const dataReady = liveStates.every((state) => state.updatedAt != null);
  const retryData = () => {
    sourcesState.retry();
    statementsState.retry();
    transactionsState.retry();
    personsState.retry();
  };
  const validDay = (day: number | null) => day != null && isMonthDay(day);
  const cycleValid = sourceType !== "credit_card" || (validDay(statementDay) && validDay(dueDay));
  const formValid = Boolean(name.trim() && personId && cycleValid);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setSourceType("credit_card");
    setPersonChoice(null);
    setDueDayStr("");
    setStatementDayStr("");
  };

  const eligibleReplacements = (sourceId: string, usage: PaymentSourceReferenceUsage) => {
    const cardRequired = usage.cardInstallmentPlans > 0;
    return sources.filter((source) =>
      source.id !== sourceId &&
      (!cardRequired || (
        source.type === "credit_card" &&
        source.statementDay != null && source.statementDay >= 1 && source.statementDay <= 31 &&
        source.dueDay != null && source.dueDay >= 1 && source.dueDay <= 31
      )),
    );
  };

  const startEdit = (src: (typeof sources)[number]) => {
    setEditingId(src.id);
    setName(src.name);
    setSourceType(src.type);
    setPersonChoice(src.personId);
    setDueDayStr(src.dueDay != null ? String(src.dueDay) : "");
    setStatementDayStr(src.statementDay != null ? String(src.statementDay) : "");
  };

  const save = async () => {
    if (!formValid || !personId) return;
    await operationGuard.run(async () => {
      setBusy(true);
      try {
        await upsertPaymentSource(userId, {
          id: editingId ?? undefined,
          name,
          type: sourceType,
          personId,
          dueDay,
          statementDay,
        });
        scheduleSync(userId);
        resetForm();
      } catch (error) {
        void appAlert(
          error instanceof CreditCardCycleRequiredError ? tr.sources.cycleRequired : tr.errors.saveFailed,
          tr.errors.title,
        );
      } finally {
        setBusy(false);
      }
    });
  };

  const remove = async (s: (typeof sources)[number]) => {
    if (busy) return;
    setBusy(true);
    try {
      const usage = await paymentSourceReferenceUsage(userId, s.id);
      if (usage.total > 0) {
        setResolving({ source: s, usage });
        setReplacementChoice(eligibleReplacements(s.id, usage)[0]?.id ?? NO_SOURCE);
        return;
      }
      if (!(await appConfirm(s.name, tr.references.deleteUnusedSource, { confirmLabel: tr.common.delete, danger: true }))) return;
      const snapshot = await deleteUnreferencedPaymentSource(userId, s.id);
      scheduleSync(userId);
      if (snapshot) {
        undo.show(`${s.name} · ${tr.common.deleted}`, () => {
          return restorePaymentSource(userId, snapshot).then(() => scheduleSync(userId));
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
    } catch (error) {
      void appAlert(
        error instanceof CreditCardCycleRequiredError ? tr.references.cardReplacementRequired : tr.errors.saveFailed,
        tr.errors.title,
      );
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
  const editingStatements = editingId
    ? statements.filter((statement) => statement.paymentSourceId === editingId).sort((a, b) => b.dueDate.localeCompare(a.dueDate))
    : [];
  const replacementOptions = resolving ? eligibleReplacements(resolving.source.id, resolving.usage) : [];
  const cardReplacementRequired = Boolean(resolving && resolving.usage.cardInstallmentPlans > 0);

  if (!dataReady) {
    return (
      <Screen>
        <Stack.Screen options={{ headerLeft: () => <HeaderBackButton fallback={back.href} exact={back.exact} /> }} />
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerLeft: () => <HeaderBackButton fallback={back.href} exact={back.exact} /> }} />
      <DataStateNotice status={dataStatus} retry={retryData} />
      <Card>
        {editingId ? <Label>{tr.common.edit}</Label> : null}
        <Field label={tr.onboarding.addSource} value={name} onChangeText={setName} placeholder={sourcePlaceholder} />
        <ChipPicker options={TYPES.map((t) => ({ value: t.value, label: t.label }))} value={sourceType} onChange={setSourceType} />
        {persons.length > 1 ? (
          <ChipPicker options={persons.map((p) => ({ value: p.id, label: p.name }))} value={personId} onChange={setPersonChoice} />
        ) : null}
        {sourceType === "credit_card" ? (
          <>
            <Row>
              <View style={{ flex: 1 }}>
                <MonthDayField label={tr.sources.statementDay} value={statementDayStr} onChange={setStatementDayStr} />
              </View>
              <View style={{ flex: 1 }}>
                <MonthDayField label={tr.sources.dueDay} value={dueDayStr} onChange={setDueDayStr} />
              </View>
            </Row>
            <Body muted style={{ marginBottom: spacing.md }}>{tr.sources.cycleHint}</Body>
          </>
        ) : null}
        {editingId ? (
          <Row>
            <View style={{ flex: 1 }}>
              <Button label={tr.common.save} onPress={() => void save()} disabled={!formValid || busy} loading={busy} />
            </View>
            <Button label={tr.common.cancel} variant="ghost" onPress={resetForm} />
          </Row>
        ) : (
          <Button label={tr.common.add} onPress={() => void save()} disabled={!formValid || busy} loading={busy} />
        )}
      </Card>

      {editingId && sourceType === "credit_card" && editingStatements.length > 0 ? (
        <Card>
          <Label>{tr.sources.statementHistory}</Label>
          {editingStatements.map((statement) => {
            const amount = transactions
              .filter((transaction) => transaction.cardStatementId === statement.id)
              .reduce((sum, transaction) => sum + transaction.amountTryMinor, 0);
            return (
              <Spread key={statement.id} style={{ paddingVertical: spacing.xs, alignItems: "center" }}>
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Body>{monthLabel(statement.periodMonth)}</Body>
                  <Body muted>{tr.sources.statementDates(dateLabel(statement.statementDate), dateLabel(statement.dueDate))}</Body>
                </View>
                <Body>{formatMinor(amount)}</Body>
              </Spread>
            );
          })}
        </Card>
      ) : null}

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
          {cardReplacementRequired ? <Body muted style={{ marginBottom: spacing.sm }}>{tr.references.cardReplacementRequired}</Body> : null}
          <ChipPicker
            options={[
              ...(!cardReplacementRequired ? [{ value: NO_SOURCE, label: tr.references.noSource }] : []),
              ...replacementOptions.map((source) => ({ value: source.id, label: source.name })),
            ]}
            value={replacementChoice}
            onChange={setReplacementChoice}
          />
          <Row>
            <View style={{ flex: 1 }}>
              <Button
                label={tr.references.reassignAndDelete}
                onPress={() => void reassign()}
                disabled={busy || (cardReplacementRequired && replacementChoice === NO_SOURCE)}
                loading={busy}
              />
            </View>
            <Button label={tr.common.cancel} variant="ghost" onPress={() => setResolving(null)} disabled={busy} />
          </Row>
        </Card>
      ) : null}

      <CardList
        items={sources}
        keyExtractor={(s) => s.id}
        renderItem={(s) => (
          <Spread style={{ paddingVertical: spacing.sm, alignItems: "center" }}>
            <Row style={{ flex: 1, alignItems: "center" }}>
              <InitialsBadge name={s.name} size={32} />
              <View style={{ flex: 1 }}>
                <Body>{s.name}</Body>
                <Body muted style={{ marginTop: 1 }}>{TYPES.find((t) => t.value === s.type)?.label}</Body>
                {persons.length > 1 ? (
                  <Body muted style={{ marginTop: 1 }}>
                    {tr.sources.owner}: {persons.find((p) => p.id === s.personId)?.name ?? tr.common.none}
                  </Body>
                ) : null}
                {s.type === "credit_card" ? (
                  <Row gap={spacing.xs} style={{ flexWrap: "wrap", marginTop: spacing.xs }}>
                    {s.statementDay && s.dueDay ? (
                      <>
                        <Badge text={`${tr.sources.statementDayShort}: ${monthDayLabel(s.statementDay)}`} />
                        <Badge text={`${tr.sources.dueDayShort}: ${monthDayLabel(s.dueDay)}`} tone="primary" />
                      </>
                    ) : (
                      <Badge text={tr.sources.cycleMissing} tone="warning" />
                    )}
                  </Row>
                ) : null}
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
