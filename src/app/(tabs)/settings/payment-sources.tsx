/** Payment source management: cards / cash / bank, per-person, card cycle. */

import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useContentWidth } from "../../../ui/viewport";
import { useAllTransactionsState, useCreditCardStatementsState, usePersonsState, useSourcesState, useUserId } from "../../../data/hooks";
import { combineLiveStates } from "../../../data/live-state";
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
import { formatMinorCompact } from "../../../domain/money";
import { scheduleSync } from "../../../sync/engine";
import Banknote from "lucide-react-native/icons/banknote";
import CreditCard from "lucide-react-native/icons/credit-card";
import Landmark from "lucide-react-native/icons/landmark";
import Pencil from "lucide-react-native/icons/pencil";
import ReceiptText from "lucide-react-native/icons/receipt-text";
import Trash2 from "lucide-react-native/icons/trash-2";
import WalletCards from "lucide-react-native/icons/wallet-cards";
import type { LucideIcon } from "lucide-react-native";
import { Amount, Badge, Body, Button, Card, CardList, ChipPicker, ChoiceTile, DataStateNotice, EmptyState, Field, IconButton, PanelHeader, Row, Screen, SectionHeader, Spread } from "../../../ui/components";
import { placeholderPools, useRotatingPlaceholder } from "../../../ui/placeholders";
import { useUndo } from "../../../ui/undo";
import { spacing, useTheme } from "../../../ui/theme";
import { appAlert, appConfirm } from "../../../ui/dialog";
import { useOperationGuard } from "../../../ui/operation-guard";
import { useDirtyExitGuard } from "../../../ui/dirty-exit";
import { WorkspaceSplit } from "../../../ui/workspace-layout";
import { isMonthDay } from "../../../domain/dates";

import { monthDayLabel } from "../../../ui/month-day-field";
import { CardCycleFields, cardCycleError } from "../../../ui/card-cycle-fields";
import { selectionTapIfChanged } from "../../../ui/haptics";
import { PersonAssignment } from "../../../ui/person-assignment";
import { shouldUseTripleTileGrid } from "../../../ui/responsive";

const TYPES = PAYMENT_SOURCE_TYPES.map((value) => ({ value, label: tr.sources[value] }));
const NO_SOURCE = "__none__";

const sourceIcon = (value: PaymentSourceType): LucideIcon =>
  value === "cash"
    ? Banknote
    : value === "e_wallet"
      ? WalletCards
      : value === "bank_transfer"
        ? Landmark
        : value === "direct_debit"
          ? ReceiptText
          : CreditCard;

function SourceGlyph({ sourceType, size = 44 }: { sourceType: PaymentSourceType; size?: number }) {
  const { palette } = useTheme();
  const Icon = sourceIcon(sourceType);
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: Math.round(size * 0.34),
        backgroundColor: palette.primarySoft,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.primary + "70",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon size={Math.round(size * 0.44)} color={palette.primary} strokeWidth={1.8} />
    </View>
  );
}

function SourceTypePicker({ value, onChange }: { value: PaymentSourceType; onChange: (value: PaymentSourceType) => void }) {
  const { palette } = useTheme();
  const tripleTiles = shouldUseTripleTileGrid(useContentWidth());
  return (
    <View
      role="radiogroup"
      accessibilityLabel={tr.tx.type}
      style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md }}
    >
      {TYPES.map((option) => {
        const selected = option.value === value;
        const Icon = sourceIcon(option.value);
        return (
          <ChoiceTile
            key={option.value}
            label={option.label}
            selected={selected}
            layout="row"
            minHeight={52}
            // Seven tiles wrapped into two columns left the last one — EFT /
            // Havale — alone on its row, where `flexGrow` stretched it to full
            // width. The widest tile was therefore the least-used method, by
            // accident of arithmetic. Giving the double width to the credit
            // card instead makes the most-reached-for option the easiest to
            // hit, and leaves an even six to fill the rows below it.
            basis={option.value === "credit_card" ? (tripleTiles ? "48%" : "100%") : tripleTiles ? "23%" : "47%"}
            onPress={() => {
              selectionTapIfChanged(value, option.value);
              onChange(option.value);
            }}
          >
            <Icon accessible={false} size={18} color={selected ? palette.primary : palette.textSecondary} />
          </ChoiceTile>
        );
      })}
    </View>
  );
}

