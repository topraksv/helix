/** Subscription add/edit modal. Price edits append to price_history (spec §3.1). */

import React, { useMemo, useState } from "react";
import { Alert, Platform, Switch, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { upsertSubscription } from "../data/repo";
import { useCategories, usePersons, useSources, useSubscriptions, useUserId } from "../data/hooks";
import { dueDateInMonth, nextDueAfter } from "../domain/recurrence";
import { monthKeyOf, todayISO } from "../domain/dates";
import { formatMinor } from "../domain/money";
import { tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { SUPPORTED_CURRENCIES } from "../services/fx-fetch";
import { Body, Button, ChipPicker, Field, Label, MoneyField, Row, Screen, Segmented, Spread } from "../ui/components";
import { spacing } from "../ui/theme";

export default function SubscriptionFormModal() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const userId = useUserId();
  const subscriptions = useSubscriptions();
  const categories = useCategories();
  const sources = useSources();
  const persons = usePersons();
  const router = useRouter();
  const existing = useMemo(() => subscriptions.find((s) => s.id === id), [subscriptions, id]);

  const [name, setName] = useState(existing?.name ?? "");
  const [amountRaw, setAmountRaw] = useState(existing ? (existing.amountMinor / 100).toFixed(2).replace(".", ",") : "");
  const [amountMinor, setAmountMinor] = useState<number | null>(existing?.amountMinor ?? null);
  const [currency, setCurrency] = useState(existing?.currency ?? "TRY");
  const [cycle, setCycle] = useState<"monthly" | "yearly" | "custom">(existing?.cycle ?? "monthly");
  const [intervalStr, setIntervalStr] = useState(String(existing?.intervalMonths ?? 1));
  const [billingDayStr, setBillingDayStr] = useState(String(existing?.billingDay ?? 1));
  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null);
  const [sourceId, setSourceId] = useState<string | null>(existing?.paymentSourceId ?? null);
  const [personId, setPersonId] = useState<string | null>(existing?.personId ?? persons.find((p) => p.isSelf)?.id ?? null);
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [autoPay, setAutoPay] = useState(existing?.autoPay ?? false);
  const [trialDate, setTrialDate] = useState(existing?.trialEndDate ?? "");
  const [domain, setDomain] = useState(existing?.websiteDomain ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);

  const billingDay = Number(billingDayStr);
  const intervalMonths = cycle === "monthly" ? 1 : cycle === "yearly" ? 12 : Number(intervalStr);
  const trialValid = trialDate.trim() === "" || /^\d{4}-\d{2}-\d{2}$/.test(trialDate.trim());
  const valid =
    name.trim() !== "" &&
    amountMinor != null &&
    amountMinor > 0 &&
    Number.isInteger(billingDay) &&
    billingDay >= 1 &&
    billingDay <= 31 &&
    Number.isInteger(intervalMonths) &&
    intervalMonths >= 1 &&
    trialValid &&
    personId != null;

  const save = async () => {
    if (!valid || !personId) return;
    setBusy(true);
    try {
      const today = todayISO();
      const nextDueDate = existing
        ? existing.billingDay === billingDay && existing.intervalMonths === intervalMonths
          ? existing.nextDueDate
          : nextDueAfter(today, today, intervalMonths, billingDay)
        : dueDateInMonth(monthKeyOf(today), billingDay) >= today
          ? dueDateInMonth(monthKeyOf(today), billingDay)
          : nextDueAfter(today, today, intervalMonths, billingDay);
      await upsertSubscription(userId, {
        id: existing?.id,
        name: name.trim(),
        amountMinor: amountMinor!,
        currency,
        cycle,
        intervalMonths,
        billingDay,
        nextDueDate,
        paymentSourceId: sourceId,
        categoryId,
        personId,
        isActive,
        trialEndDate: trialDate.trim() || null,
        autoPay,
        websiteDomain: domain.trim() || null,
        note: note.trim() || null,
      });
      scheduleSync(userId);
      router.back();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (Platform.OS === "web") window.alert(message);
      else Alert.alert("Hata", message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Field label={tr.subs.name} value={name} onChangeText={setName} placeholder="Netflix, iCloud, Elektrik…" />
      <MoneyField
        label={`${tr.tx.amount} (${currency})`}
        value={amountRaw}
        onChangeMinor={(raw, minor) => {
          setAmountRaw(raw);
          setAmountMinor(minor);
        }}
      />
      <Label>{tr.tx.currency}</Label>
      <ChipPicker options={SUPPORTED_CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency as never} onChange={setCurrency} />

      <Segmented
        options={[
          { value: "monthly", label: tr.subs.monthly },
          { value: "yearly", label: tr.subs.yearly },
          { value: "custom", label: tr.subs.custom },
        ]}
        value={cycle}
        onChange={setCycle}
      />
      <Row>
        {cycle === "custom" ? (
          <View style={{ flex: 1 }}>
            <Field label={tr.subs.custom} value={intervalStr} onChangeText={setIntervalStr} keyboardType="number-pad" />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Field label={tr.subs.billingDay} value={billingDayStr} onChangeText={setBillingDayStr} keyboardType="number-pad" />
        </View>
      </Row>

      {categories.length > 0 ? (
        <>
          <Label>{tr.tx.category}</Label>
          <ChipPicker
            options={categories.filter((c) => c.kind === "expense").map((c) => ({ value: c.id, label: c.name }))}
            value={categoryId}
            onChange={setCategoryId}
          />
        </>
      ) : null}
      {sources.length > 0 ? (
        <>
          <Label>{tr.tx.source}</Label>
          <ChipPicker options={sources.map((s) => ({ value: s.id, label: s.name }))} value={sourceId} onChange={setSourceId} />
        </>
      ) : null}
      {persons.length > 1 ? (
        <>
          <Label>{tr.tx.person}</Label>
          <ChipPicker options={persons.map((p) => ({ value: p.id, label: p.name }))} value={personId} onChange={setPersonId} />
        </>
      ) : null}

      <Field label={`${tr.subs.trialDate} (${tr.common.optional})`} value={trialDate} onChangeText={setTrialDate} placeholder="2026-08-01" autoCapitalize="none" />
      <Field label={`${tr.subs.domain} (${tr.common.optional})`} value={domain} onChangeText={setDomain} placeholder="netflix.com" autoCapitalize="none" />
      <Field label={`${tr.common.note} (${tr.common.optional})`} value={note} onChangeText={setNote} multiline />

      <Spread style={{ marginBottom: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Body>{tr.subs.autoPay}</Body>
          <Body muted>{tr.subs.autoPayHint}</Body>
        </View>
        <Switch value={autoPay} onValueChange={setAutoPay} />
      </Spread>
      <Spread style={{ marginBottom: spacing.lg }}>
        <Body>{tr.common.active}</Body>
        <Switch value={isActive} onValueChange={setIsActive} />
      </Spread>

      {existing && amountMinor != null && amountMinor !== existing.amountMinor ? (
        <Body muted style={{ marginBottom: spacing.md }}>
          {tr.subs.priceHistory}: {formatMinor(existing.amountMinor, existing.currency)} → {formatMinor(amountMinor, currency)}
        </Body>
      ) : null}

      <Button label={tr.common.save} onPress={() => void save()} disabled={!valid} loading={busy} />
    </Screen>
  );
}
