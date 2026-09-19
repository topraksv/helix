/** Transaction entry modal — smart defaults, TR amount input, FX preview,
 *  future-dated payments (§2.7) and inline installment plan creation. */

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import ArrowDownLeft from "lucide-react-native/icons/arrow-down-left";
import ArrowUpRight from "lucide-react-native/icons/arrow-up-right";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal";
import TrendingUp from "lucide-react-native/icons/trending-up";
import Undo2 from "lucide-react-native/icons/undo-2";
import WalletCards from "lucide-react-native/icons/wallet-cards";
import type { LucideIcon } from "lucide-react-native";
import { addTransaction, createInstallmentPlan, CreditCardCycleRequiredError, RefundExceedsExpenseError, updateTransaction } from "../data/repo";
import {
  useAllTransactionsState,
  useAttachmentsState,
  useCategoriesState,
  useInvestmentCategoriesState,
  useInvestmentOperationsState,
  useInvestmentProductsState,
  useInvestmentProfilesState,
  useInvestmentWalletSnapshot,
  usePersonsState,
  useSourcesState,
  useUserId,
  useAnsweredForId,
} from "../data/hooks";
import { combineLiveStates } from "../data/live-state";
import { classifyRecordId } from "../domain/route-params";
import { previewTryMinor, resolveTransactionSave } from "../domain/transaction-draft";
import { assertISODate, isISODate, lastDayOf, monthKeyOf, todayISO, type ISODate, type MonthKey } from "../domain/dates";
import { isValidCardCycle, statementForPurchase, statementPeriod } from "../domain/card-statements";
import { formatMinorCompact, formatMinorInput } from "../domain/money";
import { installmentSplitText } from "../ui/installment-text";
import { currencyLabel } from "../domain/fx-provider";
import { deriveStartMonth, isValidInstallmentCount } from "../domain/installments";
import { lookupRate, useFxRates } from "../services/fx-fetch";
import { categoryIconComponent,  } from "../ui/category-icon";
import { PaymentSourceLogo } from "../ui/logo";
import { CurrencyPicker } from "../ui/currency-picker";
import { scheduleSync } from "../sync/engine";
import { dateLabel, monthLabel, tr } from "../i18n/tr";
import { Amount, Badge, Body, Button, Card, CardList, ChipPicker, ChoiceTile, DataGateScreen, DataStateNotice, Divider, Field, FieldNote, HeroCard, InlineDisclosure, Label, ListRow, MetricStrip, MoneyField, MonthStepper, PanelHeader, Row, Screen, SectionHeader, Select, Toggle } from "../ui/components";
import { useSubmitOnEnter } from "../ui/keyboard";
import { appAlert } from "../ui/dialog";
import { DateField } from "../ui/calendar";
import { kv } from "../services/kv";
import { placeholderPools, useRotatingPlaceholder } from "../ui/placeholders";
import { radius, spacing, type, useTheme } from "../ui/theme";
import { selectionTapIfChanged } from "../ui/haptics";
import { navigateBack } from "../ui/navigation";
import { buildSaveSummary, type SavedTransaction, type SaveSummary } from "../domain/save-summary";
import { provenanceOf } from "../domain/provenance";
import { AttachmentPanel } from "../ui/attachment-panel";
import { devError } from "../services/logger";
import { useOperationGuard } from "../ui/operation-guard";
import { useUndo } from "../ui/undo";
import { useDirtyExitGuard, useDraftDirty } from "../ui/dirty-exit";
import { WorkspaceSplit } from "../ui/workspace-layout";
import { assignedPersonId, PersonAssignment } from "../ui/person-assignment";

/** The Select's own icon column, so a source mark fits it exactly. */
const SOURCE_MARK = 22;

/** What an expense paid from an account says when it is a card bill. */
const CARD_BILL = /kredi\s*kart|kart\s*(borc|borç|ekstre|ödeme|odeme)|ekstre/i;

type EntryType = "expense" | "income" | "transfer";

type ExistingTx = ReturnType<typeof useAllTransactionsState>["data"][number];
type ExistingSource = ReturnType<typeof useSourcesState>["data"][number];

function EntryTypeChoice({
  label,
  icon: Icon,
  tone,
  selected,
  onPress,
}: {
  label: string;
  icon: LucideIcon;
  tone: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <ChoiceTile label={label} selected={selected} onPress={onPress} tone={tone}>
      <View style={{ width: 30, height: 30, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: tone + "1A" }}>
        <Icon accessible={false} size={17} color={tone} strokeWidth={2.2} />
      </View>
    </ChoiceTile>
  );
}

/**
 * The expense a new refund is opened for (spec §2.7). Only a live, positive,
 * single expense can take one — the repository holds the same rule — and while
 * the rows are still loading the screen waits instead of opening a plain form.
 */
function refundTargetOf(
  state: { data: ExistingTx[]; status: string },
  record: NonNullable<ReturnType<typeof classifyRecordId>>,
  refundOf: string | undefined,
  intent: string | undefined,
) {
  const wanted = record.mode === "new" ? refundOf : undefined;
  const target = wanted
    ? state.data.find((row) => row.id === wanted && row.type === "expense" && row.amountMinor > 0 && !row.installmentPlanId && !row.refundOfTransactionId)
    : undefined;
  return {
    target,
    /** The key a form that is not an edit mounts under, so each kind of new entry starts clean. */
    newFormKey: target ? `refund-${target.id}` : `new-${intent ?? "default"}`,
    waiting: Boolean(wanted) && !target && state.status === "loading",
  };
}

