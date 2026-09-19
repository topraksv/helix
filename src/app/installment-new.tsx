/** New / edit installment plan or loan (also supports mid-progress "4/6 paid" entry), and a loan's closure or restructure (spec §3.2). */

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { closeInstallmentPlan, countInstallmentsForPlan, createInstallmentPlan, CreditCardCycleRequiredError, deletePlan, deleteTransaction, FxRateUnavailableError, InstallmentHistoryConflictError, reopenInstallmentPlan, updateInstallmentPlan } from "../data/repo";
import { useAllTransactionsState, useAnsweredForId, useCategoriesState, usePersonsState, usePlansState, useSourcesState, useUserId } from "../data/hooks";
import { combineLiveStates } from "../data/live-state";
import { classifyRecordId } from "../domain/route-params";
import { addMonthsToKey, monthKeyOf, todayISO, type ISODate, type MonthKey } from "../domain/dates";
import { isValidInstallmentCount, planAmounts, planDraft, planForSighting, planProgress, type GeneratedInstallment } from "../domain/installments";
import { formatMinorCompact, formatMinorInput } from "../domain/money";
import { installmentSplitText } from "../ui/installment-text";
import { dateLabel, monthLabel, tr } from "../i18n/tr";
import CalendarRange from "lucide-react-native/icons/calendar-range";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CreditCard from "lucide-react-native/icons/credit-card";
import Landmark from "lucide-react-native/icons/landmark";
import Trash from "lucide-react-native/icons/trash";
import Undo2 from "lucide-react-native/icons/undo-2";
import type { LucideIcon } from "lucide-react-native";
import { categoryIconComponent,  } from "../ui/category-icon";
import { PaymentSourceLogo } from "../ui/logo";
import { Badge, Body, Button, Card, CardList, ChoiceTile, DataGateScreen, DataStateNotice, FadeIn, Field, Heading, IconButton, Label, ListRow, MetricStrip, MoneyField, PanelHeader, Row, Screen, SegmentBar, Segmented, Select, Spread } from "../ui/components";
import { useSubmitOnEnter } from "../ui/keyboard";
import { appAlert, appConfirm } from "../ui/dialog";
import { placeholderPools, useRotatingPlaceholder } from "../ui/placeholders";
import { scheduleSync } from "../sync/engine";
import { font, radius, spacing, type, useTheme } from "../ui/theme";
import { navigateBack } from "../ui/navigation";
import { devError } from "../services/logger";
import { lookupRate, useFxRates } from "../services/fx-fetch";
import { useOperationGuard } from "../ui/operation-guard";
import { useDirtyExitGuard, useDraftDirty } from "../ui/dirty-exit";
import { WorkspaceSplit } from "../ui/workspace-layout";
import { DateField } from "../ui/calendar";
import { useUndo } from "../ui/undo";
import { assignedPersonId, PersonAssignment } from "../ui/person-assignment";

/** The Select's own icon column, so a source mark fits it exactly. */
const SOURCE_MARK = 22;

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
                    borderRadius: radius.lg,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: index === 0 ? palette.primary : palette.surfaceAlt,
                  }}
                >
                  <Text style={[type.small, { color: index === 0 ? palette.onPrimary : palette.text, fontFamily: font.bold, fontSize: type.micro.fontSize }]}>
                    {index + 1}
                  </Text>
                </View>
                <Text style={[type.small, { color: palette.textSecondary, fontSize: type.micro.fontSize, marginTop: 3 }]}>
                  {monthLabel(month).slice(0, 3)}
                </Text>
              </FadeIn>
            </React.Fragment>
          );
        })}
      </View>
      {safeCount > visibleCount ? (
        <Body muted style={{ fontSize: type.caption.fontSize, marginTop: spacing.xs, textAlign: "right" }}>
          {tr.installments.timelineMore(safeCount - visibleCount)}
        </Body>
      ) : null}
    </View>
  );
}

