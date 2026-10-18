/** Payment source management: cards / cash / bank, per-person, card cycle. */

import { useState } from "react";
import { View } from "react-native";
import { PaymentSourceLogo } from "../../../ui/logo";
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
import Trash from "lucide-react-native/icons/trash";
import WalletCards from "lucide-react-native/icons/wallet-cards";
import type { LucideIcon } from "lucide-react-native";
import { Amount, Badge, Body, Button, Card, CardList, ChoiceTile, CardListSkeleton, DataGateScreen, DataStateNotice, EmptyState, Field, IconButton, PanelHeader, Row, Screen, SectionHeader, Spread, useLedeAlignment } from "../../../ui/components";
import { ReferenceInUseCard } from "../../../ui/category-delete-sheet";
import { useRotatingPlaceholder } from "../../../ui/placeholders";
import { useUndo } from "../../../ui/undo";
import { spacing, type, useTheme } from "../../../ui/theme";
import { appAlert, appConfirm } from "../../../ui/dialog";
import { useOperationGuard } from "../../../ui/operation-guard";
import { useDirtyExitGuard } from "../../../ui/dirty-exit";
import { WorkspaceSplit } from "../../../ui/workspace-layout";
import { isMonthDay } from "../../../domain/dates";
import { monthDayLabel } from "../../../ui/month-day-field";
import { CardCycleFields, CardCycleRing, cardCycleError } from "../../../ui/card-cycle-fields";
import { selectionTapIfChanged } from "../../../ui/haptics";
import { assignedPersonId, PersonAssignment } from "../../../ui/person-assignment";
import { isValidCardCycle, statementAmounts } from "../../../domain/card-statements";
import { shouldUseTripleTileGrid } from "../../../ui/responsive";

const TYPES = PAYMENT_SOURCE_TYPES.map((value) => ({ value, label: tr.sources[value] }));
const NO_SOURCE = "__none__";
/** The list mark's size, shared by the logo and the alignment that centres it. */
const SOURCE_MARK = 44;

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
            // The credit card takes the double-width tile, leaving an even six below.
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

