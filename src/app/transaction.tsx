/** Transaction entry modal — smart defaults, TR amount input, FX preview,
 *  future-dated payments (§2.7) and inline installment plan creation. */

import React, { useMemo, useState } from "react";
import { Alert, Platform, View } from "react-native";
import { useRouter } from "expo-router";
import { addTransaction, createInstallmentPlan } from "../data/repo";
import { useCategories, usePersons, useSources, useUserId } from "../data/hooks";
import { categoryIcon } from "../data/category-icons";
import { convertToTryMinor } from "../domain/fx";
import { assertISODate, monthKeyOf, todayISO } from "../domain/dates";
import { formatMinor } from "../domain/money";
import { deriveStartMonth } from "../domain/installments";
import { lookupRate, SUPPORTED_CURRENCIES } from "../services/fx-fetch";
import { scheduleSync } from "../sync/engine";
import { tr } from "../i18n/tr";
import { Badge, Body, Button, ChipPicker, Field, Label, MoneyField, Row, Screen, Segmented } from "../ui/components";
import { DateField } from "../ui/calendar";
import { kv } from "../lib/kv";
import { placeholderPools, useRotatingPlaceholder } from "../ui/placeholders";
import { spacing } from "../ui/theme";

type EntryType = "expense" | "income" | "transfer";

export default function TransactionModal() {
  const userId = useUserId();
  const categories = useCategories();
  const sources = useSources();
  const persons = usePersons();
  const router = useRouter();

  const [entryType, setEntryType] = useState<EntryType>("expense");
  const [amountRaw, setAmountRaw] = useState("");
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [currency, setCurrency] = useState<string>("TRY");
  const [showCurrency, setShowCurrency] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  // persons load async (live query) — deriving keeps "self" as the default
  // even when the modal mounts before the first query resolves.
  const [personChoice, setPersonChoice] = useState<string | null>(null);
  const personId = personChoice ?? persons.find((p) => p.isSelf)?.id ?? persons[0]?.id ?? null;
  const [dateStr, setDateStr] = useState(todayISO());
  const [note, setNote] = useState("");
  const [installment, setInstallment] = useState(false);
  const [countStr, setCountStr] = useState("2");
  const [paidStr, setPaidStr] = useState("0");
  const [busy, setBusy] = useState(false);

  // Smart defaults: remember last used category/source per type.
  React.useEffect(() => {
    void kv.get(`helix.last.${entryType}`).then((v) => {
      if (!v) return;
      try {
        const parsed = JSON.parse(v) as { categoryId?: string; sourceId?: string };
        if (parsed.categoryId && categories.some((c) => c.id === parsed.categoryId)) setCategoryId(parsed.categoryId);
        if (parsed.sourceId && sources.some((s) => s.id === parsed.sourceId)) setSourceId(parsed.sourceId);
      } catch {}
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryType]);

  const rate = useMemo(() => lookupRate(userId, currency), [userId, currency]);
  const tryMinor =
    amountMinor == null ? null : currency === "TRY" ? amountMinor : rate ? convertToTryMinor(amountMinor, rate.rate.rateTry) : null;

  const kindForCategories = entryType === "income" ? "income" : "expense";
  const categoryOptions = categories
    .filter((c) => c.kind === kindForCategories)
    .map((c) => ({ value: c.id, label: `${categoryIcon(c)} ${c.name}` }));

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  const count = Number(countStr);
  const paid = Number(paidStr);
  const installmentValid = !installment || (Number.isInteger(count) && count >= 2 && Number.isInteger(paid) && paid >= 0 && paid < count);
  const canSave = amountMinor != null && amountMinor > 0 && tryMinor != null && personId != null && dateValid && installmentValid;

  const fail = (msg: string) => (Platform.OS === "web" ? window.alert(msg) : Alert.alert("Hata", msg));

  const save = async (thenNew: boolean) => {
    if (!canSave || !personId) return;
    setBusy(true);
    try {
      assertISODate(dateStr);
      const fxRate = currency === "TRY" ? null : String(rate!.rate.rateTry);
      if (installment) {
        const person = persons.find((p) => p.id === personId)!;
        await createInstallmentPlan(userId, {
          title: note.trim() || `${formatMinor(amountMinor!, currency)} taksitli harcama`,
          kind: "card_installment",
          totalAmountMinor: amountMinor!,
          monthlyAmountMinor: null,
          installmentCount: count,
          currency,
          fxRate,
          startMonth: paid > 0 ? deriveStartMonth(paid, monthKeyOf(todayISO())) : monthKeyOf(dateStr),
          dueDay: sources.find((s) => s.id === sourceId)?.dueDay ?? null,
          paymentSourceId: sourceId,
          personId,
          personIsSelf: person.isSelf,
          categoryId,
          note: note.trim() || null,
          tryFactor: currency === "TRY" ? 1 : rate!.rate.rateTry,
        });
      } else {
        await addTransaction(userId, {
          type: entryType,
          amountMinor: amountMinor!,
          currency,
          fxRate,
          amountTryMinor: tryMinor!,
          effectiveDate: dateStr,
          categoryId,
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
        setNote("");
      } else {
        router.back();
      }
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Segmented
        options={[
          { value: "expense", label: tr.tx.expense },
          { value: "income", label: tr.tx.income },
          { value: "transfer", label: tr.tx.transferInvest },
        ]}
        value={entryType}
        onChange={(v) => {
          setEntryType(v);
          if (v !== "expense") setInstallment(false);
        }}
      />

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
          {rate?.isStale ? <Badge text={`⚠ ${tr.tx.staleRate}`} tone="warning" /> : null}
        </View>
      ) : null}

      {categoryOptions.length > 0 ? (
        <>
          <Label>{tr.tx.category}</Label>
          <ChipPicker options={categoryOptions} value={categoryId} onChange={setCategoryId} />
        </>
      ) : null}

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

      <DateField label={tr.tx.effectiveDate} value={dateStr} onChange={setDateStr} />
      <Body muted style={{ marginTop: -spacing.sm, marginBottom: spacing.md, fontSize: 12 }}>
        {dateValid && dateStr > todayISO() ? tr.tx.futureHint : tr.tx.effectiveDateHint}
      </Body>

      {entryType === "expense" && sources.find((s) => s.id === sourceId)?.type === "credit_card" ? (
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
        <Button label={tr.tx.saveAndNew} variant="secondary" onPress={() => void save(true)} disabled={!canSave || busy} />
      </View>
    </Screen>
  );
}
