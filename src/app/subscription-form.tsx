/** Subscription add/edit modal. Price edits append to price_history (spec §3.1). */

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import ArrowRight from "lucide-react-native/icons/arrow-right";
import BellRing from "lucide-react-native/icons/bell-ring";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import Repeat2 from "lucide-react-native/icons/repeat-2";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { createRecordId, CreditCardCycleRequiredError, ensureSubscriptionCategory, upsertSubscription } from "../data/repo";
import { useAnsweredForId, useCategoriesState, usePersonsState, useSourcesState, useSubscriptionsState, useUserId } from "../data/hooks";
import { combineLiveStates } from "../data/live-state";
import { classifyRecordId } from "../domain/route-params";
import { advanceDueDate, dueDateInMonth, nextDueAfter } from "../domain/recurrence";
import { isValidCardCycle } from "../domain/card-statements";
import { normalizedMonthlyLoadMinor } from "../domain/analytics";
import { currencyLabel } from "../domain/fx-provider";
import { isMonthDay, monthKeyOf, todayISO, type ISODate } from "../domain/dates";
import { formatMinorCompact, formatMinorInput } from "../domain/money";
import { dateLabel, shortDateLabel, tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { categoryIconComponent } from "../ui/category-icon";
import { Logo, PaymentSourceLogo } from "../ui/logo";
import { CurrencyPicker } from "../ui/currency-picker";
import { Amount, Body, Button, Card, ChipPicker, DataGateScreen, DataStateNotice, FadeIn, Field, FieldNote, InlineDisclosure, Label, MoneyField, PanelHeader, Row, Screen, Select, Spread, Toggle } from "../ui/components";
import { useSubmitOnEnter } from "../ui/keyboard";
import { appAlert } from "../ui/dialog";
import { DateField } from "../ui/calendar";
import { placeholderPools, useRotatingPlaceholder } from "../ui/placeholders";
import { devError } from "../services/logger";
import { navigateBack } from "../ui/navigation";
import { useOperationGuard } from "../ui/operation-guard";
import { useDirtyExitGuard, useDraftDirty } from "../ui/dirty-exit";
import { MonthDayField } from "../ui/month-day-field";
import { font, radius, spacing, type, useTheme } from "../ui/theme";
import { WorkspaceSplit } from "../ui/workspace-layout";
import { assignedPersonId, PersonAssignment } from "../ui/person-assignment";

/** The Select's own icon column, so a source mark fits it exactly. */
const SOURCE_MARK = 22;

// Same quick-day set as the recurring-income form (no "20"; six chips fit one
// row on a phone).
const QUICK_DAYS = [1, 5, 10, 15, 25, 28] as const;

function SubscriptionFormArtwork({
  name,
  cycle,
  intervalMonths,
  amountMinor,
  amountMode,
  currency,
  schedule,
  nextDueDate,
  followingDueDate,
}: {
  name: string;
  cycle: "monthly" | "yearly" | "custom";
  intervalMonths: number;
  amountMinor: number | null;
  amountMode: "fixed" | "variable";
  currency: string;
  schedule: string;
  nextDueDate: ISODate | null;
  followingDueDate: ISODate | null;
}) {
  const { palette } = useTheme();
  const cycleLabel = cycle === "monthly" ? tr.subs.monthly : cycle === "yearly" ? tr.subs.yearly : tr.subs.custom;
  const interval = cycle === "monthly" ? 1 : cycle === "yearly" ? 12 : Math.max(1, Math.min(12, intervalMonths || 1));
  // 0 is the "no estimate yet" sentinel for a variable subscription, not a
  // real forecast — treat it the same as unset rather than showing "₺0,00".
  const knownMinor = amountMinor == null || amountMinor === 0 ? null : amountMinor;
  const monthlyMinor = knownMinor == null ? null : normalizedMonthlyLoadMinor(knownMinor, interval);
  // The year's total divided once, as `subscriptionCostSummary` does: twelve
  // rounded months put ₺1.199,04 here for a ₺1.199 yearly plan.
  const annualMinor = knownMinor == null ? null : normalizedMonthlyLoadMinor(knownMinor * 12, interval);
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

      {/* A variable bill has no monthly or annual equivalent to state: the
          number in the field is a guess, and multiplying a guess by twelve
          presents it as a commitment. That column pair is replaced by what is
          actually true about the rule. */}
      {amountMode === "variable" ? (
        <View>
          <Text style={[type.small, { color: palette.textSecondary, fontSize: type.micro.fontSize }]}>{tr.tx.amount}</Text>
          <Text style={[type.label, { color: palette.text, marginTop: 2 }]}>{tr.subs.variesEachMonth}</Text>
          <Text style={[type.small, { color: palette.textSecondary, marginTop: 2 }]}>
            {monthlyMinor == null
              ? tr.subs.noEstimateYet
              : tr.subs.estimatePerMonth(formatMinorCompact(monthlyMinor, currency))}
          </Text>
        </View>
      ) : (
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
            {annualMinor == null ? (
              <Text style={[type.amountSm, { color: palette.text, marginTop: 2 }]}>—</Text>
            ) : (
              <Amount minor={annualMinor} currency={currency} colorized={false} style={{ fontSize: type.label.fontSize, textAlign: "left", marginTop: 2 }} />
            )}
          </View>
        </View>
      )}
    </View>
  );
}

