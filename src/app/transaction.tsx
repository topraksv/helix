/** Transaction entry modal — smart defaults, TR amount input, FX preview,
 *  future-dated payments (§2.7) and inline installment plan creation. */

import React, { useState } from "react";
import { View } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { addTransaction, createInstallmentPlan, CreditCardCycleRequiredError, updateTransaction } from "../data/repo";
import { useAllTransactions, useCategories, usePersons, useSources, useUserId } from "../data/hooks";
import { categoryIcon } from "../data/category-icons";
import { convertToTryMinor } from "../domain/fx";
import { assertISODate, lastDayOf, monthKeyOf, todayISO, type ISODate, type MonthKey } from "../domain/dates";
import { isValidCardCycle, statementForPurchase } from "../domain/card-statements";
import { formatMinor } from "../domain/money";
import { deriveStartMonth, isValidInstallmentCount } from "../domain/installments";
import { lookupRate, SUPPORTED_CURRENCIES, useFxRates } from "../services/fx-fetch";
import { scheduleSync } from "../sync/engine";
import { dateLabel, monthLabel, tr } from "../i18n/tr";
import { Badge, Body, Button, ChipPicker, Field, Label, MonthStepper, MoneyField, Row, Screen, Segmented, Toggle } from "../ui/components";
import { useSubmitOnEnter } from "../ui/keyboard";
import { appAlert } from "../ui/dialog";
import { DateField } from "../ui/calendar";
import { kv } from "../lib/kv";
import { placeholderPools, useRotatingPlaceholder } from "../ui/placeholders";
import { spacing } from "../ui/theme";
import { navigateBack } from "../ui/navigation";
import { devError } from "../services/logger";

type EntryType = "expense" | "income" | "transfer";

type ExistingTx = ReturnType<typeof useAllTransactions>[number];

export default function TransactionModal() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const allTx = useAllTransactions();
  const existing = id ? allTx.find((t) => t.id === id) : undefined;
  // Editing: wait for the row to load, then key by id so state initializers
  // see the real values.
  if (id && !existing) return <Screen scroll={false}>{null}</Screen>;
  if (existing?.installmentPlanId) {
    return <Redirect href={{ pathname: "/installment-new", params: { id: existing.installmentPlanId } }} />;
  }
  return <TransactionForm key={existing?.id ?? "new"} existing={existing} />;
}

