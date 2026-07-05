/** New installment plan / loan modal (also supports mid-progress "4/6 paid" entry). */

import React, { useState } from "react";
import { Alert, Platform, View } from "react-native";
import { useRouter } from "expo-router";
import { createInstallmentPlan } from "../data/repo";
import { useCategories, usePersons, useSources, useUserId } from "../data/hooks";
import { addMonthsToKey, monthKeyOf, todayISO } from "../domain/dates";
import { deriveStartMonth } from "../domain/installments";
import { formatMinor } from "../domain/money";
import { monthLabel, tr } from "../i18n/tr";
import { Body, Button, ChipPicker, Field, Heading, Label, MoneyField, Row, Screen, Segmented, Spread } from "../ui/components";
import { scheduleSync } from "../sync/engine";
import { spacing } from "../ui/theme";

export default function NewPlanModal() {
  const userId = useUserId();
  const sources = useSources();
  const persons = usePersons();
  const categories = useCategories();
  const router = useRouter();

  const [kind, setKind] = useState<"card_installment" | "loan">("card_installment");
  const [title, setTitle] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [countStr, setCountStr] = useState("6");
  const [paidStr, setPaidStr] = useState("0");
  const [startMonth, setStartMonth] = useState(monthKeyOf(todayISO()));
  const [usePaidDerive, setUsePaidDerive] = useState(true);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(persons.find((p) => p.isSelf)?.id ?? null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const count = Number(countStr);
  const paid = Number(paidStr);
  const valid =
    title.trim() !== "" &&
    amountMinor != null &&
    amountMinor > 0 &&
    Number.isInteger(count) &&
    count >= 1 &&
    Number.isInteger(paid) &&
    paid >= 0 &&
    paid < count &&
    personId != null;

  const resolvedStart = usePaidDerive && paid > 0 ? deriveStartMonth(paid, monthKeyOf(todayISO())) : startMonth;

  const save = async () => {
    if (!valid || !personId) return;
    setBusy(true);
    try {
      const person = persons.find((p) => p.id === personId)!;
      await createInstallmentPlan(userId, {
        title: title.trim(),
        kind,
        totalAmountMinor: kind === "card_installment" ? amountMinor! : null,
        monthlyAmountMinor: kind === "loan" ? amountMinor! : null,
        installmentCount: count,
        currency: "TRY",
        fxRate: null,
        startMonth: resolvedStart,
        dueDay: sources.find((s) => s.id === sourceId)?.dueDay ?? null,
        paymentSourceId: sourceId,
        personId,
        personIsSelf: person.isSelf,
        categoryId,
        note: null,
        tryFactor: 1,
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
      <Segmented
        options={[
          { value: "card_installment", label: tr.installments.plan },
          { value: "loan", label: tr.installments.loan },
        ]}
        value={kind}
        onChange={setKind}
      />
      <Field label={tr.installments.titleField} value={title} onChangeText={setTitle} placeholder={tr.placeholders.installmentTitle} />
      <MoneyField
        label={kind === "card_installment" ? `${tr.installments.totalAmount} (₺)` : `${tr.installments.monthlyAmount} (₺)`}
        value={amountRaw}
        onChangeMinor={(raw, minor) => {
          setAmountRaw(raw);
          setAmountMinor(minor);
        }}
      />
      <Row>
        <View style={{ flex: 1 }}>
          <Field label={tr.installments.count} value={countStr} onChangeText={setCountStr} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label={tr.tx.alreadyPaid} value={paidStr} onChangeText={setPaidStr} keyboardType="number-pad" />
        </View>
      </Row>

      {paid > 0 ? (
        <Body muted style={{ marginBottom: spacing.md }}>
          {tr.installments.progress(paid, count)} → {tr.installments.startMonth}: {monthLabel(resolvedStart)}
        </Body>
      ) : (
        <>
          <Label>{tr.installments.startMonth}</Label>
          <Spread style={{ marginBottom: spacing.md }}>
            <Button label="◀" variant="secondary" onPress={() => { setUsePaidDerive(false); setStartMonth(addMonthsToKey(startMonth, -1)); }} />
            <Heading>{monthLabel(startMonth)}</Heading>
            <Button label="▶" variant="secondary" onPress={() => { setUsePaidDerive(false); setStartMonth(addMonthsToKey(startMonth, 1)); }} />
          </Spread>
        </>
      )}

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
      <Label>{tr.tx.category}</Label>
      <ChipPicker
        options={categories.filter((c) => c.kind === "expense").map((c) => ({ value: c.id, label: c.name }))}
        value={categoryId}
        onChange={setCategoryId}
      />

      {valid && amountMinor ? (
        <Body muted style={{ marginBottom: spacing.md }}>
          {kind === "card_installment"
            ? tr.tx.installmentInfo(formatMinor(Math.trunc(amountMinor / count)), count)
            : tr.tx.installmentInfo(formatMinor(amountMinor), count)}
        </Body>
      ) : null}

      <Button label={tr.common.save} onPress={() => void save()} disabled={!valid} loading={busy} />
    </Screen>
  );
}
