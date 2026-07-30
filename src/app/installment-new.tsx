/** New / edit installment plan or loan (also supports mid-progress "4/6 paid" entry). */

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { countInstallmentsForPlan, createInstallmentPlan, CreditCardCycleRequiredError, deletePlan, InstallmentHistoryConflictError, updateInstallmentPlan } from "../data/repo";
import { useCategoriesState, usePersonsState, usePlansState, useSourcesState, useUserId } from "../data/hooks";
import { combineLiveQueryStatus } from "../data/live-state";
import { classifyRecordId } from "../domain/route-params";
import { categoryIcon, paymentSourceIcon } from "../data/category-icons";
import { addMonthsToKey, monthKeyOf, todayISO, type MonthKey } from "../domain/dates";
import { deriveStartMonth, isValidInstallmentCount } from "../domain/installments";
import { formatMinor } from "../domain/money";
import { monthLabel, tr } from "../i18n/tr";
import { CalendarRange, ChevronLeft, ChevronRight, CreditCard, Trash2 } from "lucide-react-native";
import { Body, Button, Card, ChipPicker, DataStateNotice, FadeIn, Field, Heading, IconButton, Label, MoneyField, PanelHeader, Row, Screen, Segmented, Select, Spread } from "../ui/components";
import { useSubmitOnEnter } from "../ui/keyboard";
import { appAlert, appConfirm } from "../ui/dialog";
import { placeholderPools, useRotatingPlaceholder } from "../ui/placeholders";
import { scheduleSync } from "../sync/engine";
import { font, spacing, type, useTheme } from "../ui/theme";
import { navigateBack } from "../ui/navigation";
import { devError } from "../services/logger";
import { useOperationGuard } from "../ui/operation-guard";
import { useDirtyExitGuard } from "../ui/dirty-exit";
import { WorkspaceSplit } from "../ui/workspace-layout";

function InstallmentTimeline({ count, startMonth }: { count: number; startMonth: MonthKey }) {
  const { palette } = useTheme();
  const safeCount = Number.isInteger(count) && count > 0 ? count : 1;
  const visibleCount = Math.min(safeCount, 6);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={tr.installments.timelineA11y(safeCount, monthLabel(startMonth))}
      style={{ marginBottom: spacing.lg }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        {Array.from({ length: visibleCount }, (_, index) => {
          const month = addMonthsToKey(startMonth, index);
          return (
            <React.Fragment key={`${month}-${safeCount}`}>
              {index > 0 ? (
                <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginTop: 16 }} />
              ) : null}
              <FadeIn delay={index * 45} style={{ alignItems: "center", width: 38 }}>
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 12,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: index === 0 ? palette.primary : palette.surfaceAlt,
                  }}
                >
                  <Text style={[type.small, { color: index === 0 ? palette.onPrimary : palette.text, fontFamily: font.bold, fontSize: 10 }]}>
                    {index + 1}
                  </Text>
                </View>
                <Text style={[type.small, { color: palette.textSecondary, fontSize: 9, marginTop: 3 }]}>
                  {monthLabel(month).slice(0, 3)}
                </Text>
              </FadeIn>
            </React.Fragment>
          );
        })}
      </View>
      {safeCount > visibleCount ? (
        <Body muted style={{ fontSize: 11, marginTop: spacing.xs, textAlign: "right" }}>
          {tr.installments.timelineMore(safeCount - visibleCount)}
        </Body>
      ) : null}
    </View>
  );
}

export default function PlanModal() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const record = classifyRecordId(id);
  const plansState = usePlansState();
  const existing = record?.mode === "edit" ? plansState.data.find((p) => p.id === record.id) : undefined;
  // Loading is `updatedAt == null`; anything after that is a row that does not
  // exist, which must recover instead of rendering a permanent blank screen.
  if (!record) return <Redirect href="/(tabs)/cash-flow/installments" />;
  if (record.mode === "edit" && !existing) {
    if (plansState.updatedAt == null) {
      return (
        <Screen scroll={false}>
          <DataStateNotice status={plansState.status} retry={plansState.retry} />
        </Screen>
      );
    }
    return <Redirect href="/(tabs)/cash-flow/installments" />;
  }
  return <PlanForm key={existing?.id ?? "new"} existing={existing} />;
}