export default function SubscriptionFormModal() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const record = classifyRecordId(id);
  const subscriptionsState = useSubscriptionsState();
  const existing = record?.mode === "edit" ? subscriptionsState.data.find((s) => s.id === record.id) : undefined;
  // Dated proof, not merely "the query ran": this query is not parameterised
  // by the id, so a completion from before the row was written would otherwise
  // read as "no such subscription". See `useAnsweredForId`.
  const answered = useAnsweredForId(subscriptionsState, record, existing != null);
  if (!record) return <Redirect href="/(tabs)/subscriptions" />;
  if (record.mode === "edit" && !existing) {
    if (!answered) {
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

type ExistingSubscription = ReturnType<typeof useSubscriptionsState>["data"][number];

interface SubscriptionFields {
  name: string;
  amountRaw: string;
  amountMinor: number | null;
  amountMode: "fixed" | "variable";
  currency: string;
  showCurrency: boolean;
  cycle: "monthly" | "yearly" | "custom";
  intervalStr: string;
  billingDayStr: string;
  yearlyRenewalDate: ISODate | null;
  categoryId: string | null;
  sourceId: string | null;
  personChoice: string | null;
  isActive: boolean;
  autoPay: boolean;
  isTrial: boolean;
  trialDate: string | null;
  note: string;
}

const NEW_SUBSCRIPTION: SubscriptionFields = {
  name: "", amountRaw: "", amountMinor: null, amountMode: "fixed", currency: "TRY", showCurrency: false, cycle: "monthly",
  intervalStr: "1", billingDayStr: "1", yearlyRenewalDate: null, categoryId: null, sourceId: null, personChoice: null,
  isActive: true, autoPay: false, isTrial: false, trialDate: null, note: "",
};

/** What the form opens as: the rule being edited, or a new monthly one. */
function initialSubscription(existing: ExistingSubscription | undefined): SubscriptionFields {
  if (!existing) return NEW_SUBSCRIPTION;
  // 0 on a variable rule is the "no estimate yet" sentinel, not a real
  // amount — the field reopens empty rather than pre-filling "0,00".
  const amountKnown = !(existing.amountMode === "variable" && existing.amountMinor === 0);
  return {
    name: existing.name,
    amountRaw: amountKnown ? formatMinorInput(existing.amountMinor) : "",
    amountMinor: amountKnown ? existing.amountMinor : null,
    amountMode: existing.amountMode,
    currency: existing.currency,
    showCurrency: existing.currency !== "TRY",
    cycle: existing.cycle,
    intervalStr: String(existing.intervalMonths),
    billingDayStr: String(existing.billingDay),
    yearlyRenewalDate: existing.cycle === "yearly" ? existing.nextDueDate : null,
    categoryId: existing.categoryId,
    sourceId: existing.paymentSourceId,
    personChoice: existing.personId,
    isActive: existing.isActive,
    autoPay: existing.autoPay,
    isTrial: existing.trialEndDate != null,
    trialDate: existing.trialEndDate,
    note: existing.note ?? "",
  };
}

/** The first charge on or after today: this month's billing day while it is still ahead, else the next one. */
function firstDueDate(today: ISODate, billingDay: number, intervalMonths: number): ISODate {
  const thisMonth = dueDateInMonth(monthKeyOf(today), billingDay);
  return thisMonth >= today ? thisMonth : nextDueAfter(today, today, intervalMonths, billingDay);
}

function useSubscriptionForm(existing: ExistingSubscription | undefined) {
  const userId = useUserId();
  const categoriesState = useCategoriesState();
  const sourcesState = useSourcesState();
  const personsState = usePersonsState();
  const sources = sourcesState.data;
  const persons = personsState.data;
  const router = useRouter();
  const operationGuard = useOperationGuard();
  const close = () => navigateBack(router, "/(tabs)/subscriptions");
  const data = combineLiveStates([categoriesState, sourcesState, personsState]);
  const [fields, setFields] = useState(() => initialSubscription(existing));
  const patch = (next: Partial<SubscriptionFields>) => setFields((current) => ({ ...current, ...next }));
  const [busy, setBusy] = useState(false);
  const [showCategoryOffer, setShowCategoryOffer] = useState(false);
  const [draftId] = useState(() => existing?.id ?? createRecordId());
  const { amountMinor: _parsed, showCurrency: _currencyShown, ...draft } = fields;
  const { allowExit, confirmDiscard } = useDirtyExitGuard(useDraftDirty(JSON.stringify(draft), data.ready) && !busy);

  const { cycle, amountMode } = fields;
  const billingDay = cycle === "yearly" && fields.yearlyRenewalDate ? Number(fields.yearlyRenewalDate.slice(8, 10)) : Number(fields.billingDayStr);
  const intervalMonths = cycle === "monthly" ? 1 : cycle === "yearly" ? 12 : Number(fields.intervalStr);
  const scheduleValid = isMonthDay(billingDay) && Number.isInteger(intervalMonths) && intervalMonths >= 1;
  const personId = assignedPersonId(fields.personChoice, persons);
  const selectedSource = sources.find((source) => source.id === fields.sourceId);
  const sourceValid = selectedSource?.type !== "credit_card" || isValidCardCycle(selectedSource);
  // A variable bill's cost is genuinely unknown until the first invoice
  // arrives, so it is the one field that may stay empty; a fixed
  // subscription always names a real recurring charge.
  const amountValid = amountMode === "variable" ? fields.amountMinor == null || fields.amountMinor >= 0 : fields.amountMinor != null && fields.amountMinor > 0;
  const valid = data.ready && fields.name.trim() !== "" && amountValid && scheduleValid && (cycle !== "yearly" || fields.yearlyRenewalDate != null)
    && (!fields.isTrial || fields.trialDate != null) && personId != null && sourceValid;
  const expenseCategories = categoriesState.data.filter((category) => category.kind === "expense");
  const selectedCategoryId = expenseCategories.some((category) => category.id === fields.categoryId) ? fields.categoryId : null;
  const today = todayISO();
  const previewDueDate = cycle === "yearly" ? fields.yearlyRenewalDate : scheduleValid ? firstDueDate(today, billingDay, intervalMonths) : null;
  const followingDueDate = previewDueDate && scheduleValid ? advanceDueDate(previewDueDate, intervalMonths, billingDay) : null;

  const persist = async (categoryId: string) => {
    const now = todayISO();
    // An edit that keeps the day and interval keeps the charge it was waiting for.
    const unchanged = existing?.billingDay === billingDay && existing.intervalMonths === intervalMonths;
    const nextDueDate = cycle === "yearly" && fields.yearlyRenewalDate
      ? fields.yearlyRenewalDate
      : unchanged ? existing.nextDueDate : existing ? nextDueAfter(now, now, intervalMonths, billingDay) : firstDueDate(now, billingDay, intervalMonths);
    await upsertSubscription(userId, {
      id: existing ? draftId : undefined,
      name: fields.name.trim(),
      amountMinor: fields.amountMinor ?? 0,
      amountMode,
      currency: fields.currency,
      cycle,
      intervalMonths,
      billingDay,
      nextDueDate,
      paymentSourceId: fields.sourceId,
      categoryId,
      personId: personId!,
      isActive: fields.isActive,
      trialEndDate: fields.isTrial ? fields.trialDate : null,
      autoPay: amountMode === "variable" ? false : fields.autoPay,
      // Logos are derived from the name; a stored domain still serves as a favicon fallback.
      websiteDomain: existing?.websiteDomain || null,
      note: fields.note.trim() || null,
    });
    scheduleSync(userId);
    allowExit(close);
  };

  const save = () => {
    if (!valid) return;
    if (!selectedCategoryId) {
      setShowCategoryOffer(true);
      return;
    }
    return operationGuard.run(async () => {
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

  const acceptCategoryOffer = () => operationGuard.run(async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const categoryId = await ensureSubscriptionCategory(userId, tr.subs.suggestedCategoryName);
      patch({ categoryId });
      setShowCategoryOffer(false);
      await persist(categoryId);
    } catch (e) {
      devError("subscription.category", e);
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    } finally {
      setBusy(false);
    }
  });

  return {
    existing, data, fields, patch, busy, valid, save, acceptCategoryOffer, confirmDiscard, close, persons, sources, personId, sourceValid,
    expenseCategories, selectedCategoryId, showCategoryOffer, setShowCategoryOffer, previewDueDate, followingDueDate,
  };
}

type SubscriptionFormModel = ReturnType<typeof useSubscriptionForm>;

/** A setting that is on or off, said with what it does. */
function ToggleRow({ label, hint, value, onChange, disabled }: { label: string; hint: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <Spread style={{ marginBottom: spacing.md }}>
      <View style={{ flex: 1, paddingRight: spacing.md }}>
        <Body>{label}</Body>
        <Body muted style={{ fontSize: type.small.fontSize }}>{hint}</Body>
      </View>
      <Toggle label={label} value={value} onValueChange={onChange} disabled={disabled} />
    </Spread>
  );
}

function SubscriptionIdentityCard({ form }: { form: SubscriptionFormModel }) {
  const { fields, patch } = form;
  const namePlaceholder = useRotatingPlaceholder(placeholderPools.subscription);
  const variable = fields.amountMode === "variable";
  return (
    <Card>
      <SubscriptionFormArtwork
        name={fields.name}
        cycle={fields.cycle}
        intervalMonths={Number(fields.intervalStr)}
        amountMinor={fields.amountMinor}
        amountMode={fields.amountMode}
        currency={fields.currency}
        nextDueDate={form.previewDueDate}
        followingDueDate={form.followingDueDate}
        schedule={fields.cycle === "yearly"
          ? (fields.yearlyRenewalDate ? dateLabel(fields.yearlyRenewalDate) : "")
          : (fields.billingDayStr ? tr.subs.daySchedule(fields.billingDayStr) : "")}
      />
      <Field label={tr.subs.name} value={fields.name} onChangeText={(name) => patch({ name })} placeholder={namePlaceholder} />
      {/* The choice between a fixed and a variable amount changes what the
          field below it is for — asked first, "tahmini tutar" and an
          empty field both read as intentional instead of unfinished. */}
      <ToggleRow
        label={tr.subs.variableAmount}
        hint={tr.subs.variableAmountHint}
        value={variable}
        onChange={(value) => patch(value ? { amountMode: "variable", autoPay: false } : { amountMode: "fixed" })}
      />
      <MoneyField
        label={`${variable ? tr.subs.estimatedAmountFieldLabel : tr.tx.amount} · ${fields.currency}`}
        value={fields.amountRaw}
        onChangeMinor={(amountRaw, amountMinor) => patch({ amountRaw, amountMinor })}
      />
      {fields.showCurrency ? (
        <>
          <Label>{tr.tx.currency}</Label>
          <CurrencyPicker value={fields.currency} onChange={(currency) => patch({ currency })} />
        </>
      ) : (
        <InlineDisclosure label={tr.tx.changeCurrency(currencyLabel(fields.currency))} expanded={false} onPress={() => patch({ showCurrency: true })} />
      )}
    </Card>
  );
}

function SubscriptionScheduleCard({ form }: { form: SubscriptionFormModel }) {
  const router = useRouter();
  const { palette } = useTheme();
  const { fields, patch } = form;
  return (
    <Card>
      <PanelHeader icon={CalendarClock} title={tr.subs.formSchedule} description={tr.subs.formScheduleHint} />
      <Label>{tr.subs.cycle}</Label>
      <ChipPicker
        options={[{ value: "monthly", label: tr.subs.monthly }, { value: "yearly", label: tr.subs.yearly }, { value: "custom", label: tr.subs.custom }]}
        value={fields.cycle}
        onChange={(cycle) => patch({ cycle })}
      />
      {fields.cycle === "custom" ? (
        <FieldNote note={tr.subs.intervalHint}>
          <Field label={tr.subs.intervalLabel} value={fields.intervalStr} onChangeText={(intervalStr) => patch({ intervalStr })} keyboardType="number-pad" />
        </FieldNote>
      ) : null}
      {fields.cycle === "yearly" ? (
        <FieldNote note={tr.subs.yearlyRenewalHint}>
          <DateField
            label={tr.subs.yearlyRenewalDate}
            value={fields.yearlyRenewalDate}
            min={todayISO()}
            onChange={(date) => patch({ yearlyRenewalDate: date, billingDayStr: String(Number(date.slice(8, 10))) })}
          />
        </FieldNote>
      ) : (
        <FieldNote note={tr.subs.billingDayHint}>
          <MonthDayField
            label={tr.subs.billingDay}
            value={fields.billingDayStr}
            onChange={(billingDayStr) => patch({ billingDayStr })}
            quickDays={QUICK_DAYS}
            error={fields.billingDayStr !== "" && !isMonthDay(fields.billingDayStr) ? tr.incomes.dayError : null}
          />
        </FieldNote>
      )}
      {form.expenseCategories.length > 0 ? (
        <Select
          label={tr.tx.category}
          placeholder={tr.tx.categoryPlaceholder}
          options={form.expenseCategories.map((category) => ({ value: category.id, label: category.name, icon: categoryIconComponent(category) }))}
          value={form.selectedCategoryId}
          onChange={(categoryId) => {
            patch({ categoryId });
            form.setShowCategoryOffer(false);
          }}
          onCreate={{ label: tr.tx.addCategory, run: () => router.push("/columns-editor") }}
        />
      ) : null}
      {form.showCategoryOffer && !form.selectedCategoryId ? (
        <View style={{ backgroundColor: palette.primarySoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}>
          <Body style={{ marginBottom: spacing.sm }}>{tr.subs.categoryOffer}</Body>
          <Row gap={spacing.sm} style={{ alignItems: "center", flexWrap: "wrap" }}>
            <Button size="sm" label={tr.subs.categoryOfferAccept} onPress={() => void form.acceptCategoryOffer()} loading={form.busy} />
            <Button size="sm" variant="ghost" label={tr.subs.categoryOfferDecline} onPress={() => form.setShowCategoryOffer(false)} disabled={form.busy} />
          </Row>
        </View>
      ) : null}
      {form.sources.length > 0 ? (
        <>
          <Select
            label={tr.tx.source}
            placeholder={tr.tx.sourcePlaceholder}
            options={form.sources.map((s) => ({ value: s.id, label: s.name, icon: <PaymentSourceLogo name={s.name} type={s.type} logoRef={s.logoRef} size={SOURCE_MARK} /> }))}
            value={fields.sourceId}
            onChange={(sourceId) => patch({ sourceId })}
            onCreate={{ label: tr.tx.addSource, run: () => router.push("/payment-sources") }}
          />
          {!form.sourceValid ? <Body muted style={{ marginBottom: spacing.sm }}>{tr.tx.cardCycleMissing}</Body> : null}
        </>
      ) : null}
      <PersonAssignment people={form.persons} value={form.personId} onChange={(personChoice) => patch({ personChoice })} />
    </Card>
  );
}

function SubscriptionBehaviorCard({ form }: { form: SubscriptionFormModel }) {
  const { fields, patch, existing } = form;
  const variable = fields.amountMode === "variable";
  return (
    <Card>
      <PanelHeader icon={BellRing} title={tr.subs.formBehavior} description={tr.subs.formBehaviorHint} />
      <ToggleRow label={tr.subs.trialToggle} hint={tr.subs.trialToggleHint} value={fields.isTrial} onChange={(isTrial) => patch({ isTrial })} />
      {fields.isTrial ? <DateField label={tr.subs.trialDate} value={fields.trialDate} onChange={(trialDate) => patch({ trialDate })} /> : null}
      <Field label={tr.common.note} value={fields.note} onChangeText={(note) => patch({ note })} multiline placeholder={tr.common.optionalHint} />
      <Spread style={{ marginBottom: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Body>{tr.subs.autoPay}</Body>
          <Body muted>{variable ? tr.subs.variableAutoPayHint : tr.subs.autoPayHint}</Body>
        </View>
        <Toggle label={tr.subs.autoPay} value={!variable && fields.autoPay} onValueChange={(autoPay) => patch({ autoPay })} disabled={variable} />
      </Spread>
      <Spread style={{ marginBottom: spacing.lg }}>
        <Body>{tr.common.active}</Body>
        <Toggle label={tr.common.active} value={fields.isActive} onValueChange={(isActive) => patch({ isActive })} />
      </Spread>
      {existing && fields.amountMinor != null && fields.amountMinor !== existing.amountMinor ? (
        <Body muted style={{ marginBottom: spacing.md }}>
          {tr.subs.priceHistory}: {formatMinorCompact(existing.amountMinor, existing.currency)} → {formatMinorCompact(fields.amountMinor, fields.currency)}
        </Body>
      ) : null}
    </Card>
  );
}

function SubscriptionForm({ existing }: { existing?: ExistingSubscription }) {
  const form = useSubscriptionForm(existing);
  useSubmitOnEnter(() => void form.save(), form.valid && !form.busy);
  if (!form.data.ready) return <DataGateScreen status={form.data.status} retry={form.data.retry} />;
  return (
    <Screen width="workspace">
      <Stack.Screen options={{ title: existing ? tr.subs.edit : tr.subs.add }} />
      <DataStateNotice status={form.data.status} retry={form.data.retry} />
      <WorkspaceSplit testID="subscription-form-workspace" primary={<SubscriptionIdentityCard form={form} />} secondary={<SubscriptionScheduleCard form={form} />} />
      <SubscriptionBehaviorCard form={form} />
      <Row style={{ alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Button label={tr.common.save} onPress={() => void form.save()} disabled={!form.valid} loading={form.busy} />
        </View>
        <Button label={tr.common.cancel} variant="secondary" disabled={form.busy} onPress={() => form.confirmDiscard(form.close)} />
      </Row>
    </Screen>
  );
}