export default function SourcesScreen() {
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
  const { confirmDiscard } = useDirtyExitGuard(sourceDraftDirty && !busy);
  const sourcePlaceholder = useRotatingPlaceholder(placeholderPools.source);
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([sourcesState, statementsState, transactionsState, personsState]);
  const validDay = (day: number | null) => day != null && isMonthDay(day);
  // A statement that closes on the day it is due has no period at all, and
  // "ayın sonu" is day 31 — so typing 31 opposite the month-end chip is the
  // same collision written a different way. Beyond that, the gap itself has to
  // look like a card cycle; `CardCycleFields` owns both rules and shows why.
  const cycleValid = sourceType !== "credit_card"
    || (validDay(statementDay) && validDay(dueDay) && cardCycleError(statementDay, dueDay) === null);
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
    confirmDiscard(() => {
      setEditingId(src.id);
      setName(src.name);
      setSourceType(src.type);
      setPersonChoice(src.personId);
      setDueDayStr(src.dueDay != null ? String(src.dueDay) : "");
      setStatementDayStr(src.statementDay != null ? String(src.statementDay) : "");
    });
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
  const editingStatementIds = new Set(editingStatements.map((statement) => statement.id));
  const statementAmountById = new Map<string, number>();
  if (editingStatementIds.size > 0) {
    for (const transaction of transactions) {
      const statementId = transaction.cardStatementId;
      if (!statementId || !editingStatementIds.has(statementId)) continue;
      statementAmountById.set(
        statementId,
        (statementAmountById.get(statementId) ?? 0) + transaction.amountTryMinor,
      );
    }
  }
  const replacementOptions = resolving ? eligibleReplacements(resolving.source.id, resolving.usage) : [];
  const cardReplacementRequired = Boolean(resolving && resolving.usage.cardInstallmentPlans > 0);

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
      <WorkspaceSplit
        testID="payment-sources-workspace"
        wideLayout={sources.length === 0 ? "stack" : "split"}
        primary={(
          <View>
          <Card>
        <PanelHeader
          icon={sourceIcon(sourceType)}
          title={editingId ? tr.sources.editTitle : tr.sources.formTitle}
          description={editingId ? tr.sources.editHint(name || tr.sources.formTitle) : tr.sources.formHint}
        />
        <Field label={tr.onboarding.addSource} value={name} onChangeText={setName} placeholder={sourcePlaceholder} />
        <SourceTypePicker value={sourceType} onChange={setSourceType} />
        <PersonAssignment people={persons} value={personId} onChange={setPersonChoice} />
        {sourceType === "credit_card" ? (
          <CardCycleFields
            statementDayValue={statementDayStr}
            dueDayValue={dueDayStr}
            onStatementDayChange={setStatementDayStr}
            onDueDayChange={setDueDayStr}
          />
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
          <PanelHeader icon={ReceiptText} title={tr.sources.statementHistory} description={tr.sources.statementHistoryHint} />
          {editingStatements.map((statement) => {
            const amount = statementAmountById.get(statement.id) ?? 0;
            return (
              <Spread key={statement.id} style={{ paddingVertical: spacing.xs, alignItems: "center" }}>
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Body>{monthLabel(statement.periodMonth)}</Body>
                  <Body muted>{tr.sources.statementDates(dateLabel(statement.statementDate), dateLabel(statement.dueDate))}</Body>
                </View>
                <Amount
                  minor={amount}
                  colorized={false}
                  accessibilityLabel={formatMinorCompact(amount)}
                  style={{ textAlign: "right" }}
                />
              </Spread>
            );
          })}
            </Card>
          ) : null}
          </View>
        )}
        secondary={(
          <View>
          {resolving ? (
            <Card>
          <PanelHeader
            icon={Trash2}
            title={tr.references.sourceInUse(resolving.source.name)}
            description={tr.references.resolveBeforeDelete}
          />
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

          {sources.length === 0 ? (
            <EmptyState icon={WalletCards} title={tr.sources.emptyTitle} hint={tr.sources.emptyHint} />
          ) : (
            <>
              <SectionHeader description={tr.sources.listHint}>{tr.sources.listTitle}</SectionHeader>
              <CardList
                items={sources}
                keyExtractor={(s) => s.id}
                renderItem={(s) => (
          <Spread style={{ paddingVertical: spacing.sm, alignItems: "center" }}>
            <Row style={{ flex: 1, alignItems: "center" }}>
              <SourceGlyph sourceType={s.type} />
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
              <IconButton icon={Pencil} label={`${tr.common.edit} · ${s.name}`} onPress={() => startEdit(s)} />
              <IconButton icon={Trash2} tone="danger" label={`${tr.common.delete} · ${s.name}`} haptic="none" onPress={() => void remove(s)} />
            </Row>
          </Spread>
                )}
              />
            </>
          )}
          </View>
        )}
      />
    </Screen>
  );
}
