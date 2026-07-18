/** New / edit installment plan or loan (also supports mid-progress "4/6 paid" entry). */

import React, { useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { countInstallmentsForPlan, createInstallmentPlan, CreditCardCycleRequiredError, deletePlan, InstallmentHistoryConflictError, updateInstallmentPlan } from "../data/repo";
import { useCategories, usePersons, usePlans, useSources, useUserId } from "../data/hooks";
import { categoryIcon } from "../data/category-icons";
import { addMonthsToKey, monthKeyOf, todayISO } from "../domain/dates";
import { deriveStartMonth, isValidInstallmentCount } from "../domain/installments";
import { formatMinor } from "../domain/money";
import { monthLabel, tr } from "../i18n/tr";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react-native";
import { Body, Button, ChipPicker, Field, Heading, IconButton, Label, MoneyField, Row, Screen, Segmented, Spread } from "../ui/components";
import { useSubmitOnEnter } from "../ui/keyboard";
import { appAlert, appConfirm } from "../ui/dialog";
import { placeholderPools, useRotatingPlaceholder } from "../ui/placeholders";
import { scheduleSync } from "../sync/engine";
import { spacing } from "../ui/theme";
import { navigateBack } from "../ui/navigation";
import { devError } from "../services/logger";
import { newId } from "../db/ids";
import { useOperationGuard } from "../ui/operation-guard";

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
  const operationGuard = useOperationGuard();
  const categories = useCategories();
  const router = useRouter();
  const isEdit = existing != null;
  const close = () => navigateBack(router, "/(tabs)/cash-flow/installments");

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
  const selectedSource = sources.find((source) => source.id === sourceId);
  const cardSourceValid = kind !== "card_installment" || Boolean(
    selectedSource?.type === "credit_card" &&
    selectedSource.statementDay != null && selectedSource.statementDay >= 1 && selectedSource.statementDay <= 31 &&
    selectedSource.dueDay != null && selectedSource.dueDay >= 1 && selectedSource.dueDay <= 31
  );
  const sourceOptions = kind === "card_installment"
    ? sources.filter((source) => source.type === "credit_card")
    : sources;

  const count = Number(countStr);
  const paid = Number(paidStr);
  const valid =
    title.trim() !== "" &&
    amountMinor != null &&
    amountMinor > 0 &&
    isValidInstallmentCount(count) &&
    Number.isInteger(paid) &&
    paid >= 0 &&
    paid < count &&
    personId != null &&
    cardSourceValid;

  // On a new plan, "already paid N" back-derives the start month; on edit the
  // start month is edited directly.
  const resolvedStart =
    !isEdit && usePaidDerive && paid > 0
      ? deriveStartMonth(paid, monthKeyOf(todayISO()), sources.find((s) => s.id === sourceId)?.dueDay ?? null, todayISO())
      : startMonth;

  const save = async () => {
    if (!valid || !personId) return;
    await operationGuard.run(async () => {
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
        else await createInstallmentPlan(userId, input, newId());
        scheduleSync(userId);
        close();
      } catch (e) {
        devError("installment.save", e);
        void appAlert(
          e instanceof CreditCardCycleRequiredError
            ? tr.sources.cycleRequired
            : e instanceof InstallmentHistoryConflictError
              ? tr.installments.historyConflict
              : tr.errors.saveFailed,
          tr.errors.title,
        );
      } finally {
        setBusy(false);
      }
    });
  };

  const confirmDelete = () => {
    void (async () => {
      // Deleting a plan tombstones every generated installment and can't be
      // undone, so the confirmation spells out how many records go with it.
      const count = await countInstallmentsForPlan(userId, existing!.id);
      const ok = await appConfirm(existing!.title, tr.installments.deleteBody(count), {
        confirmLabel: tr.common.delete,
        danger: true,
      });
      if (!ok) return;
      await deletePlan(userId, existing!.id);
      scheduleSync(userId);
      close();
    })();
  };

  useSubmitOnEnter(() => void save(), valid && !busy);

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
          <ChipPicker options={sourceOptions.map((s) => ({ value: s.id, label: s.name }))} value={sourceId} onChange={setSourceId} />
          {kind === "card_installment" && !cardSourceValid ? (
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
      <Label>{tr.tx.category}</Label>
      <ChipPicker
        options={categories.filter((c) => c.kind === "expense").map((c) => ({ value: c.id, label: `${categoryIcon(c)} ${c.name}` }))}
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