export default function TransactionModal() {
  const { id, intent, refundOf } = useLocalSearchParams<{ id?: string; intent?: string; refundOf?: string }>();
  const record = classifyRecordId(id);
  const txState = useAllTransactionsState();
  const existing = record?.mode === "edit" ? txState.data.find((t) => t.id === record.id) : undefined;
  const answeredForThisId = useAnsweredForId(txState, record, existing != null);
  if (!record) return <Redirect href="/(tabs)/cash-flow" />;
  if (record.mode === "edit" && !existing) {
    if (!answeredForThisId) {
      return (
        <Screen scroll={false}>
          <DataStateNotice status={txState.status} retry={txState.retry} />
        </Screen>
      );
    }
    return <Redirect href="/(tabs)/cash-flow" />;
  }
  if (existing?.installmentPlanId) {
    return <Redirect href={{ pathname: "/installment-new", params: { id: existing.installmentPlanId } }} />;
  }
  if (intent === "investment-refund" && record.mode === "new") {
    return <InvestmentRefundForm transactionsState={txState} />;
  }
  const refund = refundTargetOf(txState, record, refundOf, intent);
  if (refund.waiting) {
    return (
      <Screen scroll={false}>
        <DataStateNotice status={txState.status} retry={txState.retry} />
      </Screen>
    );
  }
  return (
    <TransactionForm
      key={existing?.id ?? refund.newFormKey}
      existing={existing}
      refundOf={refund.target}
      investmentRefund={intent === "investment-refund"}
    />
  );
}

function InvestmentRefundForm({ transactionsState }: { transactionsState: ReturnType<typeof useAllTransactionsState> }) {
  const userId = useUserId();
  const router = useRouter();
  const { palette } = useTheme();
  const operationGuard = useOperationGuard();
  const profilesState = useInvestmentProfilesState();
  const productsState = useInvestmentProductsState();
  const operationsState = useInvestmentOperationsState();
  const categoriesState = useInvestmentCategoriesState();
  const personsState = usePersonsState();
  const { status, ready, retry } = combineLiveStates([profilesState, productsState, operationsState, categoriesState, personsState, transactionsState]);
  const profile = profilesState.data[0];
  const walletSnapshot = useInvestmentWalletSnapshot();
  const wallet = walletSnapshot.data;
  const transferCategories = categoriesState.data.filter((category) => category.isTransfer && category.deletedAt == null);
  const selfPerson = personsState.data.find((person) => person.isSelf) ?? personsState.data[0];
  const [amountMode, setAmountMode] = useState<"all" | "partial">("all");
  const [amountRaw, setAmountRaw] = useState("");
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [dateMode, setDateMode] = useState<"month" | "day">("day");
  const [monthKey, setMonthKey] = useState<MonthKey>(monthKeyOf(todayISO()));
  const [dateStr, setDateStr] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const amountPlaceholder = useRotatingPlaceholder(placeholderPools.amount, { active: amountRaw.length === 0 });
  React.useEffect(() => {
    if (categoryId || transferCategories.length !== 1) return;
    setCategoryId(transferCategories[0]!.id);
  }, [categoryId, transferCategories]);
  const selectedAmount = amountMode === "all" ? wallet?.cashMinor ?? null : amountMinor;
  const amountError = amountMode === "partial" && selectedAmount != null && wallet && selectedAmount > wallet.cashMinor
    ? tr.investments.refundExceedsCash(formatMinorCompact(wallet.cashMinor))
    : null;
  const dateless = dateMode === "month";
  const effectiveDate = dateless ? `${monthKey}-01` : dateStr;
  const dateValid = dateless || isISODate(dateStr);
  const canSave = ready
    && wallet != null
    && selectedAmount != null
    && selectedAmount > 0
    && selectedAmount <= wallet.cashMinor
    && categoryId != null
    && selfPerson != null
    && dateValid
    && !busy;
  const draftSnapshot = JSON.stringify({ amountMode, amountRaw, categoryId, dateMode, monthKey, dateStr });
  // The baseline is the form as the DATA leaves it, not as the first render
  // leaves it: the single transfer category is assigned by an effect once the
  // categories load, so a snapshot taken on mount differed from the very next
  // one and the screen declared itself dirty before the user had touched
  // anything.
  const settled = ready && (transferCategories.length !== 1 || categoryId != null);
  const { allowExit } = useDirtyExitGuard(useDraftDirty(draftSnapshot, settled) && !busy);
  const close = () => navigateBack(router, "/(tabs)/investments");

  const save = async () => {
    if (!canSave || !selectedAmount || !categoryId || !selfPerson) return;
    await operationGuard.run(async () => {
      setBusy(true);
      try {
        assertISODate(effectiveDate);
        await addTransaction(userId, {
          type: "transfer",
          amountMinor: -selectedAmount,
          currency: "TRY",
          fxRate: null,
          amountTryMinor: -selectedAmount,
          effectiveDate,
          isAggregate: dateless,
          categoryId,
          paymentSourceId: null,
          personId: selfPerson.id,
          note: null,
        });
        scheduleSync(userId);
        allowExit(close);
      } catch (error) {
        devError("investment.refund", error);
        void appAlert(tr.errors.saveFailed, tr.errors.title);
      } finally {
        setBusy(false);
      }
    });
  };

  if (!ready) {
    return (
      <Screen>
        <Stack.Screen options={{ title: tr.investments.refundTitle }} />
        <DataStateNotice status={status} retry={retry} />
      </Screen>
    );
  }
  if (!profile) return <Redirect href="/(tabs)/investments" />;
  if (walletSnapshot.error) {
    return (
      <Screen>
        <Stack.Screen options={{ title: tr.investments.refundTitle }} />
        <DataStateNotice status="stale" retry={retry} />
      </Screen>
    );
  }

  return (
    <Screen width="workspace">
      <Stack.Screen options={{ title: tr.investments.refundTitle }} />
      <Card style={{ marginBottom: spacing.lg }}>
        <PanelHeader icon={WalletCards} title={tr.investments.refundAmountTitle} description={tr.investments.refundAmountHint} />
        <View style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: palette.primarySoft, marginBottom: spacing.md }}>
          <Text style={[type.small, { color: palette.primaryText }]}>{tr.investments.cash}</Text>
          <Amount
            testID="investment-refund-cash-amount"
            minor={wallet?.cashMinor ?? 0}
            large
            colorized={false}
            accessibilityLabel={formatMinorCompact(wallet?.cashMinor ?? 0)}
            style={{ color: palette.textStrong, marginTop: 2 }}
          />
        </View>
        <ChipPicker
          value={amountMode}
          onChange={setAmountMode}
          options={[
            { value: "all", label: tr.investments.refundAll },
            { value: "partial", label: tr.investments.refundPartial },
          ]}
        />
        {amountMode === "partial" ? (
          <MoneyField
            label={tr.investments.refundPartialAmount}
            value={amountRaw}
            error={amountError}
            placeholder={amountPlaceholder}
            onChangeMinor={(raw, minor) => {
              setAmountRaw(raw);
              setAmountMinor(minor);
            }}
          />
        ) : null}
      </Card>
      <Card style={{ marginBottom: spacing.lg }}>
        <PanelHeader icon={CalendarClock} title={tr.investments.refundDestinationTitle} description={tr.investments.refundDestinationHint} />
        <Select
          testID="transaction-category"
          label={tr.tx.category}
          placeholder={tr.tx.categoryPlaceholder}
          options={transferCategories.map((category) => ({ value: category.id, label: category.name, icon: categoryIconComponent(category) }))}
          value={categoryId}
          onChange={setCategoryId}
          onCreate={{ label: tr.tx.addCategory, run: () => router.push("/columns-editor") }}
        />
        <Label>{tr.tx.whenLabel}</Label>
        <ChipPicker
          value={dateMode}
          onChange={setDateMode}
          options={[
            { value: "month", label: tr.tx.monthOnly },
            { value: "day", label: tr.tx.specificDay },
          ]}
        />
        {dateless ? <MonthStepper value={monthKey} onChange={setMonthKey} /> : <DateField label={tr.tx.effectiveDate} value={dateStr} onChange={setDateStr} />}
      </Card>
      <Button label={tr.investments.refundAction} icon={ArrowUpRight} disabled={!canSave} loading={busy} onPress={() => void save()} />
    </Screen>
  );
}

