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
import { addTransaction, createInstallmentPlan, CreditCardCycleRequiredError, updateTransaction } from "../data/repo";
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
import { assertISODate, isISODate, lastDayOf, monthKeyOf, todayISO, type MonthKey } from "../domain/dates";
import { isValidCardCycle, statementForPurchase } from "../domain/card-statements";
import { formatMinorCompact, formatMinorInput, installmentShareRange } from "../domain/money";
import { currencyLabel } from "../domain/fx-provider";
import { deriveStartMonth, isValidInstallmentCount } from "../domain/installments";
import { lookupRate, useFxRates } from "../services/fx-fetch";
import { categoryIconComponent,  } from "../ui/category-icon";
import { PaymentSourceLogo } from "../ui/logo";
import { CurrencyPicker } from "../ui/currency-picker";
import { scheduleSync } from "../sync/engine";
import { dateLabel, monthLabel, tr } from "../i18n/tr";
import { Amount, Badge, Body, Button, Card, ChipPicker, ChoiceTile, DataStateNotice, Divider, Field, FieldNote, HeroCard, InlineDisclosure, Label, MoneyField, MonthStepper, PanelHeader, Row, Screen, SectionHeader, Select, Toggle } from "../ui/components";
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
import { PersonAssignment } from "../ui/person-assignment";

/** The Select's own icon column, so a source mark fits it exactly. */
const SOURCE_MARK = 22;

type EntryType = "expense" | "income" | "transfer";

type ExistingTx = ReturnType<typeof useAllTransactionsState>["data"][number];

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

