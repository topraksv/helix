/** Payment source management: cards / cash / bank, per-person, card cycle. */

import React, { useState } from "react";
import { View } from "react-native";
import { restoreRow } from "../../../db/mutations";
import { useAllTransactions, useCreditCardStatements, usePersons, useSources, useUserId } from "../../../data/hooks";
import {
  CreditCardCycleRequiredError,
  deleteUnreferencedPaymentSource,
  paymentSourceReferenceUsage,
  reassignAndDeletePaymentSource,
  ReferencedRecordError,
  upsertPaymentSource,
  type PaymentSourceReferenceUsage,
} from "../../../data/repo";
import { PAYMENT_SOURCE_TYPES, type PaymentSourceType } from "../../../domain/types";
import { dateLabel, monthLabel, tr } from "../../../i18n/tr";
import { formatMinor } from "../../../domain/money";
import { scheduleSync } from "../../../sync/engine";
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
  const statements = useCreditCardStatements();
  const transactions = useAllTransactions();
  const persons = usePersons();
  const undo = useUndo();
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
  const validDay = (day: number | null) => day != null && Number.isInteger(day) && day >= 1 && day <= 31;
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
    if (busy || !formValid || !personId) return;
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
          <>
            <Row>
              <View style={{ flex: 1 }}>
                <Field label={tr.sources.statementDay} placeholder={tr.sources.dayPlaceholder} value={statementDayStr} onChangeText={setStatementDayStr} keyboardType="number-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label={tr.sources.dueDay} placeholder={tr.sources.dayPlaceholder} value={dueDayStr} onChangeText={setDueDayStr} keyboardType="number-pad" />
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
          <Spread style={{ paddingVertical: spacing.sm }}>
            <Row style={{ flex: 1 }}>
              <InitialsBadge name={s.name} size={32} />
              <View style={{ flex: 1 }}>
                <Body>{s.name}</Body>
                <Body muted>
                  {TYPES.find((t) => t.value === s.type)?.label}
                  {s.type === "credit_card" && s.statementDay && s.dueDay
                    ? ` · ${tr.sources.statementDay}: ${s.statementDay} · ${tr.sources.dueDay}: ${s.dueDay}`
                    : s.type === "credit_card" ? ` · ${tr.sources.cycleMissing}` : ""}
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