function PlanKindChoice({
  icon: Icon,
  label,
  selected,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  return (
    <ChoiceTile label={label} selected={selected} onPress={onPress}>
      <Icon accessible={false} size={22} color={selected ? palette.primaryText : palette.textSecondary} strokeWidth={2.2} />
    </ChoiceTile>
  );
}

export default function PlanModal() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const record = classifyRecordId(id);
  const plansState = usePlansState();
  const existing = record?.mode === "edit" ? plansState.data.find((p) => p.id === record.id) : undefined;
  // Dated proof, not merely "the query ran": this query is not parameterised
  // by the id, so a completion from before the row was written would otherwise
  // read as "no such plan". See `useAnsweredForId`.
  const answered = useAnsweredForId(plansState, record, existing != null);
  if (!record) return <Redirect href="/(tabs)/cash-flow/installments" />;
  if (record.mode === "edit" && !existing) {
    if (!answered) {
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

/**
 * What the plan being edited has actually done so far.
 *
 * Opening "edit" on a running plan showed an empty form with the same words as
 * "new": you could not see which month you were in, how many instalments had
 * been paid or what was left, so there was nothing to edit AGAINST. The rows
 * are the plan's own transactions, exactly as the list screen reads them.
 */
function PlanState({ planId }: { planId: string }) {
  const transactionsState = useAllTransactionsState();
  const items: GeneratedInstallment[] = transactionsState.data
    .filter((t) => t.installmentPlanId === planId && t.installmentNo != null)
    .map((t) => ({
      installmentNo: t.installmentNo!,
      month: monthKeyOf(t.effectiveDate),
      amountMinor: t.amountTryMinor,
      effectiveDate: t.effectiveDate,
      status: t.status,
    }))
    .sort((a, b) => a.installmentNo - b.installmentNo);
  if (items.length === 0) return null;
  const progress = planProgress(items);
  const finished = progress.remaining === 0;
  const current = items.find((item) => item.status === "pending");
  return (
    <Card>
      <PanelHeader
        icon={CalendarRange}
        tone={finished ? "success" : "primary"}
        title={tr.installments.planStateTitle}
        description={tr.installments.planStateHint}
        right={<Badge tone={finished ? "success" : "muted"} text={tr.installments.progress(progress.paid, progress.total)} />}
      />
      <SegmentBar ratio={progress.paid / Math.max(progress.total, 1)} segments={progress.total} height={8} />
      <MetricStrip
        items={[
          {
            label: tr.installments.currentInstallment,
            node: (
              <Body style={{ fontFamily: font.semibold }}>
                {current ? tr.installments.nthOfTotal(current.installmentNo, progress.total) : tr.installments.allPaid}
              </Body>
            ),
          },
          { label: tr.installments.monthlyAmount, minor: progress.monthlyMinor },
          { label: tr.installments.remainingAmount, minor: progress.remainingMinor },
        ]}
      />
      <Body muted style={{ marginTop: spacing.md }}>
        {current
          ? tr.installments.currentMonthLine(monthLabel(current.month), monthLabel(progress.endMonth))
          : tr.installments.finishedLine(monthLabel(progress.endMonth))}
      </Body>
    </Card>
  );
}

/**
 * The refunds recorded against this purchase, and what it comes to after them.
 *
 * A refund row opens THIS screen from the ledger — plan rows always do — so this
 * is where a refund is seen, and removed if it was entered wrong.
 */
function PlanRefunds({ planId }: { planId: string }) {
  const userId = useUserId();
  const router = useRouter();
  const transactionsState = useAllTransactionsState();
  const rows = transactionsState.data.filter((t) => t.installmentPlanId === planId);
  // A closed loan's payoff is the one unnumbered row that is not a refund.
  const refunds = rows.filter((t) => t.installmentNo == null && t.amountTryMinor < 0).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const purchaseMinor = rows.filter((t) => t.installmentNo != null).reduce((sum, t) => sum + t.amountTryMinor, 0);
  const refundedMinor = -refunds.reduce((sum, t) => sum + t.amountTryMinor, 0);
  const remove = (id: string, amountMinor: number) => {
    void (async () => {
      const ok = await appConfirm(tr.installments.refundDeleteTitle, tr.installments.refundDeleteBody(formatMinorCompact(-amountMinor)), {
        confirmLabel: tr.common.delete,
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteTransaction(userId, id);
        scheduleSync(userId);
      } catch {
        void appAlert(tr.errors.saveFailed, tr.errors.title);
      }
    })();
  };
  // The summary and the way in are one card; the refunds themselves are rows in
  // a list of their own, which is how every other list here draws its dividers
  // and lets a row's press fill reach the card's edge.
  return (
    <>
      <Card>
        <PanelHeader icon={Undo2} title={tr.installments.refundsTitle} description={tr.installments.refundsHint} />
        {refunds.length > 0 ? (
          <MetricStrip
            items={[
              { label: tr.installments.purchaseTotal, minor: purchaseMinor },
              { label: tr.installments.refundsTotal, minor: -refundedMinor },
              { label: tr.installments.netTotal, minor: purchaseMinor - refundedMinor },
            ]}
          />
        ) : (
          <Body muted>{tr.installments.refundsEmpty}</Body>
        )}
        <View style={{ marginTop: spacing.md }}>
          <Button
            icon={Undo2}
            label={tr.installments.refundAdd}
            variant="secondary"
            onPress={() => router.push({ pathname: "/installment-refund", params: { plan: planId } })}
          />
        </View>
      </Card>
      <CardList
        items={refunds}
        keyExtractor={(refund) => refund.id}
        renderItem={(refund) => (
          <ListRow
            title={formatMinorCompact(-refund.amountTryMinor)}
            subtitle={[monthLabel(monthKeyOf(refund.effectiveDate)), refund.note].filter(Boolean).join(" · ")}
            right={(
              <IconButton
                icon={Trash}
                label={`${tr.common.delete} · ${formatMinorCompact(-refund.amountTryMinor)}`}
                onPress={() => remove(refund.id, refund.amountTryMinor)}
              />
            )}
          />
        )}
      />
    </>
  );
}

type Plan = ReturnType<typeof usePlansState>["data"][number];
type Person = ReturnType<typeof usePersonsState>["data"][number];
type PlanRow = ReturnType<typeof useAllTransactionsState>["data"][number];

/** A loan action that failed, said in words the owner can act on. */
function reportLoanActionFailure(scope: string, error: unknown): void {
  devError(scope, error);
  void appAlert(
    error instanceof FxRateUnavailableError
      ? tr.errors.fxUnavailable
      : error instanceof InstallmentHistoryConflictError
        ? tr.installments.historyConflict
        : tr.errors.saveFailed,
    tr.errors.title,
  );
}

/** A saved plan as the input its own save would take, at `factor`. */
function savedPlanInput(plan: Plan, persons: Person[], factor: number) {
  return {
    title: plan.title,
    kind: plan.kind,
    totalAmountMinor: plan.totalAmountMinor,
    monthlyAmountMinor: plan.monthlyAmountMinor,
    installmentCount: plan.installmentCount,
    currency: plan.currency,
    fxRate: plan.currency === "TRY" ? null : String(factor),
    startMonth: plan.startMonth,
    dueDay: plan.dueDay,
    paymentSourceId: plan.paymentSourceId,
    personId: plan.personId,
    personIsSelf: persons.find((person) => person.id === plan.personId)?.isSelf === true,
    categoryId: plan.categoryId,
    note: plan.note,
    tryFactor: factor,
  };
}

/**
 * What a bank can still do to a running loan: close it early, or change what
 * is left of it (owner decision, 2026-09-13).
 *
 * Every action works on the plan as it is SAVED, never on the form beside it,
 * so an edit half-typed there cannot leak into a payoff. A closure removes
 * instalments, so it asks first and can always be taken back — from the
 * snackbar at once, and from the closed card for as long as the loan exists.
 */
function LoanActions({ plan, persons, rateTry }: { plan: Plan; persons: Person[]; rateTry: number | null }) {
  const transactionsState = useAllTransactionsState();
  const rows = transactionsState.data.filter((t) => t.installmentPlanId === plan.id);
  const instalments = rows.filter((t) => t.installmentNo != null).sort((a, b) => a.installmentNo! - b.installmentNo!);
  const pending = instalments.filter((t) => t.status === "pending");
  if (plan.closedOn) {
    return <ClosedLoanCard plan={plan} payoff={rows.find((t) => t.installmentNo == null && t.amountMinor > 0)} />;
  }
  if (pending.length === 0) return null;
  return (
    <>
      <RestructureLoanCard plan={plan} persons={persons} rateTry={rateTry} pending={pending} paidCount={instalments.length - pending.length} />
      <CloseLoanCard plan={plan} instalments={instalments} />
    </>
  );
}

function ClosedLoanCard({ plan, payoff }: { plan: Plan; payoff: PlanRow | undefined }) {
  const userId = useUserId();
  const undo = useUndo();
  const operationGuard = useOperationGuard();
  const [busy, setBusy] = useState(false);
  const closedOn = plan.closedOn as ISODate;
  const reopen = () => void (async () => {
    const ok = await appConfirm(tr.installments.reopenConfirmTitle, tr.installments.reopenConfirmBody, { confirmLabel: tr.installments.reopenAction });
    if (!ok) return;
    // Taking the reopen back closes the loan again exactly as it was closed.
    const closure = { closedOn, payoffMinor: payoff?.amountMinor ?? 0, note: payoff?.note ?? null };
    await operationGuard.run(async () => {
      setBusy(true);
      try {
        await reopenInstallmentPlan(userId, plan.id);
        scheduleSync(userId);
        undo.show(tr.installments.reopenedNotice, () => closeInstallmentPlan(userId, plan.id, closure).then(() => scheduleSync(userId)));
      } catch (error) {
        reportLoanActionFailure("installment.reopen", error);
      } finally {
        setBusy(false);
      }
    });
  })();
  return (
    <Card>
      <PanelHeader
        icon={Landmark}
        tone="success"
        title={tr.installments.closedTitle}
        description={tr.installments.closedLine(dateLabel(closedOn), payoff ? formatMinorCompact(payoff.amountMinor, plan.currency) : null)}
      />
      <Body muted style={{ marginBottom: spacing.md }}>{tr.installments.closedEditLocked}</Body>
      <Button icon={Undo2} variant="secondary" label={tr.installments.reopenAction} onPress={reopen} loading={busy} disabled={busy} />
    </Card>
  );
}

function RestructureLoanCard({
  plan,
  persons,
  rateTry,
  pending,
  paidCount,
}: {
  plan: Plan;
  persons: Person[];
  rateTry: number | null;
  pending: PlanRow[];
  paidCount: number;
}) {
  const userId = useUserId();
  const undo = useUndo();
  const operationGuard = useOperationGuard();
  const nextMonthly = pending[0]?.amountMinor ?? plan.monthlyAmountMinor ?? null;
  const [monthlyRaw, setMonthlyRaw] = useState(nextMonthly != null ? formatMinorInput(nextMonthly) : "");
  const [monthlyMinor, setMonthlyMinor] = useState<number | null>(nextMonthly);
  const [remainingStr, setRemainingStr] = useState(String(pending.length));
  const [busy, setBusy] = useState(false);
  const remaining = Number(remainingStr);
  const valid = monthlyMinor != null && monthlyMinor > 0 && Number.isInteger(remaining) && remaining >= 1
    && isValidInstallmentCount(paidCount + remaining) && rateTry != null;
  const restructure = () => void operationGuard.run(async () => {
    if (!valid) return;
    setBusy(true);
    try {
      // The plan as saved, which is also what taking this back restores.
      const before = savedPlanInput(plan, persons, rateTry);
      await updateInstallmentPlan(userId, plan.id, { ...before, totalAmountMinor: null, monthlyAmountMinor: monthlyMinor, installmentCount: paidCount + remaining });
      scheduleSync(userId);
      undo.show(tr.installments.restructuredNotice, () => updateInstallmentPlan(userId, plan.id, before).then(() => scheduleSync(userId)));
    } catch (error) {
      reportLoanActionFailure("installment.restructure", error);
    } finally {
      setBusy(false);
    }
  });
  const currencySuffix = plan.currency === "TRY" ? "" : ` · ${plan.currency}`;
  return (
    <Card>
      <PanelHeader icon={CalendarRange} title={tr.installments.restructureTitle} description={tr.installments.restructureHint} />
      <Row>
        <View style={{ flex: 1 }}>
          <MoneyField
            label={`${tr.installments.restructureMonthly}${currencySuffix}`}
            value={monthlyRaw}
            onChangeMinor={(raw, minor) => {
              setMonthlyRaw(raw);
              setMonthlyMinor(minor);
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field label={tr.installments.restructureRemaining} value={remainingStr} onChangeText={setRemainingStr} keyboardType="number-pad" />
        </View>
      </Row>
      {valid ? (
        <Body muted style={{ marginBottom: spacing.md }}>
          {tr.installments.restructurePreview(
            remaining,
            formatMinorCompact(monthlyMinor, plan.currency),
            monthLabel(addMonthsToKey(monthKeyOf(pending[0]!.effectiveDate), remaining - 1)),
          )}
        </Body>
      ) : null}
      <Button label={tr.installments.restructureAction} variant="secondary" onPress={restructure} disabled={!valid || busy} loading={busy} />
    </Card>
  );
}

function CloseLoanCard({ plan, instalments }: { plan: Plan; instalments: PlanRow[] }) {
  const userId = useUserId();
  const undo = useUndo();
  const operationGuard = useOperationGuard();
  const today = todayISO();
  const [closedOn, setClosedOn] = useState<ISODate>(today);
  const [payoffRaw, setPayoffRaw] = useState("");
  const [payoffMinor, setPayoffMinor] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // A loan closed before its first instalment never ran; that one is deleted.
  const closesAfterFirst = instalments.some((t) => t.effectiveDate <= closedOn);
  const valid = payoffMinor != null && payoffMinor >= 0 && closedOn <= today && closesAfterFirst;
  const removed = instalments.filter((t) => t.effectiveDate > closedOn).length;
  const close = () => void (async () => {
    if (!valid) return;
    const ok = await appConfirm(
      tr.installments.closeConfirmTitle,
      tr.installments.closeConfirmBody(dateLabel(closedOn), formatMinorCompact(payoffMinor, plan.currency), removed),
      { confirmLabel: tr.installments.closeAction, danger: true },
    );
    if (!ok) return;
    await operationGuard.run(async () => {
      setBusy(true);
      try {
        await closeInstallmentPlan(userId, plan.id, { closedOn, payoffMinor, note: note.trim() || null });
        scheduleSync(userId);
        undo.show(tr.installments.closedNotice, () => reopenInstallmentPlan(userId, plan.id).then(() => scheduleSync(userId)), "warning");
      } catch (error) {
        reportLoanActionFailure("installment.close", error);
      } finally {
        setBusy(false);
      }
    });
  })();
  return (
    <Card>
      <PanelHeader icon={Landmark} title={tr.installments.closeTitle} description={tr.installments.closeHint} />
      <DateField label={tr.installments.closedOnField} value={closedOn} onChange={setClosedOn} max={today} />
      <MoneyField
        label={`${tr.installments.payoffAmount}${plan.currency === "TRY" ? "" : ` · ${plan.currency}`}`}
        value={payoffRaw}
        onChangeMinor={(raw, minor) => {
          setPayoffRaw(raw);
          setPayoffMinor(minor);
        }}
      />
      <Field label={tr.installments.closeNote} value={note} onChangeText={setNote} />
      <Body muted style={{ marginBottom: spacing.md }}>
        {closesAfterFirst ? tr.installments.closePreview(removed) : tr.installments.closeBeforeFirst}
      </Body>
      <Button icon={Landmark} label={tr.installments.closeAction} variant="danger" onPress={close} disabled={!valid || busy} loading={busy} />
    </Card>
  );
}

function saveFailureMessage(error: unknown): string {
  if (error instanceof CreditCardCycleRequiredError) return tr.sources.cycleRequired;
  return error instanceof InstallmentHistoryConflictError ? tr.installments.historyConflict : tr.errors.saveFailed;
}

/** How the entered figure splits: a monthly amount's total, or a whole purchase's first and later instalments. */
function amountInfo(mode: "total" | "monthly", amountMinor: number, count: number, currency: string): string | null {
  return mode === "monthly"
    ? tr.installments.monthlyTotalInfo(count, formatMinorCompact(amountMinor, currency), formatMinorCompact(amountMinor * count, currency))
    : installmentSplitText(amountMinor, count, currency);
}

type ExistingPlan = ReturnType<typeof usePlansState>["data"][number];

interface PlanFields {
  kind: "card_installment" | "loan";
  title: string;
  amountRaw: string;
  amountMinor: number | null;
  countText: string;
  /** "6.000 in 6" and "1.000 a month, 6 times" are one plan said two ways; until chosen, it follows the kind. */
  modeChoice: "total" | "monthly" | null;
  paidText: string | null;
  startChoice: MonthKey | null;
  sourceId: string | null;
  personChoice: string | null;
  categoryId: string | null;
  /** A loan's own payment day; without one a loan from an account with no day put every instalment on the 1st. */
  dueDayText: string;
}

const NEW_PLAN: PlanFields = {
  kind: "card_installment", title: "", amountRaw: "", amountMinor: null, countText: "6", modeChoice: null, paidText: null,
  startChoice: null, sourceId: null, personChoice: null, categoryId: null, dueDayText: "",
};

function planFields(plan: ExistingPlan | undefined): PlanFields {
  if (!plan) return NEW_PLAN;
  // Whichever figure the plan was saved with: imported plans carry a monthly amount even on a card.
  const amountMinor = plan.totalAmountMinor ?? plan.monthlyAmountMinor;
  return {
    kind: plan.kind, title: plan.title, amountRaw: amountMinor != null ? formatMinorInput(amountMinor) : "", amountMinor,
    countText: String(plan.installmentCount), modeChoice: plan.totalAmountMinor != null ? "total" : "monthly", paidText: null,
    startChoice: plan.startMonth, sourceId: plan.paymentSourceId, personChoice: plan.personId, categoryId: plan.categoryId,
    dueDayText: plan.kind === "loan" && plan.dueDay != null ? String(plan.dueDay) : "",
  };
}

/** A plan keeps the currency it was bought in; saving a USD plan as TRY at a factor of 1 once rewrote 100 USD as ₺100. */
function usePlanRate(userId: string, plan: ExistingPlan | undefined) {
  const currency = plan?.currency ?? "TRY";
  useFxRates();
  return { currency, rateTry: currency === "TRY" ? 1 : lookupRate(userId, currency)?.rate.rateTry ?? null };
}

/** The plan form's fields, what they add up to, and saving it. */
function usePlanForm(existing: ExistingPlan | undefined) {
  const userId = useUserId();
  const sourcesState = useSourcesState();
  const personsState = usePersonsState();
  const categoriesState = useCategoriesState();
  const transactionsState = useAllTransactionsState();
  const plansState = usePlansState();
  const operationGuard = useOperationGuard();
  const router = useRouter();
  const data = combineLiveStates([sourcesState, personsState, categoriesState, transactionsState]);
  const persons = personsState.data;
  const close = () => navigateBack(router, "/(tabs)/cash-flow/installments");
  const [fields, setFields] = useState(() => planFields(existing));
  const set = <K extends keyof PlanFields>(key: K) => (value: PlanFields[K]) => setFields((current) => ({ ...current, [key]: value }));
  const [busy, setBusy] = useState(false);
  const { allowExit } = useDirtyExitGuard(useDraftDirty(JSON.stringify(fields), data.ready) && !busy);
  // The field starts at what the plan's rows say was paid, so correcting it is changing one number.
  const storedPaid = existing ? transactionsState.data.filter((t) => t.installmentPlanId === existing.id && t.installmentNo != null && t.status === "realized").length : 0;
  const { currency, rateTry } = usePlanRate(userId, existing);
  const amountMode = fields.modeChoice ?? (fields.kind === "loan" ? "monthly" : "total");
  const personId = assignedPersonId(fields.personChoice, persons);
  const selectedSource = sourcesState.data.find((source) => source.id === fields.sourceId) ?? null;
  const draft = planDraft({ ...fields, storedPaid, existingStartMonth: existing?.startMonth ?? null, card: selectedSource, today: todayISO() });
  const closed = existing?.closedOn != null;
  const valid = data.ready && draft.valid && personId != null && rateTry != null && !closed;

  const save = () => operationGuard.run(async () => {
    if (!valid || !personId) return;
    const amounts = {
      totalAmountMinor: amountMode === "total" ? fields.amountMinor! : null,
      monthlyAmountMinor: amountMode === "monthly" ? fields.amountMinor! : null,
      installmentCount: draft.count,
    };
    // The purchase may already be here from a workbook or a statement under another name.
    // Said, not refused: two identical purchases are two plans.
    const twin = existing ? null : planForSighting({
      month: draft.resolvedStart,
      amountMinor: planAmounts(amounts)[0]!,
      endMonth: addMonthsToKey(draft.resolvedStart, draft.count - 1),
      startMonth: draft.resolvedStart,
      paymentSourceId: fields.sourceId,
    }, currency === "TRY" ? plansState.data : []);
    if (twin && !(await appConfirm(tr.installments.twinTitle, tr.installments.twinBody(twin.plan.title), { confirmLabel: tr.installments.twinConfirm }))) return;
    setBusy(true);
    try {
      const input = {
        title: fields.title.trim(), kind: fields.kind, ...amounts, currency, fxRate: currency === "TRY" ? null : String(rateTry),
        startMonth: draft.resolvedStart, dueDay: draft.dueDay, paymentSourceId: fields.sourceId, personId,
        personIsSelf: persons.find((p) => p.id === personId)!.isSelf, categoryId: fields.categoryId, note: existing?.note ?? null, tryFactor: rateTry!,
      };
      if (existing) await updateInstallmentPlan(userId, existing.id, input, { reschedule: draft.reschedule });
      else await createInstallmentPlan(userId, input);
      scheduleSync(userId);
      allowExit(close);
    } catch (e) {
      devError("installment.save", e);
      void appAlert(saveFailureMessage(e), tr.errors.title);
    } finally {
      setBusy(false);
    }
  });

  // Deleting a plan tombstones every generated instalment and cannot be undone, so the confirmation counts them.
  const confirmDelete = () => void (async () => {
    try {
      const count = await countInstallmentsForPlan(userId, existing!.id);
      if (!(await appConfirm(existing!.title, tr.installments.deleteBody(count), { confirmLabel: tr.common.delete, danger: true }))) return;
      await deletePlan(userId, existing!.id);
      scheduleSync(userId);
      allowExit(close);
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    }
  })();

  return {
    isEdit: existing != null, data, persons, categories: categoriesState.data, sources: sourcesState.data, selectedSource, currency, rateTry, storedPaid,
    fields, set, amountMode, personId, draft, closed, valid, busy, save, confirmDelete,
  };
}

type PlanFormModel = ReturnType<typeof usePlanForm>;

function PlanDetailsCard({ form }: { form: PlanFormModel }) {
  const { fields, set, draft, currency, amountMode } = form;
  const titlePlaceholder = useRotatingPlaceholder(placeholderPools.installment);
  const amountLabel = amountMode === "total" ? tr.installments.totalAmount : tr.installments.monthlyAmount;
  return (
    <Card>
      <PanelHeader icon={CreditCard} title={tr.installments.planDetails} description={form.isEdit ? tr.installments.editHint : tr.installments.planDetailsHint} />
      <InstallmentTimeline count={draft.count} startMonth={draft.resolvedStart} />
      <View accessibilityRole="radiogroup" accessibilityLabel={tr.installments.planType} style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md }}>
        <PlanKindChoice icon={CreditCard} label={tr.installments.plan} selected={fields.kind === "card_installment"} onPress={() => set("kind")("card_installment")} />
        <PlanKindChoice icon={Landmark} label={tr.installments.loan} selected={fields.kind === "loan"} onPress={() => set("kind")("loan")} />
      </View>
      <Field label={tr.installments.titleField} value={fields.title} onChangeText={set("title")} placeholder={titlePlaceholder} />
      <Segmented
        options={[{ value: "total", label: tr.installments.totalAmount }, { value: "monthly", label: tr.installments.monthlyAmount }]}
        value={amountMode}
        onChange={set("modeChoice")}
      />
      <MoneyField
        label={currency === "TRY" ? amountLabel : `${amountLabel} · ${currency}`}
        value={fields.amountRaw}
        onChangeMinor={(raw, minor) => {
          set("amountRaw")(raw);
          set("amountMinor")(minor);
        }}
      />
      <Row>
        <View style={{ flex: 1 }}>
          <Field label={tr.installments.count} value={fields.countText} onChangeText={set("countText")} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label={tr.tx.alreadyPaid} value={fields.paidText ?? String(form.storedPaid)} onChangeText={set("paidText")} keyboardType="number-pad" />
        </View>
      </Row>
      {form.rateTry == null ? <Body muted style={{ marginBottom: spacing.sm }}>{tr.errors.fxUnavailable}</Body> : null}
      {form.valid && fields.amountMinor ? <Body muted>{amountInfo(amountMode, fields.amountMinor, draft.count, currency)}</Body> : null}
    </Card>
  );
}

function PlanScheduleCard({ form }: { form: PlanFormModel }) {
  const router = useRouter();
  const { fields, set, draft } = form;
  const sourceOptions = fields.kind === "card_installment" ? form.sources.filter((source) => source.type === "credit_card") : form.sources;
  return (
    <Card>
      <PanelHeader icon={CalendarRange} title={tr.installments.scheduleAndAssignment} description={tr.installments.scheduleAndAssignmentHint} />
      {draft.paidChanged ? (
        <Body muted style={{ marginBottom: spacing.md }}>
          {tr.installments.progress(draft.paid, draft.count)} → {tr.installments.startMonth}: {monthLabel(draft.resolvedStart)}
        </Body>
      ) : (
        <>
          <Label>{tr.installments.startMonth}</Label>
          <Spread style={{ marginBottom: spacing.md }}>
            <IconButton icon={ChevronLeft} label={tr.installments.startMonth} onPress={() => set("startChoice")(addMonthsToKey(draft.startMonth, -1))} />
            <Heading>{monthLabel(draft.startMonth)}</Heading>
            <IconButton icon={ChevronRight} label={tr.installments.startMonth} onPress={() => set("startChoice")(addMonthsToKey(draft.startMonth, 1))} />
          </Spread>
        </>
      )}
      {draft.reschedule ? <Body muted style={{ marginBottom: spacing.md }}>{tr.installments.rescheduleNote}</Body> : null}
      <Select
        label={tr.tx.source}
        placeholder={tr.tx.sourcePlaceholder}
        options={sourceOptions.map((s) => ({ value: s.id, label: s.name, icon: <PaymentSourceLogo name={s.name} type={s.type} logoRef={s.logoRef} size={SOURCE_MARK} /> }))}
        value={fields.sourceId}
        onChange={set("sourceId")}
        onCreate={{ label: tr.installments.addCard, run: () => router.push("/payment-sources") }}
      />
      {draft.cardSourceValid ? null : <Body muted style={{ marginBottom: spacing.sm }}>{tr.tx.cardCycleMissing}</Body>}
      {fields.kind === "loan" ? (
        <>
          <Field label={tr.installments.dueDayField} value={fields.dueDayText} onChangeText={set("dueDayText")} keyboardType="number-pad" placeholder={String(form.selectedSource?.dueDay ?? 1)} />
          <Body muted style={{ marginBottom: spacing.md }}>{tr.installments.dueDayHint}</Body>
        </>
      ) : null}
      <PersonAssignment people={form.persons} value={form.personId} onChange={set("personChoice")} />
      <Select
        label={tr.tx.category}
        placeholder={tr.tx.categoryPlaceholder}
        options={form.categories.filter((c) => c.kind === "expense").map((c) => ({ value: c.id, label: c.name, icon: categoryIconComponent(c) }))}
        value={fields.categoryId}
        onChange={set("categoryId")}
        onCreate={{ label: tr.tx.addCategory, run: () => router.push("/columns-editor") }}
      />
      {form.closed ? <Body muted style={{ marginBottom: spacing.sm }}>{tr.installments.closedEditLocked}</Body> : null}
      <Button label={tr.common.save} onPress={() => void form.save()} disabled={!form.valid} loading={form.busy} />
      {form.isEdit ? (
        <View style={{ marginTop: spacing.md }}>
          <Button icon={Trash} label={tr.installments.delete} variant="danger" onPress={form.confirmDelete} />
        </View>
      ) : null}
    </Card>
  );
}

function PlanForm({ existing }: { existing?: ExistingPlan }) {
  const form = usePlanForm(existing);
  const title = existing ? tr.installments.editTitle : tr.installments.newTitle;
  useSubmitOnEnter(() => void form.save(), form.valid && !form.busy);
  if (!form.data.ready) {
    return (
      <DataGateScreen status={form.data.status} retry={form.data.retry}>
        <Stack.Screen options={{ title }} />
      </DataGateScreen>
    );
  }
  return (
    <Screen width="workspace">
      <Stack.Screen options={{ title }} />
      <DataStateNotice status={form.data.status} retry={form.data.retry} />
      {existing ? <PlanState planId={existing.id} /> : null}
      <WorkspaceSplit testID="installment-form-workspace" primary={<PlanDetailsCard form={form} />} secondary={<PlanScheduleCard form={form} />} />
      {existing?.kind === "loan" ? <LoanActions plan={existing} persons={form.persons} rateTry={form.rateTry} /> : null}
      {existing ? <PlanRefunds planId={existing.id} /> : null}
    </Screen>
  );
}