function PlanForm({ existing }: { existing?: ReturnType<typeof usePlansState>["data"][number] }) {
  const userId = useUserId();
  const sourcesState = useSourcesState();
  const personsState = usePersonsState();
  const operationGuard = useOperationGuard();
  const categoriesState = useCategoriesState();
  const sources = sourcesState.data;
  const persons = personsState.data;
  const categories = categoriesState.data;
  const router = useRouter();
  const isEdit = existing != null;
  const close = () => navigateBack(router, "/(tabs)/cash-flow/installments");
  const liveStates = [sourcesState, personsState, categoriesState];
  const dataStatus = combineLiveQueryStatus(liveStates);
  const dataReady = liveStates.every((state) => state.updatedAt != null);
  const retryData = () => {
    sourcesState.retry();
    personsState.retry();
    categoriesState.retry();
  };

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
  const draftSnapshot = JSON.stringify({ kind, title, amountRaw, countStr, paidStr, startMonth, sourceId, personChoice, categoryId });
  const initialDraftSnapshot = React.useRef(draftSnapshot).current;
  const { allowExit } = useDirtyExitGuard(draftSnapshot !== initialDraftSnapshot && !busy);
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
    dataReady &&
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
        else await createInstallmentPlan(userId, input);
        scheduleSync(userId);
        allowExit(close);
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
      try {
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
        allowExit(close);
      } catch {
        void appAlert(tr.errors.saveFailed, tr.errors.title);
      }
    })();
  };

  useSubmitOnEnter(() => void save(), valid && !busy);
  const titlePlaceholder = useRotatingPlaceholder(placeholderPools.installment);

  if (!dataReady) {
    return (
      <Screen>
        <Stack.Screen options={{ title: isEdit ? tr.installments.editTitle : tr.installments.newTitle }} />
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: isEdit ? tr.installments.editTitle : tr.installments.newTitle }} />
      <DataStateNotice status={dataStatus} retry={retryData} />
      <WorkspaceSplit
        testID="installment-form-workspace"
        primary={(
          <Card>
            <PanelHeader
              icon={CreditCard}
              title={tr.installments.planDetails}
              description={isEdit ? tr.installments.editHint : tr.installments.planDetailsHint}
            />
            <InstallmentTimeline count={count} startMonth={resolvedStart} />
            <Segmented
              options={[
                { value: "card_installment", label: tr.installments.plan },
                { value: "loan", label: tr.installments.loan },
              ]}
              value={kind}
              onChange={setKind}
            />
            <Field label={tr.installments.titleField} value={title} onChangeText={setTitle} placeholder={titlePlaceholder} />
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
            {valid && amountMinor ? (
              <Body muted>
                {kind === "card_installment"
                  ? tr.tx.installmentInfo(formatMinor(Math.trunc(amountMinor / count)), count)
                  : tr.tx.installmentInfo(formatMinor(amountMinor), count)}
              </Body>
            ) : null}
          </Card>
        )}
        secondary={(
          <Card>
            <PanelHeader icon={CalendarRange} title={tr.installments.scheduleAndAssignment} description={tr.installments.scheduleAndAssignmentHint} />
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
                <Select
                  label={tr.tx.source}
                  placeholder={tr.tx.sourcePlaceholder}
                  options={sourceOptions.map((s) => ({ value: s.id, label: s.name, icon: paymentSourceIcon(s.type) }))}
                  value={sourceId}
                  onChange={setSourceId}
                  onCreate={{ label: tr.tx.addSource, run: () => router.push("/payment-sources") }}
                />
                {kind === "card_installment" && !cardSourceValid ? (
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
            <Select
              label={tr.tx.category}
              placeholder={tr.tx.categoryPlaceholder}
              options={categories.filter((c) => c.kind === "expense").map((c) => ({ value: c.id, label: c.name, icon: categoryIcon(c) }))}
              value={categoryId}
              onChange={setCategoryId}
              onCreate={{ label: tr.tx.addCategory, run: () => router.push("/columns-editor") }}
            />

            <Button label={tr.common.save} onPress={() => void save()} disabled={!valid} loading={busy} />
            {isEdit ? (
              <View style={{ marginTop: spacing.md }}>
                <Button icon={Trash2} label={tr.installments.delete} variant="danger" onPress={confirmDelete} />
              </View>
            ) : null}
          </Card>
        )}
      />
    </Screen>
  );
}