/**
 * The refunds recorded against one expense, and what it comes to after them
 * (spec §2.7). A refund stays its own row in its own month; the link only says
 * which purchase it gave money back for.
 */
function ExpenseRefunds({ expense }: { expense: ExistingTx }) {
  const router = useRouter();
  const transactionsState = useAllTransactionsState();
  const refunds = transactionsState.data
    .filter((row) => row.refundOfTransactionId === expense.id)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const refundedTryMinor = -refunds.reduce((sum, row) => sum + row.amountTryMinor, 0);
  const leftMinor = expense.amountMinor + refunds.reduce((sum, row) => sum + row.amountMinor, 0);
  return (
    <>
      <Card>
        <PanelHeader icon={Undo2} title={tr.tx.refundsTitle} description={tr.tx.refundsHint} />
        {refunds.length > 0 ? (
          <MetricStrip
            items={[
              { label: tr.tx.refundsPurchase, minor: expense.amountTryMinor },
              { label: tr.tx.refundsTotal, minor: -refundedTryMinor },
              { label: tr.tx.refundsNet, minor: expense.amountTryMinor - refundedTryMinor },
            ]}
          />
        ) : (
          <Body muted>{tr.tx.refundsEmpty}</Body>
        )}
        {leftMinor > 0 ? (
          <View style={{ marginTop: spacing.md }}>
            <Button
              icon={Undo2}
              variant="secondary"
              label={tr.tx.refundAdd}
              onPress={() => router.push({ pathname: "/transaction", params: { refundOf: expense.id } })}
            />
          </View>
        ) : null}
      </Card>
      <CardList
        items={refunds}
        keyExtractor={(row) => row.id}
        renderItem={(row) => (
          <ListRow
            title={formatMinorCompact(-row.amountMinor, row.currency)}
            subtitle={[dateLabel(row.effectiveDate), row.note].filter(Boolean).join(" · ")}
            chevron
            onPress={() => router.push({ pathname: "/transaction", params: { id: row.id } })}
          />
        )}
      />
    </>
  );
}

/** What an entry opens as: the row being edited, the expense a refund is for, or a fresh expense. */
function initialEntry(existing: ExistingTx | undefined, refundOf: ExistingTx | undefined, investmentRefund: boolean) {
  // A refund takes its expense's currency, category, source and person: the
  // repository refuses a link across currencies, and the rest is what the
  // statement that credits it will say. An edit is never a new refund.
  const basis = existing ?? refundOf;
  const currency = basis?.currency ?? "TRY";
  const reversed = existing != null && existing.amountMinor < 0;
  const occurrence = existing?.purchaseDate ?? existing?.effectiveDate ?? todayISO();
  return {
    entryType: (existing?.type ?? (investmentRefund ? "transfer" : "expense")) as EntryType,
    amountRaw: existing ? formatMinorInput(Math.abs(existing.amountMinor)) : "",
    amountMinor: existing ? Math.abs(existing.amountMinor) : null as number | null,
    isReversal: reversed || investmentRefund || refundOf != null,
    currency,
    showCurrency: currency !== "TRY",
    showAmountOptions: reversed || currency !== "TRY" || refundOf != null,
    categoryId: basis?.categoryId ?? null,
    sourceId: basis?.paymentSourceId ?? null,
    personChoice: basis?.personId ?? null,
    // New entries default to today so the amount reaches the balance at once;
    // a dateless row (isAggregate) reopens by its month.
    dateMode: (existing?.isAggregate ? "month" : "day") as "month" | "day",
    monthKey: monthKeyOf(occurrence),
    dateStr: occurrence,
    note: existing?.note ?? "",
    installment: false,
    countStr: "2",
    paidStr: "0",
  };
}

type Entry = ReturnType<typeof initialEntry>;

/** A category an entry of `type` may be filed under. */
const acceptsEntry = (category: { kind: string; isTransfer: boolean }, type: EntryType) =>
  category.kind === (type === "income" ? "income" : "expense") && (type !== "transfer" || category.isTransfer);