export default function TransactionModal() {
  const { id, intent } = useLocalSearchParams<{ id?: string; intent?: string }>();
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
  return <TransactionForm key={existing?.id ?? `new-${intent ?? "default"}`} existing={existing} investmentRefund={intent === "investment-refund"} />;
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

function TransactionForm({ existing, investmentRefund = false }: { existing?: ExistingTx; investmentRefund?: boolean }) {
  const userId = useUserId();
  const categoriesState = useCategoriesState();
  const attachmentsState = useAttachmentsState();
  const sourcesState = useSourcesState();
  const personsState = usePersonsState();
  const categories = categoriesState.data;
  const sources = sourcesState.data;
  const persons = personsState.data;
  const router = useRouter();
  const { palette } = useTheme();
  const operationGuard = useOperationGuard();
  const undo = useUndo();
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([categoriesState, sourcesState, personsState]);
  const isEdit = existing != null;
  // Opened as a router modal normally, but a web deep-link to /transaction has
  // no back stack — fall back to a real screen so "save" always closes it.
  const close = () => navigateBack(router, investmentRefund ? "/(tabs)/investments" : "/(tabs)/cash-flow");

  const [entryType, setEntryType] = useState<EntryType>((existing?.type as EntryType) ?? (investmentRefund ? "transfer" : "expense"));
  const [amountRaw, setAmountRaw] = useState(existing ? formatMinorInput(Math.abs(existing.amountMinor)) : "");
  const [amountMinor, setAmountMinor] = useState<number | null>(existing ? Math.abs(existing.amountMinor) : null);
  const [isReversal, setIsReversal] = useState((existing?.amountMinor ?? 0) < 0 || investmentRefund);
  const [currency, setCurrency] = useState<string>(existing?.currency ?? "TRY");
  const [showCurrency, setShowCurrency] = useState((existing?.currency ?? "TRY") !== "TRY");
  const [showAmountOptions, setShowAmountOptions] = useState(
    (existing?.amountMinor ?? 0) < 0 || (existing?.currency ?? "TRY") !== "TRY",
  );
  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null);
  const [sourceId, setSourceId] = useState<string | null>(existing?.paymentSourceId ?? null);
  // persons load async (live query) — deriving keeps "self" as the default
  // even when the modal mounts before the first query resolves.
  const [personChoice, setPersonChoice] = useState<string | null>(existing?.personId ?? null);
  const personId = personChoice ?? persons.find((p) => p.isSelf)?.id ?? persons[0]?.id ?? null;
  // The person ROW, not just the id. The installment path needs `isSelf` and
  // used to assert the lookup could not miss — but a person deleted on another
  // device while this form is open arrives by sync, and the assertion then
  // threw inside the save instead of refusing it.
  const selectedPerson = persons.find((person) => person.id === personId) ?? null;
  // When did it happen? New entries default to TODAY (specific day) so the
  // amount hits the current balance right away; "month only" (dateless) and
  // future days stay one explicit tap away. An existing dateless row
  // (isAggregate) reopens in month mode; a dated row in day mode.
  const [dateMode, setDateMode] = useState<"month" | "day">(existing ? (existing.isAggregate ? "month" : "day") : "day");
  const initialOccurrenceDate = existing?.purchaseDate ?? existing?.effectiveDate ?? todayISO();
  const [monthKey, setMonthKey] = useState<MonthKey>(monthKeyOf(initialOccurrenceDate));
  const [dateStr, setDateStr] = useState(initialOccurrenceDate);
  const [note, setNote] = useState(existing?.note ?? "");
  const [installment, setInstallment] = useState(false);
  const [countStr, setCountStr] = useState("2");
  const [paidStr, setPaidStr] = useState("0");
  const [busy, setBusy] = useState(false);
  // Only what a save would write. `showCurrency` is disclosure — revealing the
  // currency row changes nothing that could be lost, so asking "discard your
  // changes?" for it prompts about a change the user never made.
  const draftSnapshot = JSON.stringify({
    entryType,
    amountRaw,
    isReversal,
    currency,
    ...(isEdit ? { categoryId, sourceId, personChoice } : {}),
    dateMode,
    monthKey,
    dateStr,
    note,
    installment,
    countStr,
    paidStr,
  });
  const { allowExit } = useDirtyExitGuard(useDraftDirty(draftSnapshot, dataReady) && !busy);

  // Smart defaults (new entries only): remember last used category/source.
  React.useEffect(() => {
    if (isEdit || !dataReady) return;
    // Switching the entry type starts a second read while the first is still
    // in flight, and storage does not promise to answer in order. The stale
    // answer checks the kind it was STARTED with, so landing last is how an
    // income category ends up preselected on an expense — a pairing the
    // repository then refuses, after the user has filled the rest of the form.
    let current = true;
    void kv.get(`helix.last.${entryType}`).then((v) => {
      if (!current || !v) return;
      try {
        const parsed = JSON.parse(v) as { categoryId?: string; sourceId?: string };
        const expectedKind = entryType === "income" ? "income" : "expense";
        if (
          parsed.categoryId
          && categories.some((c) =>
            c.id === parsed.categoryId
            && c.kind === expectedKind
            && (entryType !== "transfer" || c.isTransfer),
          )
        ) {
          setCategoryId(parsed.categoryId);
        }
        if (parsed.sourceId && sources.some((s) => s.id === parsed.sourceId)) setSourceId(parsed.sourceId);
      } catch {
        // A corrupt device-local preference is not worth reporting; the form
        // simply keeps its own defaults.
      }
    });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryType, dataReady]);

  React.useEffect(() => {
    if (isEdit || entryType !== "transfer" || !dataReady || categoryId) return;
    const investmentCategories = categories.filter((category) => category.kind === "expense" && category.isTransfer);
    if (investmentCategories.length === 1) setCategoryId(investmentCategories[0]!.id);
  }, [categories, categoryId, dataReady, entryType, isEdit]);

  useFxRates();
  const today = todayISO();
  const selectedRateDate = dateMode === "month"
    ? (monthKey === monthKeyOf(today) ? today : lastDayOf(monthKey))
    : (isISODate(dateStr) ? dateStr : today);
  const rate = lookupRate(userId, currency, selectedRateDate);
  // Editing a foreign-currency row must NOT silently re-price it at today's
  // rate — the transaction's TRY value was snapshotted when it occurred. So
  // when the currency is unchanged from the stored row, keep its original
  // fxRate; only a fresh entry or a currency change uses the live rate.
  const editingSameCurrency = isEdit && existing?.currency === currency && currency !== "TRY";
  const historicalRateTry =
    editingSameCurrency && existing?.fxRate ? Number(existing.fxRate) : null;
  const effectiveRateTry: number | null =
    currency === "TRY" ? 1 : (historicalRateTry ?? rate?.rate.rateTry ?? null);

  const kindForCategories = entryType === "income" ? "income" : "expense";
  const categoryOptions = categories
    .filter((c) => c.kind === kindForCategories && (entryType !== "transfer" || c.isTransfer))
    .map((c) => ({ value: c.id, label: c.name, icon: categoryIconComponent(c) }));

  const sourceOptions = sources.map((s) => ({ value: s.id, label: s.name, icon: <PaymentSourceLogo name={s.name} type={s.type} logoRef={s.logoRef} size={SOURCE_MARK} /> }));
  const selectedSource = sources.find((source) => source.id === sourceId);
  const isCreditCardExpense = entryType === "expense" && selectedSource?.type === "credit_card";
  const cardCycle = selectedSource
    ? { statementDay: selectedSource.statementDay, dueDay: selectedSource.dueDay }
    : { statementDay: null, dueDay: null };
  const cardCycleValid = !isCreditCardExpense || isValidCardCycle(cardCycle);

  // Resolve the two date modes to one effective date + a dateless flag. Month
  // mode anchors to the first of the month and marks the row dateless (shown by
  // month, kept out of "upcoming"); day mode uses the exact day.
  const dateless = dateMode === "month" && !isCreditCardExpense;
  const effectiveDate = dateless ? (`${monthKey}-01` as string) : dateStr;
  const dateValid = dateless || isISODate(dateStr);
  const count = Number(countStr);
  const paid = Number(paidStr);
  const installmentValid =
    !installment || (isValidInstallmentCount(count) && count >= 2 && Number.isInteger(paid) && paid >= 0 && paid < count);
  const tryMinor = previewTryMinor(amountMinor, isReversal, effectiveRateTry);
  // The rule itself is in `domain/transaction-draft.ts`, where a test can hold
  // it without a renderer. This screen owns the fields; that owns the answer.
  const saveable = resolveTransactionSave({
    dataReady,
    type: entryType,
    amountMinor,
    isReversal,
    currency,
    rateTry: effectiveRateTry,
    categoryId,
    person: selectedPerson,
    dateValid,
    installmentValid,
    cardCycleValid,
    installment,
  });
  const canSave = saveable != null;

  const cardStatementPreview = isCreditCardExpense && isValidCardCycle(cardCycle) && dateValid
    ? statementForPurchase(dateStr, cardCycle)
    : null;

  const fail = (msg: string) => void appAlert(msg, tr.errors.title);

  /**
   * Confirm the write with what it DID, not merely that it happened.
   *
   * Non-blocking by construction: it is the same bar every other outcome uses,
   * it dismisses itself, and it changes nothing on screen — the live queries
   * have already delivered the row underneath it, so there is no refresh, no
   * remount and no reload behind this.
   */
  const confirmSave = React.useCallback((summary: SaveSummary, editId: string | null) => {
    const parts: string[] = [];
    if (summary.effect.balanceMinor !== 0) {
      parts.push(tr.tx.savedBalanceEffect(formatMinorCompact(summary.effect.balanceMinor)));
    } else if (summary.effect.forecastOnly) {
      parts.push(tr.tx.savedForecastEffect(formatMinorCompact(summary.effect.projectedMinor)));
    }
    if (summary.otherMonth) parts.push(tr.tx.savedOtherMonth(monthLabel(summary.otherMonth as MonthKey)));
    const message = summary.kind === "updated" ? tr.tx.updatedNotice : tr.tx.savedNotice;
    if (parts.length === 0) {
      undo.show(message);
      return;
    }
    undo.showDetailed(message, {
      text: parts.join(" · "),
      action: editId
        ? { label: tr.common.edit, run: () => router.push({ pathname: "/transaction", params: { id: editId } }) }
        : null,
    });
  }, [undo, router]);

  const save = async (thenNew: boolean) => {
    if (!saveable) return;
    await operationGuard.run(async () => {
      setBusy(true);
      try {
        assertISODate(effectiveDate);
        const fxRate = currency === "TRY" ? null : String(effectiveRateTry);
        // The id of the row just written, so the confirmation can offer to
        // open it. A plan writes many rows and has no single one to open.
        let createdId: string | null = null;
        // The same eleven fields either way — an edit patches them, a new
        // entry creates them. One literal is what stops a twelfth from being
        // added to only one of the two write paths.
        const written = {
          type: entryType,
          amountMinor: saveable.signedAmountMinor,
          currency,
          fxRate,
          amountTryMinor: saveable.tryMinor,
          effectiveDate,
          isAggregate: dateless,
          categoryId: saveable.categoryId,
          paymentSourceId: sourceId,
          personId: saveable.person.id,
          note: note.trim() || null,
        };
        // Same reasoning as `written`: the confirmation describes the same row
        // either way, so one literal is what stops a field being added to the
        // "created" summary and forgotten in the "updated" one.
        const saved: SavedTransaction = {
          type: entryType,
          amountTryMinor: Math.abs(saveable.tryMinor),
          effectiveDate,
          status: effectiveDate <= todayISO() ? "realized" : "pending",
          personIsSelf: saveable.person.isSelf,
        };
        if (isEdit) {
          await updateTransaction(userId, existing, written);
          scheduleSync(userId);
          confirmSave(
            buildSaveSummary({ kind: "updated", saved, today: todayISO(), enteredFor: dateStr }),
            null,
          );
          allowExit(close);
          return;
        }
        if (installment) {
          await createInstallmentPlan(userId, {
            title: note.trim() || tr.installments.defaultTitle(formatMinorCompact(saveable.amountMinor, currency)),
            kind: "card_installment",
            totalAmountMinor: saveable.amountMinor,
            monthlyAmountMinor: null,
            installmentCount: count,
            currency,
            fxRate,
            startMonth:
              paid > 0
                ? deriveStartMonth(paid, monthKeyOf(todayISO()), sources.find((s) => s.id === sourceId)?.dueDay ?? null, todayISO())
                : cardStatementPreview ? monthKeyOf(cardStatementPreview.dueDate) : dateless ? monthKey : monthKeyOf(dateStr),
            dueDay: sources.find((s) => s.id === sourceId)?.dueDay ?? null,
            paymentSourceId: sourceId,
            personId: saveable.person.id,
            personIsSelf: saveable.person.isSelf,
            categoryId: saveable.categoryId,
            note: note.trim() || null,
            tryFactor: saveable.rateTry,
          });
        } else {
          createdId = await addTransaction(userId, written);
        }
        void kv.set(`helix.last.${entryType}`, JSON.stringify({ categoryId, sourceId }));
        scheduleSync(userId);
        // An installment plan is many rows across many months; a single-row
        // balance sentence would misdescribe it, so it keeps the plain notice.
        const summary = installment
          ? null
          : buildSaveSummary({ kind: "created", saved, today: todayISO(), enteredFor: dateStr });
        if (thenNew) {
          setAmountRaw("");
          setAmountMinor(null);
          setIsReversal(false);
          setNote("");
          // Staying on the form means the cleared amount is the only thing that
          // changes, and a blank field reads just as easily as "my input was
          // discarded". Confirm the write through the shared bar.
          if (summary) confirmSave(summary, createdId);
          else undo.show(tr.tx.savedNotice);
        } else {
          if (summary) confirmSave(summary, createdId);
          allowExit(close);
        }
      } catch (e) {
        // Never surface a raw engine error (English, technical) to the user.
        devError("transaction.save", e);
        fail(e instanceof CreditCardCycleRequiredError ? tr.sources.cycleRequired : tr.errors.saveFailed);
      } finally {
        setBusy(false);
      }
    });
  };

  // Desktop: Enter saves (unless the note textarea or a popup has focus).
  useSubmitOnEnter(() => void save(false), canSave && !busy);
  // Only while the field is actually showing one. See `placeholders.ts`.
  const amountPlaceholder = useRotatingPlaceholder(placeholderPools.amount, { active: amountRaw.length === 0 });
  const notePlaceholder = useRotatingPlaceholder(placeholderPools.note, { active: note.length === 0 });

  if (!dataReady) {
    return (
      <Screen>
        <Stack.Screen options={{ title: isEdit ? tr.tx.edit : tr.tx.new }} />
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

  const chooseEntryType = (next: EntryType) => {
    selectionTapIfChanged(entryType, next);
    setEntryType(next);
    setIsReversal(false);
    setCategoryId((current) => {
      if (!current) return current;
      const expectedKind = next === "income" ? "income" : "expense";
      return categories.some((category) =>
        category.id === current
        && category.kind === expectedKind
        && (next !== "transfer" || category.isTransfer),
      ) ? current : null;
    });
    if (next !== "expense") setInstallment(false);
  };

  return (
    <Screen width="workspace">
      <Stack.Screen options={{ title: isEdit ? tr.tx.edit : tr.tx.new }} />
      <DataStateNotice status={dataStatus} retry={retryData} />
      <WorkspaceSplit
        testID="transaction-workspace"
        primary={(
      <HeroCard>
      <PanelHeader icon={WalletCards} title={tr.tx.amountDetails} description={tr.tx.amountDetailsHint} />
      <View
        role="radiogroup"
        accessibilityLabel={tr.tx.type}
        style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md }}
      >
        <EntryTypeChoice
          label={tr.tx.expense}
          icon={ArrowUpRight}
          tone={palette.negative}
          selected={entryType === "expense"}
          onPress={() => chooseEntryType("expense")}
        />
        <EntryTypeChoice
          label={tr.tx.income}
          icon={ArrowDownLeft}
          tone={palette.positive}
          selected={entryType === "income"}
          onPress={() => chooseEntryType("income")}
        />
        <EntryTypeChoice
          label={tr.tx.transferInvest}
          icon={TrendingUp}
          tone={palette.primary}
          selected={entryType === "transfer"}
          onPress={() => chooseEntryType("transfer")}
        />
      </View>

      <MoneyField
        testID="transaction-amount"
        // The code alone, no flag. A flag belongs where a currency is being
        // chosen or shown as itself — the picker chips, the disclosure above
        // them. Here it would join the field's ACCESSIBLE NAME, so a screen
        // reader would announce "Tutar, Türkiye bayrağı, TRY" before the
        // person could type a number.
        label={`${tr.tx.amount} · ${currency}`}
        value={amountRaw}
        expression={entryType !== "transfer"}
        placeholder={amountPlaceholder}
        onChangeMinor={(raw, minor) => {
          setAmountRaw(entryType === "transfer" ? raw.replace(/^-/, "") : raw);
          if (entryType !== "transfer" && minor != null && minor < 0) setIsReversal(true);
          setAmountMinor(minor == null ? null : Math.abs(minor));
        }}
      />
      {!showAmountOptions ? (
        <InlineDisclosure
          icon={SlidersHorizontal}
          label={tr.tx.amountOptions(entryType, currency)}
          expanded={showAmountOptions}
          onPress={() => setShowAmountOptions(true)}
        />
      ) : (
      <>
      {entryType !== "transfer" || (isEdit && isReversal) ? (
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
        <Toggle
          label={tr.tx.reversalLabel(entryType)}
          value={isReversal}
          onValueChange={(v) => {
            setIsReversal(v);
            if (v) setInstallment(false);
          }}
        />
        </View>
      ) : null}
      {showCurrency ? (
        <>
          <Label>{tr.tx.currency}</Label>
          <CurrencyPicker value={currency} onChange={setCurrency} />
        </>
      ) : (
        <InlineDisclosure
          label={tr.tx.changeCurrency(currencyLabel(currency))}
          expanded={showCurrency}
          onPress={() => setShowCurrency(true)}
        />
      )}
      {currency !== "TRY" ? (
        <View style={{ marginBottom: spacing.md, alignItems: "flex-start" }}>
          {tryMinor != null ? <Body muted>{tr.tx.tryEquivalent(formatMinorCompact(tryMinor))}</Body> : <Body muted>{tr.tx.rateNotFound}</Body>}
          {!historicalRateTry && rate?.isStale ? <Badge text={`⚠ ${tr.tx.staleRate}`} tone="warning" /> : null}
        </View>
      ) : null}
      </>
      )}
      {/* Category and payment source are open-ended lists — a household can
          carry forty categories — so they read as one dropdown row rather than
          a chip block that dwarfs the rest of the form. */}
      <Divider />
      <SectionHeader>{tr.tx.assignment}</SectionHeader>
      {categoryOptions.length > 0 ? (
        <Select
          testID="transaction-category"
          label={tr.tx.category}
          placeholder={tr.tx.categoryPlaceholder}
          options={categoryOptions}
          value={categoryId}
          onChange={setCategoryId}
          onCreate={{ label: tr.tx.addCategory, run: () => router.push("/columns-editor") }}
        />
      ) : (
        <View style={{ marginBottom: spacing.md }}>
          <Label>{tr.tx.category}</Label>
          <Body muted style={{ marginBottom: spacing.sm }}>{tr.tx.categoryRequiredEmpty}</Body>
          <Button size="sm" variant="secondary" label={tr.settings.categories} onPress={() => router.push("/columns-editor")} />
        </View>
      )}

      {sources.length > 0 && entryType !== "income" ? (
        <Select
          label={tr.tx.source}
          placeholder={tr.tx.sourcePlaceholder}
          options={sourceOptions}
          value={sourceId}
          onChange={setSourceId}
          onCreate={{ label: tr.tx.addSource, run: () => router.push("/payment-sources") }}
        />
      ) : null}

      <PersonAssignment people={persons} value={personId} onChange={setPersonChoice} />
      </HeroCard>
        )}
        secondary={(
      <Card>
      {/* This label heads the month/day switch. A credit-card expense has no
          switch — its date is always the purchase day — and the `DateField`
          below already carries that name, so heading nothing here printed
          "Harcama Günü" twice, once above the other. */}
      <PanelHeader icon={CalendarClock} title={tr.tx.timing} description={tr.tx.timingHint} />
      {!isCreditCardExpense ? (
        <>
          <Label>{tr.tx.whenLabel}</Label>
          <ChipPicker
            options={[
              { value: "month", label: tr.tx.monthOnly },
              { value: "day", label: tr.tx.specificDay },
            ]}
            value={dateMode}
            onChange={setDateMode}
          />
        </>
      ) : null}
      {dateless ? (
        <>
          <FieldNote note={tr.tx.monthOnlyHint(monthLabel(monthKey))}>
            <MonthStepper value={monthKey} onChange={setMonthKey} />
          </FieldNote>
        </>
      ) : (
        <>
          <FieldNote
            note={cardStatementPreview
              ? tr.tx.cardPurchaseHint(dateLabel(cardStatementPreview.statementDate), dateLabel(cardStatementPreview.dueDate))
              : isCreditCardExpense ? tr.tx.cardCycleMissing
              : dateStr > todayISO() ? tr.tx.futureHint : tr.tx.effectiveDateHint}
          >
            <DateField label={isCreditCardExpense ? tr.tx.cardPurchaseDate : tr.tx.effectiveDate} value={dateStr} onChange={setDateStr} />
          </FieldNote>
          {isCreditCardExpense && !cardCycleValid ? (
            <Button size="sm" variant="secondary" label={tr.settings.sources} onPress={() => router.push("/payment-sources")} />
          ) : null}
        </>
      )}

      {!isEdit && entryType === "expense" && sources.find((s) => s.id === sourceId)?.type === "credit_card" ? (
        <View style={{ marginVertical: spacing.md }}>
          <ChipPicker
            options={[
              { value: "single", label: tr.tx.singleCharge },
              { value: "installment", label: tr.tx.installmentToggle },
            ]}
            value={installment ? "installment" : "single"}
            onChange={(v) => setInstallment(v === "installment")}
          />
          {installment ? (
            <Row>
              <View style={{ flex: 1 }}>
                <Field label={tr.tx.installmentCount} value={countStr} onChangeText={setCountStr} keyboardType="number-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label={tr.tx.alreadyPaid} value={paidStr} onChangeText={setPaidStr} keyboardType="number-pad" />
              </View>
            </Row>
          ) : null}
          {installment && installmentValid && amountMinor ? (
            <Body muted>{(() => {
                const shares = installmentShareRange(amountMinor, count);
                if (!shares) return null;
                return shares.first === shares.last
                  ? tr.tx.installmentInfo(formatMinorCompact(shares.first, currency), count)
                  : tr.tx.installmentInfoUneven(count, formatMinorCompact(shares.first, currency), formatMinorCompact(shares.last, currency));
              })()}</Body>
          ) : null}
        </View>
      ) : null}
      <Divider />
      <SectionHeader>{tr.tx.completion}</SectionHeader>
      <Field
        testID="transaction-note"
        label={tr.common.note}
        value={note}
        onChangeText={setNote}
        multiline
        placeholder={notePlaceholder}
      />
      {/* Documents belong to a row that exists: there is nothing to attach
          them to until the transaction has been saved once. */}
      {isEdit && existing ? (
        <AttachmentPanel
          userId={userId}
          transactionId={existing.id}
          attachments={attachmentsState.data
            .filter((attachment) => attachment.transactionId === existing.id)
            .map((attachment) => ({
              id: attachment.id,
              transactionId: attachment.transactionId,
              fileName: attachment.fileName,
              storedName: attachment.storedName,
              mimeType: attachment.mimeType,
              byteSize: attachment.byteSize,
              kind: attachment.kind,
            }))}
        />
      ) : null}
      {/* Where this row came from, when there is a row to have come from.
          Answering "did I type this, or did it arrive from the spreadsheet?"
          used to require remembering. A row written before provenance existed
          says so rather than claiming to have been typed. */}
      {/* Only when it says something. Nearly every row IS hand-entered, so
          labelling those states the obvious and buries the two cases that
          matter: a row that arrived from a spreadsheet or a statement. */}
      {isEdit && existing && provenanceOf(existing) !== "manual" ? (
        <Body
          muted
          testID="transaction-provenance"
          style={{ fontSize: type.small.fontSize, marginBottom: spacing.md }}
        >
          {tr.provenance.label(tr.provenance[provenanceOf(existing)])}
        </Body>
      ) : null}
      {/* The commit pair is a cluster, not a banner: across a desktop column
          each button ran to ~490px. */}
      {/* The form's own width. Bounded to what two buttons need, the primary
          action of a full-width form rendered as a small block under it — and
          moved every time the window changed. */}
      <View style={{ gap: spacing.sm, width: "100%" }}>
        <Button label={tr.common.save} onPress={() => void save(false)} disabled={!canSave} loading={busy} />
        {!isEdit ? (
          <Button label={tr.tx.saveAndNew} variant="secondary" onPress={() => void save(true)} disabled={!canSave || busy} />
        ) : null}
      </View>
      </Card>
        )}
      />
    </Screen>
  );
}
