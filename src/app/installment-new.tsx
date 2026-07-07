/** New / edit installment plan or loan (also supports mid-progress "4/6 paid" entry). */

import React, { useState } from "react";
import { Alert, Platform, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { createInstallmentPlan, deletePlan, updateInstallmentPlan } from "../data/repo";
import { useCategories, usePersons, usePlans, useSources, useUserId } from "../data/hooks";
import { addMonthsToKey, monthKeyOf, todayISO } from "../domain/dates";
import { deriveStartMonth } from "../domain/installments";
import { formatMinor } from "../domain/money";
import { monthLabel, tr } from "../i18n/tr";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react-native";
import { Body, Button, ChipPicker, Field, Heading, IconButton, Label, MoneyField, Row, Screen, Segmented, Spread } from "../ui/components";
import { placeholderPools, useRotatingPlaceholder } from "../ui/placeholders";
import { scheduleSync } from "../sync/engine";
import { spacing } from "../ui/theme";

export default function PlanModal() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const plans = usePlans();
  const existing = plans.find((p) => p.id === id);
  // Hold the form until the edited row resolves from the live query.
  if (id && !existing) return <Screen scroll={false}>{null}</Screen>;
  return <PlanForm key={existing?.id ?? "new"} existing={existing} />;
}

function PlanForm({ existing }: { existing?: ReturnType<typeof usePlans>[number] }) {
  const userId = useUserId();
  const sources = useSources();
  const persons = usePersons();
  const categories = useCategories();
  const router = useRouter();
  const isEdit = existing != null;

  const [kind, setKind] = useState<"card_installment" | "loan">(existing?.kind ?? "card_installment");
  const existingAmountMinor = existing ? (existing.kind === "loan" ? existing.monthlyAmountMinor : existing.totalAmountMinor) : null;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [amountRaw, setAmountRaw] = useState(existingAmountMinor != null ? (existingAmountMinor / 100).toFixed(2).replace(".", ",") : "");
  const [amountMinor, setAmountMinor] = useState<number | null>(existingAmountMinor ?? null);
  const [countStr, setCountStr] = useState(String(existing?.installmentCount ?? 6));
  const [paidStr, setPaidStr] = useState("0");
  const [startMonth, setStartMonth] = useState(existing?.startMonth ?? monthKeyOf(todayISO()));
  const [usePaidDerive, setUsePaidDerive] = useState(!isEdit);
  const [sourceId, setSourceId] = useState<string | null>(existing?.paymentSourceId ?? null);
  // persons load async (live query) — derive the default instead of freezing
  // a null initial state computed before the first query resolves.
  const [personChoice, setPersonChoice] = useState<string | null>(existing?.personId ?? null);
  const personId = personChoice ?? persons.find((p) => p.isSelf)?.id ?? persons[0]?.id ?? null;
  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null);
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

  // On a new plan, "already paid N" back-derives the start month; on edit the
  // start month is edited directly.
  const resolvedStart = !isEdit && usePaidDerive && paid > 0 ? deriveStartMonth(paid, monthKeyOf(todayISO())) : startMonth;

  const save = async () => {
    if (!valid || !personId) return;
    setBusy(true);
    try {
      const person = persons.find((p) => p.id === personId)!;
      const input = {
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
        note: existing?.note ?? null,
        tryFactor: 1,
      };
      if (isEdit) await updateInstallmentPlan(userId, existing!.id, input);
      else await createInstallmentPlan(userId, input);
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

  const confirmDelete = () => {
    const run = async () => {
      await deletePlan(userId, existing!.id);
      scheduleSync(userId);
      router.back();
    };
    if (Platform.OS === "web") {
      if (window.confirm(`${existing!.title} — ${tr.common.delete}?`)) void run();
    } else {
      Alert.alert(existing!.title, `${tr.common.delete}?`, [
        { text: tr.common.cancel, style: "cancel" },
        { text: tr.common.delete, style: "destructive", onPress: () => void run() },
      ]);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: isEdit ? tr.installments.editTitle : tr.installments.newTitle }} />
      {isEdit ? <Body muted style={{ marginBottom: spacing.md, fontSize: 12 }}>{tr.installments.editHint}</Body> : null}
      <Segmented
        options={[
          { value: "card_installment", label: tr.installments.plan },
          { value: "loan", label: tr.installments.loan },
        ]}
        value={kind}
        onChange={setKind}
      />
      <Field label={tr.installments.titleField} value={title} onChangeText={setTitle} placeholder={useRotatingPlaceholder(placeholderPools.installment)} />
      <MoneyField
        label={kind === "card_installment" ? tr.installments.totalAmount : tr.installments.monthlyAmount}
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
        {!isEdit ? (
          <View style={{ flex: 1 }}>
            <Field label={tr.tx.alreadyPaid} value={paidStr} onChangeText={setPaidStr} keyboardType="number-pad" />
          </View>
        ) : null}
      </Row>

      {!isEdit && paid > 0 ? (
        <Body muted style={{ marginBottom: spacing.md }}>
          {tr.installments.progress(paid, count)} → {tr.installments.startMonth}: {monthLabel(resolvedStart)}
        </Body>
      ) : (
        <>
          <Label>{tr.installments.startMonth}</Label>
          <Spread style={{ marginBottom: spacing.md }}>
            <IconButton icon={ChevronLeft} label={tr.installments.startMonth} onPress={() => { setUsePaidDerive(false); setStartMonth(addMonthsToKey(startMonth, -1)); }} />
            <Heading>{monthLabel(startMonth)}</Heading>
            <IconButton icon={ChevronRight} label={tr.installments.startMonth} onPress={() => { setUsePaidDerive(false); setStartMonth(addMonthsToKey(startMonth, 1)); }} />
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
          <ChipPicker options={persons.map((p) => ({ value: p.id, label: p.name }))} value={personId} onChange={setPersonChoice} />
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
      {isEdit ? (
        <View style={{ marginTop: spacing.md }}>
          <Button icon={Trash2} label={tr.installments.delete} variant="danger" onPress={confirmDelete} />
        </View>
      ) : null}
    </Screen>
  );
}