/** The day whose rate prices the entry: its own day, or its month's last — today while that month is still running. */
function rateDateOf(entry: Entry, today: ISODate): ISODate {
  if (entry.dateMode === "day") return isISODate(entry.dateStr) ? entry.dateStr : today;
  return entry.monthKey === monthKeyOf(today) ? today : lastDayOf(entry.monthKey);
}

/** Why a refund cannot be written against `link`, as the repository will judge it, or null. */
function refundProblemOf(entry: Entry, link: ExistingTx | undefined, leftMinor: number, opened: boolean): string | null {
  if (!link || !(opened || entry.isReversal)) return null;
  if (!entry.isReversal || entry.entryType !== "expense" || entry.currency !== link.currency) return tr.tx.refundMismatch;
  return entry.amountMinor != null && entry.amountMinor > leftMinor ? tr.tx.refundTooLarge(formatMinorCompact(leftMinor, link.currency)) : null;
}

/** A new entry's category and source: the last ones used for its kind, or the one investment category there is. */
function useEntryDefaults({ fresh, ready, entry, patch, categories, sources }: {
  fresh: boolean;
  ready: boolean;
  entry: Entry;
  patch: (next: Partial<Entry>) => void;
  categories: { id: string; kind: string; isTransfer: boolean }[];
  sources: { id: string }[];
}) {
  React.useEffect(() => {
    if (!fresh || !ready) return;
    // Switching the entry type starts a second read while the first is still
    // in flight, and storage does not promise to answer in order. The stale
    // answer checks the kind it was STARTED with, so landing last is how an
    // income category ends up preselected on an expense — a pairing the
    // repository then refuses, after the user has filled the rest of the form.
    let current = true;
    const type = entry.entryType;
    void kv.get(`helix.last.${type}`).then((v) => {
      if (!current || !v) return;
      try {
        const parsed = JSON.parse(v) as { categoryId?: string; sourceId?: string };
        if (parsed.categoryId && categories.some((c) => c.id === parsed.categoryId && acceptsEntry(c, type))) patch({ categoryId: parsed.categoryId });
        if (parsed.sourceId && sources.some((s) => s.id === parsed.sourceId)) patch({ sourceId: parsed.sourceId });
      } catch {
        // A corrupt device-local preference is not worth reporting; the form
        // simply keeps its own defaults.
      }
    });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.entryType, ready]);

  React.useEffect(() => {
    if (!fresh || entry.entryType !== "transfer" || !ready || entry.categoryId) return;
    const investmentCategories = categories.filter((category) => category.kind === "expense" && category.isTransfer);
    if (investmentCategories.length === 1) patch({ categoryId: investmentCategories[0]!.id });
  }, [categories, entry.categoryId, ready, entry.entryType, fresh, patch]);
}

/**
 * What the chosen source makes of an expense: a card charge needs the card's
 * cycle, and a card bill paid from an account takes the card's charges twice.
 * The form points at the statement payment instead of refusing, because an
 * owner who never enters card charges is right to record it that way.
 */
function cardContext(entry: Entry, sources: ExistingSource[], persons: { id: string; isSelf: boolean }[], categories: { id: string; name: string }[]) {
  const source = sources.find((candidate) => candidate.id === entry.sourceId);
  const expense = entry.entryType === "expense";
  const isCreditCardExpense = expense && source?.type === "credit_card";
  const cycle = { statementDay: source?.statementDay ?? null, dueDay: source?.dueDay ?? null };
  const ownsCard = sources.some((candidate) => candidate.type === "credit_card" && persons.some((person) => person.isSelf && person.id === candidate.personId));
  return {
    source,
    cycle,
    isCreditCardExpense,
    cardCycleValid: !isCreditCardExpense || isValidCardCycle(cycle),
    looksLikeCardBill: expense && source?.type !== "credit_card" && ownsCard
      && CARD_BILL.test(`${categories.find((category) => category.id === entry.categoryId)?.name ?? ""} ${entry.note}`),
  };
}

