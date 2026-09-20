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
import { Amount, Badge, Body, Button, Card, CardList, ChipPicker, ChoiceTile, CardListSkeleton, DataGateScreen, DataStateNotice, EmptyState, Field, IconButton, PanelHeader, Row, Screen, SectionHeader, Spread, useLedeAlignment } from "../../../ui/components";
import { placeholderPools, useRotatingPlaceholder } from "../../../ui/placeholders";
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
import { isValidCardCycle } from "../../../domain/card-statements";
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

/**
 * One payment source, with its mark level with its NAME.
 *
 * A row in this list is one to four lines tall — name, type, owner, and a
 * credit card's cycle badges — and centring a 44px mark against all of that
 * dropped it beside the third line on a card and beside the first on cash, so
 * no two rows in the list agreed on where a logo sits. `useLedeAlignment` is
 * the rule the rest of the app already uses: centre against the text while it
 * is short, and stop travelling past three lines.
 *
 * It is a component rather than a branch inside `renderItem` because that hook
 * cannot run in a render callback the list calls once per item.
 */
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
          <Body muted style={{ marginTop: 1 }}>{TYPES.find((t) => t.value === source.type)?.label}</Body>
          {ownerName ? (
            <Body muted style={{ marginTop: 1 }}>
              {tr.sources.owner}: {ownerName}
            </Body>
          ) : null}
          {source.type === "credit_card" ? (
            <Row gap={spacing.xs} style={{ flexWrap: "wrap", marginTop: spacing.xs, alignItems: "center" }}>
              {source.statementDay && source.dueDay ? (
                <>
                  {/* The ring answers what the two numbers leave open:
                      whether a purchase made now lands on the statement
                      about to close or the next one. Side by side it
                      also says which card is freshest. */}
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
  // A statement that closes on the day it is due has no period at all, and
  // "ayın sonu" is day 31 — so typing 31 opposite the month-end chip is the
  // same collision written a different way. Beyond that, the gap itself has to
  // look like a card cycle; `CardCycleFields` owns both rules and shows why.
  const cycleValid = sourceType !== "credit_card"
    || (statementDay != null && isMonthDay(statementDay) && dueDay != null && isMonthDay(dueDay) && cardCycleError(statementDay, dueDay) === null);
  const valid = Boolean(name.trim() && personId && cycleValid);

  const fill = (source: Source | null) => {
    setEditingId(source?.id ?? null);
    setName(source?.name ?? "");
    setSourceType(source?.type ?? "credit_card");
    setPersonChoice(source?.personId ?? null);
    setDueDayStr(source?.dueDay != null ? String(source.dueDay) : "");
    setStatementDayStr(source?.statementDay != null ? String(source.statementDay) : "");
  };

  const save = () => operationGuard.run(async () => {
    if (!valid || !personId) return;
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
    valid, save, reset: () => fill(null), startEdit: (source: Source) => confirmDiscard(() => fill(source)),
  };
}

/** Deleting a source: at once when nothing uses it, else after choosing where its records go. */
function useSourceRemoval(sources: Source[], [busy, setBusy]: Busy) {
  const userId = useUserId();
  const undo = useUndo();
  const [resolving, setResolving] = useState<{ source: Source; usage: PaymentSourceReferenceUsage } | null>(null);
  const [replacementChoice, setReplacementChoice] = useState<string>(NO_SOURCE);
  // A card instalment plan can only move to another card with a cycle.
  const eligible = (sourceId: string, usage: PaymentSourceReferenceUsage) =>
    sources.filter((source) => source.id !== sourceId && (usage.cardInstallmentPlans === 0 || (source.type === "credit_card" && isValidCardCycle(source))));

  const remove = async (source: Source) => {
    if (busy) return;
    setBusy(true);
    try {
      const usage = await paymentSourceReferenceUsage(userId, source.id);
      if (usage.total > 0) {
        setResolving({ source, usage });
        setReplacementChoice(eligible(source.id, usage)[0]?.id ?? NO_SOURCE);
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

  return { resolving, cancel: () => setResolving(null), replacementChoice, setReplacementChoice, remove, reassign, options: resolving ? eligible(resolving.source.id, resolving.usage) : [] };
}

function SourceInUseCard({ removal, busy }: { removal: ReturnType<typeof useSourceRemoval>; busy: boolean }) {
  const { resolving, replacementChoice } = removal;
  if (!resolving) return null;
  const cardRequired = resolving.usage.cardInstallmentPlans > 0;
  const usageRows = ([
    [tr.references.installmentPlans, resolving.usage.installmentPlans],
    [tr.references.transactions, resolving.usage.transactions],
    [tr.references.subscriptions, resolving.usage.subscriptions],
  ] as const).filter(([, count]) => count > 0);
  return (
    <Card>
      <PanelHeader icon={Trash} title={tr.references.sourceInUse(resolving.source.name)} description={tr.references.resolveBeforeDelete} />
      {usageRows.map(([label, count]) => (
        <Spread key={label} style={{ marginBottom: spacing.xs }}>
          <Body muted>{label}</Body>
          <Body>{String(count)}</Body>
        </Spread>
      ))}
      <Body style={{ marginTop: spacing.sm, marginBottom: spacing.sm }}>{tr.references.chooseSource}</Body>
      {cardRequired ? <Body muted style={{ marginBottom: spacing.sm }}>{tr.references.cardReplacementRequired}</Body> : null}
      <ChipPicker
        options={[
          ...(!cardRequired ? [{ value: NO_SOURCE, label: tr.references.noSource }] : []),
          ...removal.options.map((source) => ({ value: source.id, label: source.name })),
        ]}
        value={replacementChoice}
        onChange={removal.setReplacementChoice}
      />
      <Row>
        <View style={{ flex: 1 }}>
          <Button
            label={tr.references.reassignAndDelete}
            onPress={() => void removal.reassign()}
            disabled={busy || (cardRequired && replacementChoice === NO_SOURCE)}
            loading={busy}
          />
        </View>
        <Button label={tr.common.cancel} variant="ghost" onPress={removal.cancel} disabled={busy} />
      </Row>
    </Card>
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
  const ids = new Set(statements.map((statement) => statement.id));
  const amountById = new Map<string, number>();
  for (const transaction of transactions) {
    const statementId = transaction.cardStatementId;
    if (statementId && ids.has(statementId)) amountById.set(statementId, (amountById.get(statementId) ?? 0) + transaction.amountTryMinor);
  }
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

function SourceFormCard({ form, persons, busy }: { form: ReturnType<typeof useSourceForm>; persons: { id: string; name: string }[]; busy: boolean }) {
  const sourcePlaceholder = useRotatingPlaceholder(placeholderPools.source);
  const saveButton = <Button label={form.editingId ? tr.common.save : tr.common.add} onPress={() => void form.save()} disabled={!form.valid || busy} loading={busy} />;
  return (
    <Card>
      <PanelHeader
        icon={sourceIcon(form.sourceType)}
        title={form.editingId ? tr.sources.editTitle : tr.sources.formTitle}
        description={form.editingId ? tr.sources.editHint(form.name || tr.sources.formTitle) : tr.sources.formHint}
      />
      {/* The mark resolves from the name as it is typed, the same live preview
          the subscription form gives. It is the FIELD's leading mark: wrapping
          the field centred it against label and input, above the box it names. */}
      <View style={{ marginBottom: spacing.sm }}>
        <Field
          noMargin
          leading={<PaymentSourceLogo name={form.name || tr.sources.formTitle} type={form.sourceType} size={46} />}
          label={tr.onboarding.addSource}
          value={form.name}
          onChangeText={form.setName}
          placeholder={sourcePlaceholder}
        />
      </View>
      <SourceTypePicker value={form.sourceType} onChange={form.setSourceType} />
      <PersonAssignment people={persons} value={form.personId} onChange={form.setPersonChoice} />
      {form.sourceType === "credit_card" ? (
        <CardCycleFields
          statementDayValue={form.statementDayStr}
          dueDayValue={form.dueDayStr}
          onStatementDayChange={form.setStatementDayStr}
          onDueDayChange={form.setDueDayStr}
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
