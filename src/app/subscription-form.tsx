/** Subscription add/edit modal. Price edits append to price_history (spec §3.1). */

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BellRing, CalendarClock, Repeat2, type LucideIcon } from "lucide-react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { createRecordId, CreditCardCycleRequiredError, ensureSubscriptionCategory, upsertSubscription } from "../data/repo";
import { useCategoriesState, usePersonsState, useSourcesState, useSubscriptionsState, useUserId } from "../data/hooks";
import { combineLiveQueryStatus } from "../data/live-state";
import { classifyRecordId } from "../domain/route-params";
import { categoryIcon, paymentSourceIcon } from "../data/category-icons";
import { dueDateInMonth, nextDueAfter } from "../domain/recurrence";
import { isMonthDay, monthKeyOf, todayISO, type ISODate } from "../domain/dates";
import { formatMinor } from "../domain/money";
import { dateLabel, tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { CurrencyPicker } from "../ui/currency-picker";
import { Body, Button, Card, ChipPicker, DataStateNotice, Field, Label, MoneyField, Row, Screen, Segmented, Select, Spread, Toggle } from "../ui/components";
import { useSubmitOnEnter } from "../ui/keyboard";
import { appAlert } from "../ui/dialog";
import { DateField } from "../ui/calendar";
import { placeholderPools, useRotatingPlaceholder } from "../ui/placeholders";
import { devError } from "../services/logger";
import { navigateBack } from "../ui/navigation";
import { useOperationGuard } from "../ui/operation-guard";
import { useDirtyExitGuard } from "../ui/dirty-exit";
import { MonthDayField } from "../ui/month-day-field";
import { Logo } from "../ui/logo";
import { font, radius, spacing, type, useTheme } from "../ui/theme";

// Same quick-day set as the recurring-income form (no "20"; six chips fit one
// row on a phone).
const QUICK_DAYS = [1, 5, 10, 15, 25, 28] as const;

function FormSectionTitle({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md }}>
      <View style={{ width: 36, height: 36, borderRadius: 13, backgroundColor: palette.primarySoft, alignItems: "center", justifyContent: "center" }}>
        <Icon accessible={false} size={18} color={palette.primary} />
      </View>
      <Text accessibilityRole="header" style={[type.heading, { color: palette.text }]}>{title}</Text>
    </View>
  );
}