function useTransactionForm({ existing, refundOf, investmentRefund }: { existing?: ExistingTx; refundOf?: ExistingTx; investmentRefund: boolean }) {
  const userId = useUserId();
  const categoriesState = useCategoriesState();
  const sourcesState = useSourcesState();
  const personsState = usePersonsState();
  const transactionsState = useAllTransactionsState();
  const categories = categoriesState.data;
  const sources = sourcesState.data;
  const persons = personsState.data;
  const router = useRouter();
  const operationGuard = useOperationGuard();
  const undo = useUndo();
  const data = combineLiveStates([categoriesState, sourcesState, personsState]);
  const isEdit = existing != null;
  // Opened as a router modal normally, but a web deep-link to /transaction has
  // no back stack — fall back to a real screen so "save" always closes it.
  const close = () => navigateBack(router, investmentRefund ? "/(tabs)/investments" : "/(tabs)/cash-flow");

  const [entry, setEntry] = useState(() => initialEntry(existing, refundOf, investmentRefund));
  const patch = React.useCallback((next: Partial<Entry>) => setEntry((current) => ({ ...current, ...next })), []);
  const [busy, setBusy] = useState(false);
  // Only what a save would write: revealing the currency row or the amount
  // options changes nothing that could be lost, so it prompts about nothing.
  const { showCurrency: _currencyShown, showAmountOptions: _optionsShown, amountMinor: _parsed, categoryId, sourceId, personChoice, ...written } = entry;
  const { allowExit } = useDirtyExitGuard(useDraftDirty(JSON.stringify({ ...written, ...(isEdit ? { categoryId, sourceId, personChoice } : {}) }), data.ready) && !busy);

  useEntryDefaults({ fresh: !isEdit && !refundOf, ready: data.ready, entry, patch, categories, sources });

  useFxRates();
  const today = todayISO();
  const rate = lookupRate(userId, entry.currency, rateDateOf(entry, today));
  // Editing a foreign-currency row must NOT silently re-price it at today's
  // rate — the transaction's TRY value was snapshotted when it occurred. So
  // when the currency is unchanged from the stored row, keep its original
  // fxRate; only a fresh entry or a currency change uses the live rate.
  const historicalRateTry = existing?.currency === entry.currency && entry.currency !== "TRY" && existing.fxRate ? Number(existing.fxRate) : null;
  const effectiveRateTry = entry.currency === "TRY" ? 1 : historicalRateTry ?? rate?.rate.rateTry ?? null;

  const personId = assignedPersonId(personChoice, persons);
  // The person ROW, not just the id: a person deleted on another device while
  // this form is open arrives by sync, and the save then refuses rather than throws.
  const selectedPerson = persons.find((person) => person.id === personId) ?? null;
  const { source: selectedSource, cycle: cardCycle, isCreditCardExpense, cardCycleValid, looksLikeCardBill } = cardContext(entry, sources, persons, categories);

  // Month mode anchors to the first of the month and marks the row dateless
  // (shown by month, kept out of "upcoming"); day mode uses the exact day. A
  // month-only card charge joins that month's statement, which the repository resolves.
  const dateless = entry.dateMode === "month";
  const effectiveDate = dateless ? `${entry.monthKey}-01` : entry.dateStr;
  const dateValid = dateless || isISODate(entry.dateStr);
  const count = Number(entry.countStr);
  const paid = Number(entry.paidStr);
  const installmentValid = !entry.installment || (isValidInstallmentCount(count) && count >= 2 && Number.isInteger(paid) && paid >= 0 && paid < count);
  // The rule itself is in `domain/transaction-draft.ts`, where a test can hold
  // it without a renderer. This screen owns the fields; that owns the answer.
  const saveable = resolveTransactionSave({
    dataReady: data.ready, type: entry.entryType, amountMinor: entry.amountMinor, isReversal: entry.isReversal, currency: entry.currency,
    rateTry: effectiveRateTry, categoryId, person: selectedPerson, dateValid, installmentValid, cardCycleValid, installment: entry.installment,
  });
  // The expense this row refunds: the one it was opened from, or the one an
  // existing refund is already linked to.
  const refundLink = refundOf ?? transactionsState.data.find((row) => existing?.refundOfTransactionId != null && row.id === existing.refundOfTransactionId);
  const refundLeftMinor = refundLink
    ? refundLink.amountMinor + transactionsState.data
      .filter((row) => row.refundOfTransactionId === refundLink.id && row.id !== existing?.id)
      .reduce((sum, row) => sum + row.amountMinor, 0)
    : 0;
  const refundProblem = refundProblemOf(entry, refundLink, refundLeftMinor, refundOf != null);
  const canSave = saveable != null && refundProblem == null;
  const cardStatementPreview = isCreditCardExpense && isValidCardCycle(cardCycle) && dateValid
    ? dateless ? statementPeriod(entry.monthKey, cardCycle) : statementForPurchase(entry.dateStr, cardCycle)
    : null;

  /**
   * Confirm the write with what it DID, not merely that it happened.
   *
   * Non-blocking by construction: it is the same bar every other outcome uses,
   * it dismisses itself, and it changes nothing on screen — the live queries
   * have already delivered the row underneath it, so there is no refresh, no
   * remount and no reload behind this.
   */
  const confirmSave = (summary: SaveSummary, editId: string | null) => {
    const parts: string[] = [];
    if (summary.effect.balanceMinor !== 0) parts.push(tr.tx.savedBalanceEffect(formatMinorCompact(summary.effect.balanceMinor)));
    else if (summary.effect.forecastOnly) parts.push(tr.tx.savedForecastEffect(formatMinorCompact(summary.effect.projectedMinor)));
    if (summary.otherMonth) parts.push(tr.tx.savedOtherMonth(monthLabel(summary.otherMonth as MonthKey)));
    const message = summary.kind === "updated" ? tr.tx.updatedNotice : tr.tx.savedNotice;
    if (parts.length === 0) {
      undo.show(message);
      return;
    }
    undo.showDetailed(message, {
      text: parts.join(" · "),
      action: editId ? { label: tr.common.edit, run: () => router.push({ pathname: "/transaction", params: { id: editId } }) } : null,
    });
  };

  const saveFailure = (e: unknown) => {
    if (e instanceof CreditCardCycleRequiredError) return tr.sources.cycleRequired;
    return e instanceof RefundExceedsExpenseError && refundLink ? tr.tx.refundTooLarge(formatMinorCompact(e.remainingMinor, refundLink.currency)) : tr.errors.saveFailed;
  };

  /** A card purchase in instalments: its plan starts on the statement the purchase joins, or where "already paid" places it. */
  const writePlan = (fxRate: string | null) => {
    const dueDay = selectedSource?.dueDay ?? null;
    const firstMonth = cardStatementPreview ? monthKeyOf(cardStatementPreview.dueDate) : dateless ? entry.monthKey : monthKeyOf(entry.dateStr);
    return createInstallmentPlan(userId, {
      title: entry.note.trim() || tr.installments.defaultTitle(formatMinorCompact(saveable!.amountMinor, entry.currency)),
      kind: "card_installment", totalAmountMinor: saveable!.amountMinor, monthlyAmountMinor: null, installmentCount: count,
      currency: entry.currency, fxRate,
      startMonth: paid > 0 ? deriveStartMonth(paid, monthKeyOf(todayISO()), dueDay, todayISO()) : firstMonth,
      dueDay, paymentSourceId: sourceId, personId: saveable!.person.id, personIsSelf: saveable!.person.isSelf,
      categoryId: saveable!.categoryId, note: entry.note.trim() || null, tryFactor: saveable!.rateTry,
    });
  };

  const save = (thenNew: boolean) => operationGuard.run(async () => {
    if (!saveable) return;
    setBusy(true);
    try {
      assertISODate(effectiveDate);
      const fxRate = entry.currency === "TRY" ? null : String(effectiveRateTry);
      // The same eleven fields either way — an edit patches them, a new entry
      // creates them. One literal is what stops a twelfth reaching only one path.
      const fields = {
        type: entry.entryType, amountMinor: saveable.signedAmountMinor, currency: entry.currency, fxRate, amountTryMinor: saveable.tryMinor,
        effectiveDate, isAggregate: dateless, categoryId: saveable.categoryId, paymentSourceId: sourceId, personId: saveable.person.id,
        note: entry.note.trim() || null,
      };
      const saved: SavedTransaction = {
        type: entry.entryType, amountTryMinor: Math.abs(saveable.tryMinor), effectiveDate,
        status: effectiveDate <= todayISO() ? "realized" : "pending", personIsSelf: saveable.person.isSelf,
      };
      if (existing) {
        await updateTransaction(userId, existing, fields);
        scheduleSync(userId);
        confirmSave(buildSaveSummary({ kind: "updated", saved, today: todayISO(), enteredFor: entry.dateStr }), null);
        allowExit(close);
        return;
      }
      // A plan writes many rows across many months: no single row to open and
      // no one-row balance sentence to say, so it keeps the plain notice.
      const createdId = entry.installment ? null : await addTransaction(userId, refundOf ? { ...fields, refundOfTransactionId: refundOf.id } : fields);
      if (entry.installment) await writePlan(fxRate);
      void kv.set(`helix.last.${entry.entryType}`, JSON.stringify({ categoryId, sourceId }));
      scheduleSync(userId);
      const summary = entry.installment ? null : buildSaveSummary({ kind: "created", saved, today: todayISO(), enteredFor: entry.dateStr });
      if (summary) confirmSave(summary, createdId);
      // Staying on the form clears only the amount; the shared bar confirms the write.
      if (thenNew) {
        patch({ amountRaw: "", amountMinor: null, isReversal: false, note: "" });
        if (!summary) undo.show(tr.tx.savedNotice);
      } else allowExit(close);
    } catch (e) {
      // Never surface a raw engine error (English, technical) to the user.
      devError("transaction.save", e);
      void appAlert(saveFailure(e), tr.errors.title);
    } finally {
      setBusy(false);
    }
  });

  const chooseEntryType = (next: EntryType) => {
    selectionTapIfChanged(entry.entryType, next);
    setEntry((current) => ({
      ...current,
      entryType: next,
      isReversal: false,
      categoryId: current.categoryId && categories.some((category) => category.id === current.categoryId && acceptsEntry(category, next)) ? current.categoryId : null,
      installment: next === "expense" && current.installment,
    }));
  };

  return {
    existing, refundOf, isEdit, data, entry, patch, busy, save, canSave, chooseEntryType, userId,
    categories, sources, persons, personId, historicalRateTry, rate, isCreditCardExpense, cardCycleValid, looksLikeCardBill,
    dateless, installmentValid, count, cardStatementPreview, refundLink, refundLeftMinor, refundProblem,
    tryMinor: previewTryMinor(entry.amountMinor, entry.isReversal, effectiveRateTry),
  };
}