function TransactionForm({ existing }: { existing?: ExistingTx }) {
  const userId = useUserId();
  const categories = useCategories();
  const sources = useSources();
  const persons = usePersons();
  const router = useRouter();
  const isEdit = existing != null;
  // Opened as a router modal normally, but a web deep-link to /transaction has
  // no back stack — fall back to a real screen so "save" always closes it.
  const close = () => navigateBack(router, "/(tabs)/cash-flow");

  const [entryType, setEntryType] = useState<EntryType>((existing?.type as EntryType) ?? "expense");
  const [amountRaw, setAmountRaw] = useState(existing ? (Math.abs(existing.amountMinor) / 100).toFixed(2).replace(".", ",") : "");
  const [amountMinor, setAmountMinor] = useState<number | null>(existing ? Math.abs(existing.amountMinor) : null);
  const [isReversal, setIsReversal] = useState((existing?.amountMinor ?? 0) < 0);
  const [currency, setCurrency] = useState<string>(existing?.currency ?? "TRY");
  const [showCurrency, setShowCurrency] = useState((existing?.currency ?? "TRY") !== "TRY");
  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null);
  const [sourceId, setSourceId] = useState<string | null>(existing?.paymentSourceId ?? null);
  // persons load async (live query) — deriving keeps "self" as the default
  // even when the modal mounts before the first query resolves.
  const [personChoice, setPersonChoice] = useState<string | null>(existing?.personId ?? null);
  const personId = personChoice ?? persons.find((p) => p.isSelf)?.id ?? persons[0]?.id ?? null;
  // When did it happen? New entries default to "month only" (dateless) — the
  // month is what matters, a specific day is optional. An existing dateless row
  // (isAggregate) reopens in month mode; a dated row in day mode.
  const [dateMode, setDateMode] = useState<"month" | "day">(existing ? (existing.isAggregate ? "month" : "day") : "month");
  const initialOccurrenceDate = existing?.purchaseDate ?? existing?.effectiveDate ?? todayISO();
  const [monthKey, setMonthKey] = useState<MonthKey>(monthKeyOf(initialOccurrenceDate));
  const [dateStr, setDateStr] = useState(initialOccurrenceDate);
  const [note, setNote] = useState(existing?.note ?? "");
  const [installment, setInstallment] = useState(false);
  const [countStr, setCountStr] = useState("2");
  const [paidStr, setPaidStr] = useState("0");
  const [busy, setBusy] = useState(false);

  // Smart defaults (new entries only): remember last used category/source.
  React.useEffect(() => {
    if (isEdit) return;
    void kv.get(`helix.last.${entryType}`).then((v) => {
      if (!v) return;
      try {
        const parsed = JSON.parse(v) as { categoryId?: string; sourceId?: string };
        const expectedKind = entryType === "income" ? "income" : "expense";
        if (parsed.categoryId && categories.some((c) => c.id === parsed.categoryId && c.kind === expectedKind)) {
          setCategoryId(parsed.categoryId);
        }
        if (parsed.sourceId && sources.some((s) => s.id === parsed.sourceId)) setSourceId(parsed.sourceId);
      } catch {}
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryType]);

  useFxRates();
  const today = todayISO();
  const selectedRateDate = dateMode === "month"
    ? (monthKey === monthKeyOf(today) ? today : lastDayOf(monthKey))
    : (/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr as ISODate : today);
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
  const unsignedTryMinor =
    amountMinor == null || effectiveRateTry == null ? null : convertToTryMinor(amountMinor, effectiveRateTry);
  const signedAmountMinor = amountMinor == null ? null : isReversal ? -amountMinor : amountMinor;
  const tryMinor = unsignedTryMinor == null ? null : isReversal ? -unsignedTryMinor : unsignedTryMinor;

  const kindForCategories = entryType === "income" ? "income" : "expense";
  const categoryOptions = categories
    .filter((c) => c.kind === kindForCategories)
    .map((c) => ({ value: c.id, label: `${categoryIcon(c)} ${c.name}` }));

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
  const dateValid = dateless || /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  const count = Number(countStr);
  const paid = Number(paidStr);
  const installmentValid =
    !installment || (isValidInstallmentCount(count) && count >= 2 && Number.isInteger(paid) && paid >= 0 && paid < count);
  // A category is mandatory for every entry (no "uncategorized" rows).
  const canSave =
    amountMinor != null && amountMinor > 0 && tryMinor != null && personId != null && dateValid && installmentValid && categoryId != null &&
    cardCycleValid && !(installment && isReversal);

  const cardStatementPreview = isCreditCardExpense && isValidCardCycle(cardCycle) && dateValid
    ? statementForPurchase(dateStr, cardCycle)
    : null;

  const fail = (msg: string) => void appAlert(msg, tr.errors.title);

  const save = async (thenNew: boolean) => {
    if (!canSave || !personId) return;
    setBusy(true);
    try {
      assertISODate(effectiveDate);
      const fxRate = currency === "TRY" ? null : String(effectiveRateTry);
      if (isEdit) {
        await updateTransaction(userId, existing as unknown as Record<string, unknown>, {
          type: entryType,
          amountMinor: signedAmountMinor!,
          currency,
          fxRate,
          amountTryMinor: tryMinor!,
          effectiveDate,
          isAggregate: dateless,
          categoryId: categoryId!,
          paymentSourceId: sourceId,
          personId,
          note: note.trim() || null,
        });
        scheduleSync(userId);
        close();
        return;
      }
      if (installment) {
        const person = persons.find((p) => p.id === personId)!;
        await createInstallmentPlan(userId, {
          title: note.trim() || tr.installments.defaultTitle(formatMinor(amountMinor!, currency)),
          kind: "card_installment",
          totalAmountMinor: amountMinor!,
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
          personId,
          personIsSelf: person.isSelf,
          categoryId: categoryId!,
          note: note.trim() || null,
          tryFactor: currency === "TRY" ? 1 : effectiveRateTry!,
        });
      } else {
        await addTransaction(userId, {
          type: entryType,
          amountMinor: signedAmountMinor!,
          currency,
          fxRate,
          amountTryMinor: tryMinor!,
          effectiveDate,
          isAggregate: dateless,
          categoryId: categoryId!,
          paymentSourceId: sourceId,
          personId,
          note: note.trim() || null,
        });
      }
      void kv.set(`helix.last.${entryType}`, JSON.stringify({ categoryId, sourceId }));
      scheduleSync(userId);
      if (thenNew) {
        setAmountRaw("");
        setAmountMinor(null);
        setIsReversal(false);
        setNote("");
      } else {
        close();
      }
    } catch (e) {
      // Never surface a raw engine error (English, technical) to the user.
      devError("transaction.save", e);
      fail(e instanceof CreditCardCycleRequiredError ? tr.sources.cycleRequired : tr.errors.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  // Desktop: Enter saves (unless the note textarea or a popup has focus).
  useSubmitOnEnter(() => void save(false), canSave && !busy);

  return (
    <Screen>
      <Stack.Screen options={{ title: isEdit ? tr.tx.edit : tr.tx.new }} />
      <Segmented
        options={[
          { value: "expense", label: tr.tx.expense },
          { value: "income", label: tr.tx.income },
          { value: "transfer", label: tr.tx.transferInvest },
        ]}
        value={entryType}
        onChange={(v) => {
          setEntryType(v);
          setIsReversal(false);
          setCategoryId((current) => {
            if (!current || v === "transfer") return current;
            const expectedKind = v === "income" ? "income" : "expense";
            return categories.some((category) => category.id === current && category.kind === expectedKind) ? current : null;
          });
          if (v !== "expense") setInstallment(false);
        }}
      />

      <MoneyField
        label={`${tr.tx.amount} · ${currency}`}
        value={amountRaw}
        expression
        placeholder={useRotatingPlaceholder(placeholderPools.amount)}
        onChangeMinor={(raw, minor) => {
          setAmountRaw(raw);
          if (minor != null && minor < 0) setIsReversal(true);
          setAmountMinor(minor == null ? null : Math.abs(minor));
        }}
      />
      <Row style={{ marginTop: -spacing.sm, marginBottom: spacing.md, alignItems: "center" }}>
        <Body style={{ flex: 1, paddingRight: spacing.md }}>{tr.tx.reversalLabel(entryType)}</Body>
        <Toggle
          label={tr.tx.reversalLabel(entryType)}
          value={isReversal}
          disabled={installment}
          onValueChange={(value) => {
            setIsReversal(value);
            if (value) setInstallment(false);
          }}
        />
      </Row>
      {isReversal ? <Body muted style={{ marginTop: -spacing.sm, marginBottom: spacing.md }}>{tr.tx.reversalHint}</Body> : null}
      {showCurrency ? (
        <>
          <Label>{tr.tx.currency}</Label>
          <ChipPicker
            options={SUPPORTED_CURRENCIES.map((c) => ({ value: c, label: c }))}
            value={currency as never}
            onChange={(c) => setCurrency(c)}
          />
        </>
      ) : (
        <View style={{ alignSelf: "flex-start", marginBottom: spacing.md }}>
          <Button size="sm" variant="ghost" label={tr.tx.changeCurrency} onPress={() => setShowCurrency(true)} />
        </View>
      )}
      {currency !== "TRY" ? (
        <View style={{ marginBottom: spacing.md }}>
          {tryMinor != null ? <Body muted>{tr.tx.tryEquivalent(formatMinor(tryMinor))}</Body> : <Body muted>{tr.tx.rateNotFound}</Body>}
          {!historicalRateTry && rate?.isStale ? <Badge text={`⚠ ${tr.tx.staleRate}`} tone="warning" /> : null}
        </View>
      ) : null}

      <Label>{tr.tx.category}</Label>
      {categoryOptions.length > 0 ? (
        <ChipPicker options={categoryOptions} value={categoryId} onChange={setCategoryId} />
      ) : (
        <View style={{ marginBottom: spacing.md }}>
          <Body muted style={{ marginBottom: spacing.sm }}>{tr.tx.categoryRequiredEmpty}</Body>
          <Button size="sm" variant="secondary" label={tr.settings.categories} onPress={() => router.push("/columns-editor")} />
        </View>
      )}

      {sources.length > 0 && entryType !== "income" ? (
        <>
          <Label>{tr.tx.source}</Label>
          <ChipPicker options={sources.map((s) => ({ value: s.id, label: s.name }))} value={sourceId} onChange={setSourceId} />
        </>
      ) : null}

      {persons.length > 1 ? (
        <>
          <Label>{tr.tx.person}</Label>
          <ChipPicker options={persons.map((p) => ({ value: p.id, label: p.name }))} value={personId} onChange={setPersonChoice} />
        </>
      ) : null}

      <Label>{isCreditCardExpense ? tr.tx.cardPurchaseDate : tr.tx.whenLabel}</Label>
      {!isCreditCardExpense ? (
        <Segmented
          options={[
            { value: "month", label: tr.tx.monthOnly },
            { value: "day", label: tr.tx.specificDay },
          ]}
          value={dateMode}
          onChange={setDateMode}
        />
      ) : null}
      {dateless ? (
        <>
          <MonthStepper value={monthKey} onChange={setMonthKey} />
          <Body muted style={{ marginTop: -spacing.sm, marginBottom: spacing.md, fontSize: 12 }}>
            {tr.tx.monthOnlyHint(monthLabel(monthKey))}
          </Body>
        </>
      ) : (
        <>
          <DateField label={isCreditCardExpense ? tr.tx.cardPurchaseDate : tr.tx.effectiveDate} value={dateStr} onChange={setDateStr} />
          <Body muted style={{ marginTop: -spacing.sm, marginBottom: spacing.md, fontSize: 12 }}>
            {cardStatementPreview
              ? tr.tx.cardPurchaseHint(dateLabel(cardStatementPreview.statementDate), dateLabel(cardStatementPreview.dueDate))
              : isCreditCardExpense ? tr.tx.cardCycleMissing
              : dateStr > todayISO() ? tr.tx.futureHint : tr.tx.effectiveDateHint}
          </Body>
          {isCreditCardExpense && !cardCycleValid ? (
            <Button size="sm" variant="secondary" label={tr.settings.sources} onPress={() => router.push("/(tabs)/settings/payment-sources")} />
          ) : null}
        </>
      )}

      {!isEdit && entryType === "expense" && sources.find((s) => s.id === sourceId)?.type === "credit_card" ? (
        <View style={{ marginVertical: spacing.md }}>
          <Segmented
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
            <Body muted>{tr.tx.installmentInfo(formatMinor(Math.trunc(amountMinor / count), currency), count)}</Body>
          ) : null}
        </View>
      ) : null}

      <Field label={tr.common.note} value={note} onChangeText={setNote} multiline placeholder={useRotatingPlaceholder(placeholderPools.note)} />

      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        <Button label={tr.common.save} onPress={() => void save(false)} disabled={!canSave} loading={busy} />
        {!isEdit ? (
          <Button label={tr.tx.saveAndNew} variant="secondary" onPress={() => void save(true)} disabled={!canSave || busy} />
        ) : null}
      </View>
    </Screen>
  );
}