function SubscriptionFormArtwork({ name, cycle, schedule }: { name: string; cycle: "monthly" | "yearly" | "custom"; schedule: string }) {
  const { palette } = useTheme();
  const cycleLabel = cycle === "monthly" ? tr.subs.monthly : cycle === "yearly" ? tr.subs.yearly : tr.subs.custom;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${name || tr.subs.formIdentity}. ${cycleLabel}. ${schedule || tr.common.none}`}
      style={{
        minHeight: 104,
        borderRadius: radius.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border,
        backgroundColor: palette.surfaceAlt,
        padding: spacing.md,
        marginBottom: spacing.md,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        overflow: "hidden",
      }}
    >
      <Logo name={name || tr.subs.title} domain="" size={52} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.heading, { color: palette.text, fontFamily: font.semibold }]}>{name || tr.subs.formIdentity}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm }}>
          <Repeat2 accessible={false} size={14} color={palette.primary} />
          <Text style={[type.small, { color: palette.textSecondary }]}>{cycleLabel}</Text>
          <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: palette.border }} />
          <CalendarClock accessible={false} size={14} color={palette.tertiary} />
          <Text style={[type.small, { color: palette.textSecondary, flexShrink: 1 }]}>
            {schedule || (cycle === "yearly" ? tr.subs.yearlyRenewalDate : tr.subs.billingDay)}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function SubscriptionFormModal() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const record = classifyRecordId(id);
  const subscriptionsState = useSubscriptionsState();
  const existing = record?.mode === "edit" ? subscriptionsState.data.find((s) => s.id === record.id) : undefined;
  // Loading is `updatedAt == null`; anything after that is a row that does not
  // exist, which must recover instead of rendering a permanent blank screen.
  if (!record) return <Redirect href="/(tabs)/subscriptions" />;
  if (record.mode === "edit" && !existing) {
    if (subscriptionsState.updatedAt == null) {
      return (
        <Screen scroll={false}>
          <DataStateNotice status={subscriptionsState.status} retry={subscriptionsState.retry} />
        </Screen>
      );
    }
    return <Redirect href="/(tabs)/subscriptions" />;
  }
  return <SubscriptionForm key={existing?.id ?? "new"} existing={existing} />;
}

function SubscriptionForm({ existing }: { existing?: ReturnType<typeof useSubscriptionsState>["data"][number] }) {
  const userId = useUserId();
  const categoriesState = useCategoriesState();
  const sourcesState = useSourcesState();
  const personsState = usePersonsState();
  const categories = categoriesState.data;
  const sources = sourcesState.data;
  const persons = personsState.data;
  const router = useRouter();
  const { palette } = useTheme();
  const close = () => navigateBack(router, "/(tabs)/subscriptions");

  const [name, setName] = useState(existing?.name ?? "");
  const [amountRaw, setAmountRaw] = useState(existing ? (existing.amountMinor / 100).toFixed(2).replace(".", ",") : "");
  const [amountMinor, setAmountMinor] = useState<number | null>(existing?.amountMinor ?? null);
  const [currency, setCurrency] = useState(existing?.currency ?? "TRY");
  const [showCurrency, setShowCurrency] = useState((existing?.currency ?? "TRY") !== "TRY");
  const [cycle, setCycle] = useState<"monthly" | "yearly" | "custom">(existing?.cycle ?? "monthly");
  const [intervalStr, setIntervalStr] = useState(String(existing?.intervalMonths ?? 1));
  const [billingDayStr, setBillingDayStr] = useState(String(existing?.billingDay ?? 1));
  const [yearlyRenewalDate, setYearlyRenewalDate] = useState<ISODate | null>(
    existing?.cycle === "yearly" ? existing.nextDueDate : null,
  );
  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null);
  const [sourceId, setSourceId] = useState<string | null>(existing?.paymentSourceId ?? null);
  // persons load async (live query) — derive the default instead of freezing
  // a null initial state computed before the first query resolves.
  const [personChoice, setPersonChoice] = useState<string | null>(existing?.personId ?? null);
  const personId = personChoice ?? persons.find((p) => p.isSelf)?.id ?? persons[0]?.id ?? null;
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [autoPay, setAutoPay] = useState(existing?.autoPay ?? false);
  const [isTrial, setIsTrial] = useState(existing?.trialEndDate != null);
  const [trialDate, setTrialDate] = useState<string | null>(existing?.trialEndDate ?? null);
  // Logos are derived from the name (ui/logo.tsx); the old manual domain
  // field is gone but stored values keep working as a favicon fallback.
  const domain = existing?.websiteDomain ?? "";
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [showCategoryOffer, setShowCategoryOffer] = useState(false);
  const operationGuard = useOperationGuard();
  const liveStates = [categoriesState, sourcesState, personsState];
  const dataStatus = combineLiveQueryStatus(liveStates);
  const dataReady = liveStates.every((state) => state.updatedAt != null);
  const retryData = () => {
    categoriesState.retry();
    sourcesState.retry();
    personsState.retry();
  };
  const [draftId] = useState(() => existing?.id ?? createRecordId());
  const draftSnapshot = JSON.stringify({
    name,
    amountRaw,
    currency,
    cycle,
    intervalStr,
    billingDayStr,
    yearlyRenewalDate,
    categoryId,
    sourceId,
    personChoice,
    isActive,
    autoPay,
    isTrial,
    trialDate,
    note,
  });
  const initialDraftSnapshot = React.useRef(draftSnapshot).current;
  const { allowExit } = useDirtyExitGuard(draftSnapshot !== initialDraftSnapshot && !busy);

  const billingDay = cycle === "yearly" && yearlyRenewalDate
    ? Number(yearlyRenewalDate.slice(8, 10))
    : Number(billingDayStr);
  const intervalMonths = cycle === "monthly" ? 1 : cycle === "yearly" ? 12 : Number(intervalStr);
  const trialValid = !isTrial || trialDate != null;
  const selectedSource = sources.find((source) => source.id === sourceId);
  const sourceValid = !selectedSource || selectedSource.type !== "credit_card" || Boolean(
    selectedSource.statementDay != null && selectedSource.statementDay >= 1 && selectedSource.statementDay <= 31 &&
    selectedSource.dueDay != null && selectedSource.dueDay >= 1 && selectedSource.dueDay <= 31
  );
  const baseValid =
    dataReady &&
    name.trim() !== "" &&
    amountMinor != null &&
    amountMinor > 0 &&
    isMonthDay(billingDay) &&
    (cycle !== "yearly" || yearlyRenewalDate != null) &&
    Number.isInteger(intervalMonths) &&
    intervalMonths >= 1 &&
    trialValid &&
    personId != null &&
    sourceValid;
  const expenseCategories = categories.filter((category) => category.kind === "expense");
  const selectedCategoryId = expenseCategories.some((category) => category.id === categoryId) ? categoryId : null;

  const persist = async (resolvedCategoryId: string) => {
    if (!personId) return;
    const today = todayISO();
    const nextDueDate = cycle === "yearly" && yearlyRenewalDate
      ? yearlyRenewalDate
      : existing
        ? existing.billingDay === billingDay && existing.intervalMonths === intervalMonths
          ? existing.nextDueDate
          : nextDueAfter(today, today, intervalMonths, billingDay)
        : dueDateInMonth(monthKeyOf(today), billingDay) >= today
          ? dueDateInMonth(monthKeyOf(today), billingDay)
          : nextDueAfter(today, today, intervalMonths, billingDay);
    await upsertSubscription(userId, {
      id: draftId,
      name: name.trim(),
      amountMinor: amountMinor!,
      currency,
      cycle,
      intervalMonths,
      billingDay,
      nextDueDate,
      paymentSourceId: sourceId,
      categoryId: resolvedCategoryId,
      personId,
      isActive,
      trialEndDate: isTrial ? trialDate : null,
      autoPay,
      websiteDomain: domain || null,
      note: note.trim() || null,
    });
    scheduleSync(userId);
    allowExit(close);
  };

  const save = async () => {
    if (!baseValid || !personId) return;
    if (!selectedCategoryId) {
      setShowCategoryOffer(true);
      return;
    }
    await operationGuard.run(async () => {
      setBusy(true);
      try {
        await persist(selectedCategoryId);
      } catch (e) {
        devError("subscription.save", e);
        void appAlert(e instanceof CreditCardCycleRequiredError ? tr.sources.cycleRequired : tr.errors.saveFailed, tr.errors.title);
      } finally {
        setBusy(false);
      }
    });
  };

  const acceptCategoryOffer = async () => {
    if (!baseValid) return;
    await operationGuard.run(async () => {
      setBusy(true);
      try {
        const resolvedCategoryId = await ensureSubscriptionCategory(userId, tr.subs.suggestedCategoryName);
        setCategoryId(resolvedCategoryId);
        setShowCategoryOffer(false);
        await persist(resolvedCategoryId);
      } catch (e) {
        devError("subscription.category", e);
        void appAlert(tr.errors.saveFailed, tr.errors.title);
      } finally {
        setBusy(false);
      }
    });
  };

  useSubmitOnEnter(() => void save(), baseValid && !busy);

  const namePlaceholder = useRotatingPlaceholder(placeholderPools.subscription);
  if (!dataReady) {
    return (
      <Screen>
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

  return (
    <Screen>
      <DataStateNotice status={dataStatus} retry={retryData} />
      <SubscriptionFormArtwork
        name={name}
        cycle={cycle}
        schedule={cycle === "yearly"
          ? (yearlyRenewalDate ? dateLabel(yearlyRenewalDate) : "")
          : (billingDayStr ? tr.subs.daySchedule(billingDayStr) : "")}
      />
      <Card>
        <FormSectionTitle icon={Repeat2} title={tr.subs.formIdentity} />
        <Field label={tr.subs.name} value={name} onChangeText={setName} placeholder={namePlaceholder} />
        <MoneyField
          label={`${tr.tx.amount} · ${currency}`}
          value={amountRaw}
          onChangeMinor={(raw, minor) => {
            setAmountRaw(raw);
            setAmountMinor(minor);
          }}
        />
        {showCurrency ? (
          <>
            <Label>{tr.tx.currency}</Label>
            <CurrencyPicker value={currency} onChange={setCurrency} />
          </>
        ) : (
          <View style={{ alignSelf: "flex-start" }}>
            <Button size="sm" variant="ghost" label={tr.tx.changeCurrency} onPress={() => setShowCurrency(true)} />
          </View>
        )}
      </Card>

      <Card>
        <FormSectionTitle icon={CalendarClock} title={tr.subs.formSchedule} />
        <Label>{tr.subs.cycle}</Label>
        <Segmented
          options={[
            { value: "monthly", label: tr.subs.monthly },
            { value: "yearly", label: tr.subs.yearly },
            { value: "custom", label: tr.subs.custom },
          ]}
          value={cycle}
          onChange={setCycle}
        />
        {cycle === "custom" ? (
          <>
            <Field label={tr.subs.intervalLabel} value={intervalStr} onChangeText={setIntervalStr} keyboardType="number-pad" />
            <Body muted style={{ marginTop: -spacing.xs, marginBottom: spacing.md, fontSize: 12 }}>{tr.subs.intervalHint}</Body>
          </>
        ) : null}

        {cycle === "yearly" ? (
          <>
            <DateField
              label={tr.subs.yearlyRenewalDate}
              value={yearlyRenewalDate}
              min={todayISO()}
              onChange={(date) => {
                setYearlyRenewalDate(date);
                setBillingDayStr(String(Number(date.slice(8, 10))));
              }}
            />
            <Body muted style={{ marginTop: -spacing.xs, marginBottom: spacing.md, fontSize: 12 }}>
              {tr.subs.yearlyRenewalHint}
            </Body>
          </>
        ) : (
          <>
            <MonthDayField
              label={tr.subs.billingDay}
              value={billingDayStr}
              onChange={setBillingDayStr}
              quickDays={QUICK_DAYS}
              error={billingDayStr !== "" && !isMonthDay(billingDayStr) ? tr.incomes.dayError : null}
            />
            <Body muted style={{ marginTop: -spacing.xs, marginBottom: spacing.md, fontSize: 12 }}>
              {tr.subs.billingDayHint}
            </Body>
          </>
        )}

        {expenseCategories.length > 0 ? (
          <Select
            label={tr.tx.category}
            placeholder={tr.tx.categoryPlaceholder}
            options={expenseCategories.map((category) => ({ value: category.id, label: category.name, icon: categoryIcon(category) }))}
            value={selectedCategoryId}
            onChange={(value) => {
              setCategoryId(value);
              setShowCategoryOffer(false);
            }}
            onCreate={{ label: tr.tx.addCategory, run: () => router.push("/columns-editor") }}
          />
        ) : null}
        {showCategoryOffer && !selectedCategoryId ? (
          <View style={{ backgroundColor: palette.primarySoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}>
            <Body style={{ marginBottom: spacing.sm }}>{tr.subs.categoryOffer}</Body>
            <Row gap={spacing.sm} style={{ alignItems: "center", flexWrap: "wrap" }}>
              <Button
                size="sm"
                label={tr.subs.categoryOfferAccept}
                onPress={() => void acceptCategoryOffer()}
                loading={busy}
              />
              <Button
                size="sm"
                variant="ghost"
                label={tr.subs.categoryOfferDecline}
                onPress={() => setShowCategoryOffer(false)}
                disabled={busy}
              />
            </Row>
          </View>
        ) : null}
        {sources.length > 0 ? (
          <>
            <Select
              label={tr.tx.source}
              placeholder={tr.tx.sourcePlaceholder}
              options={sources.map((s) => ({ value: s.id, label: s.name, icon: paymentSourceIcon(s.type) }))}
              value={sourceId}
              onChange={setSourceId}
              onCreate={{ label: tr.tx.addSource, run: () => router.push("/payment-sources") }}
            />
            {!sourceValid ? (
              <Body muted style={{ marginBottom: spacing.sm }}>{tr.tx.cardCycleMissing}</Body>
            ) : null}
          </>
        ) : null}
        {persons.length > 1 ? (
          <>
            <Label>{tr.tx.person}</Label>
            <ChipPicker options={persons.map((p) => ({ value: p.id, label: p.name }))} value={personId} onChange={setPersonChoice} />
          </>
        ) : null}
      </Card>

      <Card>
        <FormSectionTitle icon={BellRing} title={tr.subs.formBehavior} />
        <Spread style={{ marginBottom: spacing.md }}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Body>{tr.subs.trialToggle}</Body>
            <Body muted style={{ fontSize: 12 }}>{tr.subs.trialToggleHint}</Body>
          </View>
          <Toggle label={tr.subs.trialToggle} value={isTrial} onValueChange={setIsTrial} />
        </Spread>
        {isTrial ? <DateField label={tr.subs.trialDate} value={trialDate} onChange={setTrialDate} /> : null}
        <Field label={tr.common.note} value={note} onChangeText={setNote} multiline placeholder={tr.common.optionalHint} />

        <Spread style={{ marginBottom: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Body>{tr.subs.autoPay}</Body>
            <Body muted>{tr.subs.autoPayHint}</Body>
          </View>
          <Toggle label={tr.subs.autoPay} value={autoPay} onValueChange={setAutoPay} />
        </Spread>
        <Spread style={{ marginBottom: spacing.lg }}>
          <Body>{tr.common.active}</Body>
          <Toggle label={tr.common.active} value={isActive} onValueChange={setIsActive} />
        </Spread>

        {existing && amountMinor != null && amountMinor !== existing.amountMinor ? (
          <Body muted style={{ marginBottom: spacing.md }}>
            {tr.subs.priceHistory}: {formatMinor(existing.amountMinor, existing.currency)} → {formatMinor(amountMinor, currency)}
          </Body>
        ) : null}
      </Card>

      <Button label={tr.common.save} onPress={() => void save()} disabled={!baseValid} loading={busy} />
    </Screen>
  );
}