type TransactionFormModel = ReturnType<typeof useTransactionForm>;

/** A linked refund is an expense refund and nothing else, so the type is stated rather than offered. */
function RefundOfLine({ form }: { form: TransactionFormModel }) {
  const { palette } = useTheme();
  const link = form.refundLink!;
  return (
    <View style={{ marginBottom: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: palette.surfaceAlt, gap: spacing.xs }}>
      <Body style={{ color: palette.primaryText }}>
        {tr.tx.refundOfLine(
          form.categories.find((category) => category.id === link.categoryId)?.name ?? tr.common.none,
          formatMinorCompact(link.amountMinor, link.currency),
          dateLabel(link.purchaseDate ?? link.effectiveDate),
        )}
      </Body>
      <Body muted style={{ fontSize: type.small.fontSize }}>{tr.tx.refundOfLeft(formatMinorCompact(form.refundLeftMinor, link.currency))}</Body>
      {form.refundProblem ? <Body accessibilityRole="alert" style={{ color: palette.warningText }}>{form.refundProblem}</Body> : null}
    </View>
  );
}

function EntryTypePicker({ form }: { form: TransactionFormModel }) {
  const { palette } = useTheme();
  const choices: [EntryType, string, LucideIcon, string][] = [
    ["expense", tr.tx.expense, ArrowUpRight, palette.negative],
    ["income", tr.tx.income, ArrowDownLeft, palette.positive],
    ["transfer", tr.tx.transferInvest, TrendingUp, palette.primary],
  ];
  return (
    <View role="radiogroup" accessibilityLabel={tr.tx.type} style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md }}>
      {choices.map(([type, label, icon, tone]) => (
        <EntryTypeChoice key={type} label={label} icon={icon} tone={tone} selected={form.entry.entryType === type} onPress={() => form.chooseEntryType(type)} />
      ))}
    </View>
  );
}

function ReversalToggle({ form }: { form: TransactionFormModel }) {
  const { palette } = useTheme();
  const { entryType, isReversal } = form.entry;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        backgroundColor: palette.surfaceAlt,
        borderRadius: radius.md,
        borderWidth: isReversal ? 1 : StyleSheet.hairlineWidth,
        borderColor: isReversal ? palette.primary : palette.border,
        padding: spacing.md,
        marginBottom: spacing.md,
      }}
    >
      <Undo2 accessible={false} size={20} color={isReversal ? palette.primary : palette.textSecondary} />
      <View style={{ flex: 1 }}>
        <Body style={{ color: isReversal ? palette.primaryText : palette.text }}>{tr.tx.reversalLabel(entryType)}</Body>
        <Body muted style={{ fontSize: type.small.fontSize, marginTop: 2 }}>
          {isReversal ? tr.tx.reversalHint(entryType) : tr.tx.refundToggleHint(entryType)}
        </Body>
      </View>
      <Toggle label={tr.tx.reversalLabel(entryType)} value={isReversal} onValueChange={(v) => form.patch(v ? { isReversal: v, installment: false } : { isReversal: v })} />
    </View>
  );
}