/** One source row, its mark level with the name (useLedeAlignment). A component because the hook cannot run inside renderItem. */
function PaymentSourceRow({
  source,
  ownerName,
  onEdit,
  onDelete,
}: {
  source: {
    name: string;
    type: PaymentSourceType;
    logoRef: string | null;
    statementDay: number | null;
    dueDay: number | null;
  };
  /** Null when the workspace has one person and the line would say nothing. */
  ownerName: string | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const lede = useLedeAlignment(SOURCE_MARK);
  return (
    <Spread style={{ paddingVertical: spacing.sm, alignItems: "flex-start" }}>
      <Row gap={spacing.md} style={{ flex: 1, alignItems: "flex-start" }}>
        <View style={lede.markStyle}>
          <PaymentSourceLogo name={source.name} type={source.type} logoRef={source.logoRef} size={SOURCE_MARK} />
        </View>
        <View style={{ flex: 1, minWidth: 0, ...lede.textStyle }} onLayout={lede.onBlockLayout}>
          <Body onLayout={lede.onLineLayout}>{source.name}</Body>
          <Body muted style={{ marginTop: 1 }}>{tr.sources[source.type]}</Body>
          {ownerName ? (
            <Body muted style={{ marginTop: 1 }}>
              {tr.sources.owner}: {ownerName}
            </Body>
          ) : null}
          {source.type === "credit_card" ? (
            <Row gap={spacing.xs} style={{ flexWrap: "wrap", marginTop: spacing.xs, alignItems: "center" }}>
              {source.statementDay && source.dueDay ? (
                <>
                  {/* The ring shows whether a purchase now lands on this statement or the next. */}
                  <CardCycleRing statementDay={source.statementDay} dueDay={source.dueDay} />
                  <Badge text={`${tr.sources.statementDayShort}: ${monthDayLabel(source.statementDay)}`} />
                  <Badge text={`${tr.sources.dueDayShort}: ${monthDayLabel(source.dueDay)}`} tone="primary" />
                </>
              ) : (
                <Badge text={tr.sources.cycleMissing} tone="warning" />
              )}
            </Row>
          ) : null}
        </View>
      </Row>
      <View onLayout={lede.onTrailingLayout} style={lede.blockStyle}>
        <Row gap={spacing.sm}>
          <IconButton icon={Pencil} label={`${tr.common.edit} · ${source.name}`} onPress={onEdit} />
          <IconButton icon={Trash} tone="danger" label={`${tr.common.delete} · ${source.name}`} haptic="none" onPress={onDelete} />
        </Row>
      </View>
    </Spread>
  );
}

type Source = ReturnType<typeof useSourcesState>["data"][number];
type Busy = [boolean, (busy: boolean) => void];

/** The add-or-edit form: its fields, whether it would change anything, and saving it. */
function useSourceForm(sources: Source[], persons: { id: string; isSelf: boolean }[], [busy, setBusy]: Busy) {
  const userId = useUserId();
  const operationGuard = useOperationGuard();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<PaymentSourceType>("credit_card");
  const [personChoice, setPersonChoice] = useState<string | null>(null);
  const [dueDayStr, setDueDayStr] = useState("");
  const [statementDayStr, setStatementDayStr] = useState("");
  const personId = assignedPersonId(personChoice, persons);
  const dueDay = dueDayStr.trim() === "" ? null : Number(dueDayStr);
  const statementDay = statementDayStr.trim() === "" ? null : Number(statementDayStr);
  const editing = editingId ? sources.find((source) => source.id === editingId) : null;
  const dirty = editing
    ? name.trim() !== editing.name || sourceType !== editing.type || personId !== editing.personId || dueDay !== editing.dueDay || statementDay !== editing.statementDay
    : Boolean(name.trim() || sourceType !== "credit_card" || personChoice || dueDayStr.trim() || statementDayStr.trim());
  const { confirmDiscard } = useDirtyExitGuard(dirty && !busy);
  // The cycle needs two valid, distinct days that form a card period; CardCycleFields owns and explains both rules.
  const cycleValid = sourceType !== "credit_card"
    || (statementDay != null && isMonthDay(statementDay) && dueDay != null && isMonthDay(dueDay) && cardCycleError(statementDay, dueDay) === null);
  const valid = Boolean(name.trim() && personId && cycleValid);

  // The button stays live: a refused press marks what is missing instead.
  const [attempted, setAttempted] = useState(false);
  const fill = (source: Source | null) => {
    setAttempted(false);
    setEditingId(source?.id ?? null);
    setName(source?.name ?? "");
    setSourceType(source?.type ?? "credit_card");
    setPersonChoice(source?.personId ?? null);
    setDueDayStr(source?.dueDay != null ? String(source.dueDay) : "");
    setStatementDayStr(source?.statementDay != null ? String(source.statementDay) : "");
  };

  const save = () => operationGuard.run(async () => {
    if (busy) return;
    if (!valid || !personId) return setAttempted(true);
    setBusy(true);
    try {
      await upsertPaymentSource(userId, { id: editingId ?? undefined, name, type: sourceType, personId, dueDay, statementDay });
      scheduleSync(userId);
      fill(null);
    } catch (error) {
      void appAlert(error instanceof CreditCardCycleRequiredError ? tr.sources.cycleRequired : tr.errors.saveFailed, tr.errors.title);
    } finally {
      setBusy(false);
    }
  });

  return {
    editingId, name, setName, sourceType, setSourceType, personId, setPersonChoice, dueDayStr, setDueDayStr, statementDayStr, setStatementDayStr,
    valid, attempted, save, reset: () => fill(null), startEdit: (source: Source) => confirmDiscard(() => fill(source)),
  };
}

const cardRequiredFor = (removed: Source, usage: PaymentSourceReferenceUsage) => removed.type === "credit_card" && usage.cardInstallmentPlans > 0;

/** Deleting a source: at once when nothing uses it, else after choosing where its records go. */
function useSourceRemoval(sources: Source[], [busy, setBusy]: Busy) {
  const userId = useUserId();
  const undo = useUndo();
  const [resolving, setResolving] = useState<{ source: Source; usage: PaymentSourceReferenceUsage } | null>(null);
  const [replacementChoice, setReplacementChoice] = useState<string>(NO_SOURCE);
  // A card's instalment plan can only move to another card with a cycle; one
  // paid by hand moves to any source, but to some source, and to a card only with a cycle.
  const eligible = (removed: Source, usage: PaymentSourceReferenceUsage) =>
    sources.filter((source) => source.id !== removed.id && (usage.cardInstallmentPlans === 0
      || (source.type === "credit_card" ? isValidCardCycle(source) : !cardRequiredFor(removed, usage))));

  const remove = async (source: Source) => {
    if (busy) return;
    setBusy(true);
    try {
      const usage = await paymentSourceReferenceUsage(userId, source.id);
      if (usage.total > 0) {
        setResolving({ source, usage });
        setReplacementChoice(eligible(source, usage)[0]?.id ?? NO_SOURCE);
        return;
      }
      if (!(await appConfirm(source.name, tr.references.deleteUnusedSource, { confirmLabel: tr.common.delete, danger: true }))) return;
      const snapshot = await deleteUnreferencedPaymentSource(userId, source.id);
      scheduleSync(userId);
      if (snapshot) undo.show(`${source.name} · ${tr.common.deleted}`, () => restorePaymentSource(userId, snapshot).then(() => scheduleSync(userId)), "warning");
    } catch (error) {
      if (error instanceof ReferencedRecordError) setResolving({ source, usage: await paymentSourceReferenceUsage(userId, source.id) });
      else void appAlert(tr.errors.saveFailed, tr.errors.title);
    } finally {
      setBusy(false);
    }
  };

  const reassign = async () => {
    if (!resolving || busy) return;
    const replacementId = replacementChoice === NO_SOURCE ? null : replacementChoice;
    const replacementName = sources.find((source) => source.id === replacementId)?.name ?? tr.references.noSource;
    const confirmed = await appConfirm(resolving.source.name, tr.references.reassignSourceConfirm(resolving.usage.total, replacementName), {
      confirmLabel: tr.references.reassignAndDelete,
      danger: true,
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await reassignAndDeletePaymentSource(userId, resolving.source.id, replacementId);
      scheduleSync(userId);
      setResolving(null);
      setReplacementChoice(NO_SOURCE);
    } catch (error) {
      void appAlert(error instanceof CreditCardCycleRequiredError ? tr.references.cardReplacementRequired : tr.errors.saveFailed, tr.errors.title);
    } finally {
      setBusy(false);
    }
  };

  return { resolving, cancel: () => setResolving(null), replacementChoice, setReplacementChoice, remove, reassign, options: resolving ? eligible(resolving.source, resolving.usage) : [] };
}

function SourceInUseCard({ removal, busy }: { removal: ReturnType<typeof useSourceRemoval>; busy: boolean }) {
  const { resolving, replacementChoice } = removal;
  if (!resolving) return null;
  const cardRequired = cardRequiredFor(resolving.source, resolving.usage);
  const sourceRequired = resolving.usage.cardInstallmentPlans > 0;
  const usageRows = ([
    [tr.references.installmentPlans, resolving.usage.installmentPlans],
    [tr.references.transactions, resolving.usage.transactions],
    [tr.references.subscriptions, resolving.usage.subscriptions],
  ] as const).filter(([, count]) => count > 0);
  return (
    <ReferenceInUseCard
      title={tr.references.sourceInUse(resolving.source.name)}
      rows={usageRows}
      chooseLabel={tr.references.chooseSource}
      note={cardRequired ? tr.references.cardReplacementRequired : undefined}
      options={[
        ...(!sourceRequired ? [{ value: NO_SOURCE, label: tr.references.noSource }] : []),
        ...removal.options.map((source) => ({ value: source.id, label: source.name })),
      ]}
      value={replacementChoice}
      onChange={removal.setReplacementChoice}
      onConfirm={() => void removal.reassign()}
      onCancel={removal.cancel}
      busy={busy}
      confirmDisabled={sourceRequired && replacementChoice === NO_SOURCE}
    />
  );
}

/**
 * A card's recent periods as one row each — month, bar, amount — so which month
 * cost the most is the tallest bar, not a paragraph of dates.
 *
 * Six periods, not every period a card has ever had: a half-year is long enough
 * to see a season and short enough to stay a shape rather than a page.
 */
function StatementHistoryCard({ cardId }: { cardId: string }) {
  const { palette } = useTheme();
  const statements = useCreditCardStatementsState().data
    .filter((statement) => statement.paymentSourceId === cardId)
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  const transactions = useAllTransactionsState().data;
  if (statements.length === 0) return null;
  const amountById = statementAmounts(transactions, new Set(statements.map((statement) => statement.id)));
  const shown = statements.slice(0, 6);
  const largest = shown.reduce((max, statement) => Math.max(max, Math.abs(amountById.get(statement.id) ?? 0)), 0);
  return (
    <Card>
      <PanelHeader icon={ReceiptText} title={tr.sources.statementHistory} description={tr.sources.statementSummary(shown.length, formatMinorCompact(largest))} />
      <View style={{ gap: spacing.sm }}>
        {shown.map((statement) => {
          const amount = amountById.get(statement.id) ?? 0;
          const share = largest > 0 ? Math.max(2, Math.round((Math.abs(amount) / largest) * 100)) : 0;
          const dates = tr.sources.statementDates(dateLabel(statement.statementDate), dateLabel(statement.dueDate));
          return (
            <View key={statement.id} accessible accessibilityLabel={`${monthLabel(statement.periodMonth)} · ${formatMinorCompact(amount)} · ${dates}`} style={{ gap: 5 }}>
              <Spread style={{ alignItems: "center" }}>
                <Body style={{ flex: 1, paddingRight: spacing.sm }}>{monthLabel(statement.periodMonth)}</Body>
                <Amount minor={amount} colorized={false} accessibilityLabel={formatMinorCompact(amount)} style={{ textAlign: "right" }} />
              </Spread>
              <View style={{ height: 4, borderRadius: 2, overflow: "hidden", backgroundColor: palette.surfaceAlt }}>
                <View style={{ width: `${share}%`, height: "100%", borderRadius: 2, backgroundColor: palette.primary }} />
              </View>
              <Body muted style={{ fontSize: type.small.fontSize }}>{dates}</Body>
            </View>
          );
        })}
      </View>
      {statements.length > shown.length ? (
        <Body muted style={{ marginTop: spacing.sm, fontSize: type.small.fontSize }}>{tr.sources.statementMore(statements.length - shown.length)}</Body>
      ) : null}
    </Card>
  );
}

function SourceFormCard({ form, persons, busy }: { form: ReturnType<typeof useSourceForm>; persons: { id: string; name: string; isSelf: boolean }[]; busy: boolean }) {
  const sourcePlaceholder = useRotatingPlaceholder(tr.placeholders.source);
  const saveButton = <Button label={form.editingId ? tr.common.save : tr.common.add} onPress={() => void form.save()} loading={busy} />;
  return (
    <Card>
      <PanelHeader
        icon={sourceIcon(form.sourceType)}
        title={form.editingId ? tr.sources.editTitle : tr.sources.formTitle}
        description={form.editingId ? tr.sources.editHint(form.name || tr.sources.formTitle) : tr.sources.formHint}
      />
      {/* Live logo preview as the field's leading mark, not a wrapper. */}
      <View style={{ marginBottom: spacing.sm }}>
        <Field
          noMargin
          leading={<PaymentSourceLogo name={form.name || tr.sources.formTitle} type={form.sourceType} size={46} />}
          label={tr.onboarding.addSource}
          value={form.name}
          onChangeText={form.setName}
          placeholder={sourcePlaceholder}
          error={form.attempted && !form.name.trim() ? tr.required.name : null}
        />
      </View>
      <SourceTypePicker value={form.sourceType} onChange={form.setSourceType} />
      <PersonAssignment label={tr.tx.personOwner} people={persons} value={form.personId} onChange={form.setPersonChoice} />
      {form.sourceType === "credit_card" ? (
        <CardCycleFields
          statementDayValue={form.statementDayStr}
          dueDayValue={form.dueDayStr}
          onStatementDayChange={form.setStatementDayStr}
          onDueDayChange={form.setDueDayStr}
          attempted={form.attempted}
        />
      ) : null}
      {form.editingId ? (
        <Row>
          <View style={{ flex: 1 }}>{saveButton}</View>
          <Button label={tr.common.cancel} variant="ghost" onPress={form.reset} />
        </Row>
      ) : saveButton}
    </Card>
  );
}

export default function SourcesScreen() {
  const sourcesState = useSourcesState();
  const statementsState = useCreditCardStatementsState();
  const transactionsState = useAllTransactionsState();
  const personsState = usePersonsState();
  const sources = sourcesState.data;
  const persons = personsState.data;
  const busy = useState(false);
  const form = useSourceForm(sources, persons, busy);
  const removal = useSourceRemoval(sources, busy);
  const { status, ready, retry } = combineLiveStates([sourcesState, statementsState, transactionsState, personsState]);
  if (!ready) return <DataGateScreen status={status} retry={retry} skeleton={<CardListSkeleton />} />;
  return (
    <Screen width="workspace">
      <DataStateNotice status={status} retry={retry} />
      <WorkspaceSplit
        testID="payment-sources-workspace"
        wideLayout={sources.length === 0 ? "stack" : "split"}
        primary={(
          <View>
            <SourceFormCard form={form} persons={persons} busy={busy[0]} />
            {form.editingId && form.sourceType === "credit_card" ? <StatementHistoryCard cardId={form.editingId} /> : null}
          </View>
        )}
        secondary={(
          <View>
            <SourceInUseCard removal={removal} busy={busy[0]} />
            {sources.length === 0 ? (
              <EmptyState icon={WalletCards} title={tr.sources.emptyTitle} hint={tr.sources.emptyHint} />
            ) : (
              <>
                <SectionHeader description={tr.sources.listHint}>{tr.sources.listTitle}</SectionHeader>
                <CardList
                  items={sources}
                  keyExtractor={(s) => s.id}
                  renderItem={(s) => (
                    <PaymentSourceRow
                      source={s}
                      ownerName={persons.length > 1 ? persons.find((p) => p.id === s.personId)?.name ?? tr.common.none : null}
                      onEdit={() => form.startEdit(s)}
                      onDelete={() => void removal.remove(s)}
                    />
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
