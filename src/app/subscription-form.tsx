/** Subscription add/edit modal. Price edits append to price_history (spec §3.1). */

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ArrowRight, BellRing, CalendarClock, Repeat2 } from "lucide-react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { createRecordId, CreditCardCycleRequiredError, ensureSubscriptionCategory, upsertSubscription } from "../data/repo";
import { useCategoriesState, usePersonsState, useSourcesState, useSubscriptionsState, useUserId } from "../data/hooks";
import { combineLiveQueryStatus } from "../data/live-state";
import { classifyRecordId } from "../domain/route-params";
import { categoryIcon, paymentSourceIcon } from "../data/category-icons";
import { advanceDueDate, dueDateInMonth, nextDueAfter } from "../domain/recurrence";
import { normalizedMonthlyLoadMinor } from "../domain/analytics";
import { isMonthDay, monthKeyOf, todayISO, type ISODate } from "../domain/dates";
import { formatMinorCompact, formatMinorInput } from "../domain/money";
import { dateLabel, shortDateLabel, tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { CurrencyPicker } from "../ui/currency-picker";
import { Amount, Body, Button, Card, ChipPicker, DataStateNotice, FadeIn, Field, Label, MoneyField, PanelHeader, Row, Screen, Select, Spread, Toggle } from "../ui/components";
import { useSubmitOnEnter } from "../ui/keyboard";
import { appAlert } from "../ui/dialog";
import { DateField } from "../ui/calendar";
import { placeholderPools, useRotatingPlaceholder } from "../ui/placeholders";
import { devError } from "../services/logger";
import { navigateBack } from "../ui/navigation";
import { useOperationGuard } from "../ui/operation-guard";
import { useDirtyExitGuard, useDraftDirty } from "../ui/dirty-exit";
import { MonthDayField } from "../ui/month-day-field";
import { Logo } from "../ui/logo";
import { font, radius, spacing, type, useTheme } from "../ui/theme";
import { WorkspaceSplit } from "../ui/workspace-layout";
import { PersonAssignment } from "../ui/person-assignment";

// Same quick-day set as the recurring-income form (no "20"; six chips fit one
// row on a phone).
const QUICK_DAYS = [1, 5, 10, 15, 25, 28] as const;

function SubscriptionFormArtwork({
  name,
  cycle,
  intervalMonths,
  amountMinor,
  currency,
  schedule,
  nextDueDate,
  followingDueDate,
}: {
  name: string;
  cycle: "monthly" | "yearly" | "custom";
  intervalMonths: number;
  amountMinor: number | null;
  currency: string;
  schedule: string;
  nextDueDate: ISODate | null;
  followingDueDate: ISODate | null;
}) {
  const { palette } = useTheme();
  const cycleLabel = cycle === "monthly" ? tr.subs.monthly : cycle === "yearly" ? tr.subs.yearly : tr.subs.custom;
  const interval = cycle === "monthly" ? 1 : cycle === "yearly" ? 12 : Math.max(1, Math.min(12, intervalMonths || 1));
  const monthlyMinor = amountMinor == null ? null : normalizedMonthlyLoadMinor(amountMinor, interval);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={tr.subs.previewA11y(
        name || tr.subs.formIdentity,
        cycleLabel,
        schedule || tr.common.none,
        monthlyMinor == null ? tr.common.none : formatMinorCompact(monthlyMinor, currency),
      )}
      style={{
        marginBottom: spacing.lg,
        gap: spacing.md,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <Logo name={name || tr.subs.title} domain="" size={46} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.heading, { color: palette.text, fontFamily: font.semibold }]}>{name || tr.subs.formIdentity}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs }}>
            <Repeat2 accessible={false} size={14} color={palette.primary} />
            <Text style={[type.small, { color: palette.textSecondary }]}>{cycleLabel}</Text>
            <Text style={[type.small, { color: palette.textSecondary, flexShrink: 1 }]}>
              · {schedule || (cycle === "yearly" ? tr.subs.yearlyRenewalDate : tr.subs.billingDay)}
            </Text>
          </View>
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        {[nextDueDate, followingDueDate].map((date, index) => (
          <React.Fragment key={index === 0 ? "next" : "following"}>
            {index === 1 ? (
              <FadeIn delay={90} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <View style={{ width: 10, height: StyleSheet.hairlineWidth, backgroundColor: palette.border }} />
                <ArrowRight accessible={false} size={14} color={palette.primary} />
                <View style={{ width: 10, height: StyleSheet.hairlineWidth, backgroundColor: palette.border }} />
              </FadeIn>
            ) : null}
            <FadeIn
              delay={index * 120}
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 58,
                justifyContent: "center",
                paddingHorizontal: spacing.sm,
                paddingVertical: spacing.xs,
                borderRadius: radius.md,
                backgroundColor: index === 0 ? palette.primarySoft : palette.surfaceAlt,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: index === 0 ? palette.primary + "70" : palette.border,
              }}
            >
              <Text style={[type.small, { color: palette.textSecondary, fontSize: type.micro.fontSize }]}>
                {index === 0 ? tr.subs.nextCharge : tr.subs.followingCharge}
              </Text>
              <Text style={[type.label, { color: index === 0 ? palette.primaryText : palette.text, marginTop: 2 }]}>
                {date ? shortDateLabel(date) : "—"}
              </Text>
            </FadeIn>
          </React.Fragment>
        ))}
      </View>

      <View style={{ flexDirection: "row", alignItems: "stretch" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.small, { color: palette.textSecondary, fontSize: type.micro.fontSize }]}>{tr.subs.monthlyEquivalent}</Text>
          {monthlyMinor == null ? (
            <Text style={[type.amountSm, { color: palette.text, marginTop: 2 }]}>—</Text>
          ) : (
            <Amount minor={monthlyMinor} currency={currency} colorized={false} style={{ fontSize: type.label.fontSize, textAlign: "left", marginTop: 2 }} />
          )}
        </View>
        <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginHorizontal: spacing.sm }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.small, { color: palette.textSecondary, fontSize: type.micro.fontSize }]}>{tr.subs.annualEquivalent}</Text>
          {monthlyMinor == null ? (
            <Text style={[type.amountSm, { color: palette.text, marginTop: 2 }]}>—</Text>
          ) : (
            <Amount minor={monthlyMinor * 12} currency={currency} colorized={false} style={{ fontSize: type.label.fontSize, textAlign: "left", marginTop: 2 }} />
          )}
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
          <Stack.Screen options={{ title: tr.subs.edit }} />
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
  const [amountRaw, setAmountRaw] = useState(existing ? formatMinorInput(existing.amountMinor) : "");
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
  const { allowExit, confirmDiscard } = useDirtyExitGuard(useDraftDirty(draftSnapshot, dataReady) && !busy);

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
  const today = todayISO();
  const previewDueDate: ISODate | null =
    cycle === "yearly"
      ? yearlyRenewalDate
      : isMonthDay(billingDay) && Number.isInteger(intervalMonths) && intervalMonths >= 1
        ? dueDateInMonth(monthKeyOf(today), billingDay) >= today
          ? dueDateInMonth(monthKeyOf(today), billingDay)
          : nextDueAfter(today, today, intervalMonths, billingDay)
        : null;
  const followingDueDate =
    previewDueDate && isMonthDay(billingDay) && Number.isInteger(intervalMonths) && intervalMonths >= 1
      ? advanceDueDate(previewDueDate, intervalMonths, billingDay)
      : null;

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
      id: existing ? draftId : undefined,
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
    <Screen width="workspace">
      <Stack.Screen options={{ title: existing ? tr.subs.edit : tr.subs.add }} />
      <DataStateNotice status={dataStatus} retry={retryData} />
      <WorkspaceSplit
        testID="subscription-form-workspace"
        primary={(
          <Card>
            <SubscriptionFormArtwork
              name={name}
              cycle={cycle}
              intervalMonths={Number(intervalStr)}
              amountMinor={amountMinor}
              currency={currency}
              nextDueDate={previewDueDate}
              followingDueDate={followingDueDate}
              schedule={cycle === "yearly"
                ? (yearlyRenewalDate ? dateLabel(yearlyRenewalDate) : "")
                : (billingDayStr ? tr.subs.daySchedule(billingDayStr) : "")}
            />
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
        )}
        secondary={(
          <Card>
            <PanelHeader icon={CalendarClock} title={tr.subs.formSchedule} description={tr.subs.formScheduleHint} />
            <Label>{tr.subs.cycle}</Label>
            <ChipPicker
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
                <Body muted style={{ marginTop: -spacing.xs, marginBottom: spacing.md, fontSize: type.small.fontSize }}>{tr.subs.intervalHint}</Body>
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
                <Body muted style={{ marginTop: -spacing.xs, marginBottom: spacing.md, fontSize: type.small.fontSize }}>
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
                <Body muted style={{ marginTop: -spacing.xs, marginBottom: spacing.md, fontSize: type.small.fontSize }}>
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
            <PersonAssignment people={persons} value={personId} onChange={setPersonChoice} />
          </Card>
        )}
      />

      <Card>
        <PanelHeader icon={BellRing} title={tr.subs.formBehavior} description={tr.subs.formBehaviorHint} />
        <Spread style={{ marginBottom: spacing.md }}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Body>{tr.subs.trialToggle}</Body>
            <Body muted style={{ fontSize: type.small.fontSize }}>{tr.subs.trialToggleHint}</Body>
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
            {tr.subs.priceHistory}: {formatMinorCompact(existing.amountMinor, existing.currency)} → {formatMinorCompact(amountMinor, currency)}
          </Body>
        ) : null}
      </Card>

      <Row style={{ alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Button label={tr.common.save} onPress={() => void save()} disabled={!baseValid} loading={busy} />
        </View>
        <Button
          label={tr.common.cancel}
          variant="secondary"
          disabled={busy}
          onPress={() => confirmDiscard(close)}
        />
      </Row>
    </Screen>
  );
}