function AmountOptions({ form }: { form: TransactionFormModel }) {
  const { entry, patch } = form;
  if (!entry.showAmountOptions) {
    return <InlineDisclosure icon={SlidersHorizontal} label={tr.tx.amountOptions(entry.entryType, entry.currency)} expanded={false} onPress={() => patch({ showAmountOptions: true })} />;
  }
  return (
    <>
      {entry.entryType !== "transfer" || (form.isEdit && entry.isReversal) ? <ReversalToggle form={form} /> : null}
      {entry.showCurrency ? (
        <>
          <Label>{tr.tx.currency}</Label>
          <CurrencyPicker value={entry.currency} onChange={(currency) => patch({ currency })} />
        </>
      ) : (
        <InlineDisclosure label={tr.tx.changeCurrency(currencyLabel(entry.currency))} expanded={false} onPress={() => patch({ showCurrency: true })} />
      )}
      {entry.currency !== "TRY" ? (
        <View style={{ marginBottom: spacing.md, alignItems: "flex-start" }}>
          {form.tryMinor != null ? <Body muted>{tr.tx.tryEquivalent(formatMinorCompact(form.tryMinor))}</Body> : <Body muted>{tr.tx.rateNotFound}</Body>}
          {!form.historicalRateTry && form.rate?.isStale ? <Badge text={`⚠ ${tr.tx.staleRate}`} tone="warning" /> : null}
        </View>
      ) : null}
    </>
  );
}

/** Category and source are open-ended lists — a household can carry forty categories — so each reads as one dropdown row. */
function AssignmentFields({ form }: { form: TransactionFormModel }) {
  const router = useRouter();
  const { palette } = useTheme();
  const { entry, patch } = form;
  const categoryOptions = form.categories
    .filter((category) => acceptsEntry(category, entry.entryType))
    .map((category) => ({ value: category.id, label: category.name, icon: categoryIconComponent(category) }));
  return (
    <>
      <Divider />
      <SectionHeader>{tr.tx.assignment}</SectionHeader>
      {categoryOptions.length > 0 ? (
        <Select
          testID="transaction-category"
          label={tr.tx.category}
          placeholder={tr.tx.categoryPlaceholder}
          options={categoryOptions}
          value={entry.categoryId}
          onChange={(categoryId) => patch({ categoryId })}
          onCreate={{ label: tr.tx.addCategory, run: () => router.push("/columns-editor") }}
        />
      ) : (
        <View style={{ marginBottom: spacing.md }}>
          <Label>{tr.tx.category}</Label>
          <Body muted style={{ marginBottom: spacing.sm }}>{tr.tx.categoryRequiredEmpty}</Body>
          <Button size="sm" variant="secondary" label={tr.settings.categories} onPress={() => router.push("/columns-editor")} />
        </View>
      )}
      {form.sources.length > 0 && entry.entryType !== "income" ? (
        <Select
          label={tr.tx.source}
          placeholder={tr.tx.sourcePlaceholder}
          options={form.sources.map((s) => ({ value: s.id, label: s.name, icon: <PaymentSourceLogo name={s.name} type={s.type} logoRef={s.logoRef} size={SOURCE_MARK} /> }))}
          value={entry.sourceId}
          onChange={(sourceId) => patch({ sourceId })}
          onCreate={{ label: tr.tx.addSource, run: () => router.push("/payment-sources") }}
        />
      ) : null}
      {form.looksLikeCardBill ? (
        <View accessibilityRole="alert" style={{ marginBottom: spacing.md, gap: spacing.xs }}>
          <Body style={{ color: palette.warningText }}>{tr.tx.cardBillTitle}</Body>
          <Body muted>{tr.tx.cardBillWarning}</Body>
          <View style={{ alignItems: "flex-start", marginTop: spacing.xs }}>
            <Button size="sm" variant="secondary" label={tr.tx.cardBillAction} onPress={() => router.push("/card-statement")} />
          </View>
        </View>
      ) : null}
      <PersonAssignment people={form.persons} value={form.personId} onChange={(personChoice) => patch({ personChoice })} />
    </>
  );
}

function AmountCard({ form }: { form: TransactionFormModel }) {
  const { entry, patch } = form;
  // Only while the field is actually showing one. See `placeholders.ts`.
  const amountPlaceholder = useRotatingPlaceholder(placeholderPools.amount, { active: entry.amountRaw.length === 0 });
  const transfer = entry.entryType === "transfer";
  return (
    <HeroCard>
      <PanelHeader icon={WalletCards} title={tr.tx.amountDetails} description={tr.tx.amountDetailsHint} />
      {form.refundLink ? <RefundOfLine form={form} /> : <EntryTypePicker form={form} />}
      <MoneyField
        testID="transaction-amount"
        // The code alone, no flag: a flag would join the field's accessible
        // name, announced before the person could type a number.
        label={`${tr.tx.amount} · ${entry.currency}`}
        value={entry.amountRaw}
        expression={!transfer}
        placeholder={amountPlaceholder}
        onChangeMinor={(raw, minor) => patch({
          amountRaw: transfer ? raw.replace(/^-/, "") : raw,
          amountMinor: minor == null ? null : Math.abs(minor),
          ...(!transfer && minor != null && minor < 0 ? { isReversal: true } : {}),
        })}
      />
      <AmountOptions form={form} />
      <AssignmentFields form={form} />
    </HeroCard>
  );
}

/** Where the card-cycle hint and the way to fix a missing one sit under a date field. */
function CardCycleFix({ form }: { form: TransactionFormModel }) {
  const router = useRouter();
  return form.isCreditCardExpense && !form.cardCycleValid
    ? <Button size="sm" variant="secondary" label={tr.settings.sources} onPress={() => router.push("/payment-sources")} />
    : null;
}

