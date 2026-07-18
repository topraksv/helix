/** Subscription add/edit modal. Price edits append to price_history (spec §3.1). */

import React, { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CreditCardCycleRequiredError, ensureSubscriptionCategory, upsertSubscription } from "../data/repo";
import { useCategories, usePersons, useSources, useSubscriptions, useUserId } from "../data/hooks";
import { categoryIcon } from "../data/category-icons";
import { dueDateInMonth, nextDueAfter } from "../domain/recurrence";
import { monthKeyOf, todayISO } from "../domain/dates";
import { formatMinor } from "../domain/money";
import { tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { SUPPORTED_CURRENCIES } from "../services/fx-fetch";
import { Body, Button, Card, ChipPicker, Field, Label, MoneyField, Row, Screen, Segmented, Spread, Toggle } from "../ui/components";
import { useSubmitOnEnter } from "../ui/keyboard";
import { appAlert } from "../ui/dialog";
import { DateField } from "../ui/calendar";
import { placeholderPools, useRotatingPlaceholder } from "../ui/placeholders";
import { devError } from "../services/logger";
import { spacing, useTheme } from "../ui/theme";
import { navigateBack } from "../ui/navigation";
import { useOperationGuard } from "../ui/operation-guard";
import { newId } from "../db/ids";

// Same quick-day set as the recurring-income form (no "20"; six chips fit one
// row on a phone).
const QUICK_DAYS = ["1", "5", "10", "15", "25", "28"] as const;

export default function SubscriptionFormModal() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const subscriptions = useSubscriptions();
  const existing = subscriptions.find((s) => s.id === id);
  // Live queries resolve async: when editing, hold the form back until the
  // row is loaded, and key it so state initializers see the real values.
  if (id && !existing) return <Screen scroll={false}>{null}</Screen>;
  return <SubscriptionForm key={existing?.id ?? "new"} existing={existing} />;
}

function SubscriptionForm({ existing }: { existing?: ReturnType<typeof useSubscriptions>[number] }) {
  const userId = useUserId();
  const categories = useCategories();
  const sources = useSources();
  const persons = usePersons();
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
  const [draftId] = useState(() => existing?.id ?? newId());

  const billingDay = Number(billingDayStr);
  const intervalMonths = cycle === "monthly" ? 1 : cycle === "yearly" ? 12 : Number(intervalStr);
  const trialValid = !isTrial || trialDate != null;
  const selectedSource = sources.find((source) => source.id === sourceId);
  const sourceValid = !selectedSource || selectedSource.type !== "credit_card" || Boolean(
    selectedSource.statementDay != null && selectedSource.statementDay >= 1 && selectedSource.statementDay <= 31 &&
    selectedSource.dueDay != null && selectedSource.dueDay >= 1 && selectedSource.dueDay <= 31
  );
  const baseValid =
    name.trim() !== "" &&
    amountMinor != null &&
    amountMinor > 0 &&
    Number.isInteger(billingDay) &&
    billingDay >= 1 &&
    billingDay <= 31 &&
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
    const nextDueDate = existing
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
    close();
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
  return (
    <Screen>
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
          <ChipPicker options={SUPPORTED_CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency as never} onChange={setCurrency} />
        </>
      ) : (
        <View style={{ alignSelf: "flex-start", marginBottom: spacing.md }}>
          <Button size="sm" variant="ghost" label={tr.tx.changeCurrency} onPress={() => setShowCurrency(true)} />
        </View>
      )}

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

      <Label>{tr.subs.billingDay}</Label>
      <ChipPicker
        options={QUICK_DAYS.map((d) => ({ value: d, label: d }))}
        value={(QUICK_DAYS as readonly string[]).includes(billingDayStr) ? (billingDayStr as (typeof QUICK_DAYS)[number]) : null}
        onChange={setBillingDayStr}
      />
      <Field value={billingDayStr} onChangeText={setBillingDayStr} keyboardType="number-pad" placeholder={tr.subs.billingDay} />
      <Body muted style={{ marginTop: -spacing.xs, marginBottom: spacing.md, fontSize: 12 }}>{tr.subs.billingDayHint}</Body>

      <Label>{tr.tx.category}</Label>
      {expenseCategories.length > 0 ? (
        <ChipPicker
          options={expenseCategories.map((category) => ({ value: category.id, label: `${categoryIcon(category)} ${category.name}` }))}
          value={selectedCategoryId}
          onChange={(value) => {
            setCategoryId(value);
            setShowCategoryOffer(false);
          }}
        />
      ) : null}
      {showCategoryOffer && !selectedCategoryId ? (
        <Card style={{ borderColor: palette.primary }}>
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
        </Card>
      ) : null}
      {sources.length > 0 ? (
        <>
          <Label>{tr.tx.source}</Label>
          <ChipPicker options={sources.map((s) => ({ value: s.id, label: s.name }))} value={sourceId} onChange={setSourceId} />
          {!sourceValid ? (
            <>
              <Body muted style={{ marginBottom: spacing.sm }}>{tr.tx.cardCycleMissing}</Body>
              <Button size="sm" variant="secondary" label={tr.settings.sources} onPress={() => router.push("/(tabs)/settings/payment-sources")} />
            </>
          ) : null}
        </>
      ) : null}
      {persons.length > 1 ? (
        <>
          <Label>{tr.tx.person}</Label>
          <ChipPicker options={persons.map((p) => ({ value: p.id, label: p.name }))} value={personId} onChange={setPersonChoice} />
        </>
      ) : null}

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

      <Button label={tr.common.save} onPress={() => void save()} disabled={!baseValid} loading={busy} />
    </Screen>
  );
}