function TimingFields({ form }: { form: TransactionFormModel }) {
  const { entry, patch, cardStatementPreview: preview, isCreditCardExpense } = form;
  const cardNote = isCreditCardExpense ? tr.tx.cardCycleMissing : null;
  return (
    <>
      <PanelHeader icon={CalendarClock} title={tr.tx.timing} description={tr.tx.timingHint} />
      <Label>{tr.tx.whenLabel}</Label>
      <ChipPicker
        options={[{ value: "month", label: tr.tx.monthOnly }, { value: "day", label: tr.tx.specificDay }]}
        value={entry.dateMode}
        onChange={(dateMode) => patch({ dateMode })}
      />
      {form.dateless ? (
        <FieldNote
          note={preview
            ? tr.tx.cardMonthOnlyHint(monthLabel(entry.monthKey), dateLabel(preview.statementDate), dateLabel(preview.dueDate))
            : cardNote ?? tr.tx.monthOnlyHint(monthLabel(entry.monthKey))}
        >
          <MonthStepper value={entry.monthKey} onChange={(monthKey) => patch({ monthKey })} />
        </FieldNote>
      ) : (
        <FieldNote
          note={preview
            ? tr.tx.cardPurchaseHint(dateLabel(preview.statementDate), dateLabel(preview.dueDate))
            : cardNote ?? (entry.dateStr > todayISO() ? tr.tx.futureHint : tr.tx.effectiveDateHint)}
        >
          <DateField label={isCreditCardExpense ? tr.tx.cardPurchaseDate : tr.tx.effectiveDate} value={entry.dateStr} onChange={(dateStr) => patch({ dateStr })} />
        </FieldNote>
      )}
      <CardCycleFix form={form} />
    </>
  );
}

function InstallmentFields({ form }: { form: TransactionFormModel }) {
  const { entry, patch } = form;
  const onCard = form.sources.find((source) => source.id === entry.sourceId)?.type === "credit_card";
  if (form.isEdit || form.refundOf || entry.entryType !== "expense" || !onCard) return null;
  return (
    <View style={{ marginVertical: spacing.md }}>
      <ChipPicker
        options={[{ value: "single", label: tr.tx.singleCharge }, { value: "installment", label: tr.tx.installmentToggle }]}
        value={entry.installment ? "installment" : "single"}
        onChange={(v) => patch({ installment: v === "installment" })}
      />
      {entry.installment ? (
        <Row>
          <View style={{ flex: 1 }}>
            <Field label={tr.tx.installmentCount} value={entry.countStr} onChangeText={(countStr) => patch({ countStr })} keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label={tr.tx.alreadyPaid} value={entry.paidStr} onChangeText={(paidStr) => patch({ paidStr })} keyboardType="number-pad" />
          </View>
        </Row>
      ) : null}
      {entry.installment && form.installmentValid && entry.amountMinor ? <Body muted>{installmentSplitText(entry.amountMinor, form.count, entry.currency)}</Body> : null}
    </View>
  );
}

function CompletionFields({ form }: { form: TransactionFormModel }) {
  const { entry, existing } = form;
  const attachmentsState = useAttachmentsState();
  const notePlaceholder = useRotatingPlaceholder(placeholderPools.note, { active: entry.note.length === 0 });
  return (
    <>
      <Divider />
      <SectionHeader>{tr.tx.completion}</SectionHeader>
      <Field testID="transaction-note" label={tr.common.note} value={entry.note} onChangeText={(note) => form.patch({ note })} multiline placeholder={notePlaceholder} />
      {/* Documents belong to a row that exists: there is nothing to attach
          them to until the transaction has been saved once. */}
      {existing ? (
        <AttachmentPanel
          userId={form.userId}
          transactionId={existing.id}
          attachments={attachmentsState.data
            .filter((attachment) => attachment.transactionId === existing.id)
            .map(({ id, transactionId, fileName, storedName, mimeType, byteSize, kind }) => ({ id, transactionId, fileName, storedName, mimeType, byteSize, kind }))}
        />
      ) : null}
      {/* Only when it says something: nearly every row IS hand-entered, and
          labelling those buries a row that arrived from a spreadsheet or a statement. */}
      {existing && provenanceOf(existing) !== "manual" ? (
        <Body muted testID="transaction-provenance" style={{ fontSize: type.small.fontSize, marginBottom: spacing.md }}>
          {tr.provenance.label(tr.provenance[provenanceOf(existing)])}
        </Body>
      ) : null}
      {/* The form's own width: a pair bounded to what two buttons need rendered
          as a small block that moved with the window. */}
      <View style={{ gap: spacing.sm, width: "100%" }}>
        <Button label={tr.common.save} onPress={() => void form.save(false)} disabled={!form.canSave} loading={form.busy} />
        {!form.isEdit ? <Button label={tr.tx.saveAndNew} variant="secondary" onPress={() => void form.save(true)} disabled={!form.canSave || form.busy} /> : null}
      </View>
    </>
  );
}

function TransactionForm({ existing, refundOf, investmentRefund = false }: { existing?: ExistingTx; refundOf?: ExistingTx; investmentRefund?: boolean }) {
  const form = useTransactionForm({ existing, refundOf, investmentRefund });
  const title = form.isEdit ? tr.tx.edit : tr.tx.new;
  // Desktop: Enter saves (unless the note textarea or a popup has focus).
  useSubmitOnEnter(() => void form.save(false), form.canSave && !form.busy);
  if (!form.data.ready) {
    return (
      <DataGateScreen status={form.data.status} retry={form.data.retry}>
        <Stack.Screen options={{ title }} />
      </DataGateScreen>
    );
  }
  return (
    <Screen width="workspace">
      <Stack.Screen options={{ title }} />
      <DataStateNotice status={form.data.status} retry={form.data.retry} />
      <WorkspaceSplit
        testID="transaction-workspace"
        primary={<AmountCard form={form} />}
        secondary={(
          <Card>
            <TimingFields form={form} />
            <InstallmentFields form={form} />
            <CompletionFields form={form} />
          </Card>
        )}
      />
      {existing && existing.type === "expense" && existing.amountMinor > 0 && !existing.refundOfTransactionId
        ? <ExpenseRefunds expense={existing} />
        : null}
    </Screen>
  );
}
