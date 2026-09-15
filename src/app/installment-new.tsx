/** New / edit installment plan or loan (also supports mid-progress "4/6 paid" entry), and a loan's closure or restructure (spec §3.2). */

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { closeInstallmentPlan, countInstallmentsForPlan, createInstallmentPlan, CreditCardCycleRequiredError, deletePlan, deleteTransaction, FxRateUnavailableError, InstallmentHistoryConflictError, reopenInstallmentPlan, updateInstallmentPlan } from "../data/repo";
import { useAllTransactionsState, useAnsweredForId, useCategoriesState, usePersonsState, usePlansState, useSourcesState, useUserId } from "../data/hooks";
import { combineLiveStates } from "../data/live-state";
import { classifyRecordId } from "../domain/route-params";
import { addMonthsToKey, monthKeyOf, todayISO, type ISODate, type MonthKey } from "../domain/dates";
import { firstInstallmentMonth, isValidCardCycle } from "../domain/card-statements";
import { deriveStartMonth, isValidInstallmentCount, planProgress, type GeneratedInstallment } from "../domain/installments";
import { formatMinorCompact, formatMinorInput, installmentShareRange } from "../domain/money";
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
import { PersonAssignment } from "../ui/person-assignment";

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

function PlanForm({ existing }: { existing?: ReturnType<typeof usePlansState>["data"][number] }) {
  const userId = useUserId();
  const sourcesState = useSourcesState();
  const personsState = usePersonsState();
  const operationGuard = useOperationGuard();
  const categoriesState = useCategoriesState();
  const transactionsState = useAllTransactionsState();
  const sources = sourcesState.data;
  const persons = personsState.data;
  const categories = categoriesState.data;
  const router = useRouter();
  const isEdit = existing != null;
  const close = () => navigateBack(router, "/(tabs)/cash-flow/installments");
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([sourcesState, personsState, categoriesState, transactionsState]);
  // How many instalments the plan's own rows say were paid. The field starts
  // there on an edit, so correcting a wrong count is changing one number.
  const storedPaid = existing
    ? transactionsState.data.filter((t) => t.installmentPlanId === existing.id && t.installmentNo != null && t.status === "realized").length
    : 0;

  // A plan keeps the currency it was bought in. This form used to write every
  // save as TRY at a factor of 1, so editing a 100 USD plan rewrote its unpaid
  // instalments as ₺100. The TRY figure is the last known rate; maintenance
  // restates coming instalments as rates arrive.
  const currency = existing?.currency ?? "TRY";
  useFxRates();
  const rateTry = currency === "TRY" ? 1 : lookupRate(userId, currency)?.rate.rateTry ?? null;
  const [kind, setKind] = useState<"card_installment" | "loan">(existing?.kind ?? "card_installment");
  // Whichever figure the plan was saved with. A plan imported from a workbook
  // or a statement carries a MONTHLY amount even on a card, and reading only
  // the total opened those plans with an empty amount.
  const existingAmountMinor = existing ? (existing.totalAmountMinor ?? existing.monthlyAmountMinor) : null;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [amountRaw, setAmountRaw] = useState(existingAmountMinor != null ? formatMinorInput(existingAmountMinor) : "");
  const [amountMinor, setAmountMinor] = useState<number | null>(existingAmountMinor ?? null);
  const [countStr, setCountStr] = useState(String(existing?.installmentCount ?? 6));
  /**
   * Entered as the whole purchase or as one instalment — "6.000 in 6" and
   * "1.000 a month, 6 times" are the same plan said two ways, and people read
   * whichever one their statement printed. Until chosen, it follows the kind.
   */
  const [modeChoice, setModeChoice] = useState<"total" | "monthly" | null>(
    existing ? (existing.totalAmountMinor != null ? "total" : "monthly") : null,
  );
  const amountMode = modeChoice ?? (kind === "loan" ? "monthly" : "total");
  const [paidChoice, setPaidChoice] = useState<string | null>(null);
  const paidStr = paidChoice ?? String(storedPaid);
  const [startChoice, setStartMonth] = useState<MonthKey | null>(existing?.startMonth ?? null);
  const [sourceId, setSourceId] = useState<string | null>(existing?.paymentSourceId ?? null);
  // persons load async (live query) — derive the default instead of freezing
  // a null initial state computed before the first query resolves.
  const [personChoice, setPersonChoice] = useState<string | null>(existing?.personId ?? null);
  const personId = personChoice ?? persons.find((p) => p.isSelf)?.id ?? persons[0]?.id ?? null;
  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null);
  // A loan's own payment day. Without one a loan paid from an account with no
  // day of its own put every instalment on the 1st.
  const [dueDayStr, setDueDayStr] = useState(existing?.kind === "loan" && existing.dueDay != null ? String(existing.dueDay) : "");
  const [busy, setBusy] = useState(false);
  const draftSnapshot = JSON.stringify({ kind, title, amountRaw, modeChoice, countStr, paidChoice, startChoice, sourceId, personChoice, categoryId, dueDayStr });
  const { allowExit } = useDirtyExitGuard(useDraftDirty(draftSnapshot, dataReady) && !busy);
  const selectedSource = sources.find((source) => source.id === sourceId);
  const cardSourceValid = kind !== "card_installment" || Boolean(
    selectedSource?.type === "credit_card" &&
    selectedSource.statementDay != null && selectedSource.statementDay >= 1 && selectedSource.statementDay <= 31 &&
    selectedSource.dueDay != null && selectedSource.dueDay >= 1 && selectedSource.dueDay <= 31
  );
  // Until the owner picks a month, a new card plan starts on the statement a
  // purchase made today joins. Starting it in the current month dated the first
  // instalment on this month's due day, which on a card already past it counted
  // as paid and came straight off today's balance.
  const cardCycle = { statementDay: selectedSource?.statementDay ?? null, dueDay: selectedSource?.dueDay ?? null };
  const startMonth = startChoice ?? (kind === "card_installment" && isValidCardCycle(cardCycle)
    ? firstInstallmentMonth(todayISO(), cardCycle)
    : monthKeyOf(todayISO()));
  const typedDueDay = dueDayStr.trim() === "" ? null : Number(dueDayStr);
  const dueDayValid = kind !== "loan" || typedDueDay == null || (Number.isInteger(typedDueDay) && typedDueDay >= 1 && typedDueDay <= 31);
  const dueDay = (kind === "loan" ? typedDueDay : null) ?? selectedSource?.dueDay ?? null;
  const closed = existing?.closedOn != null;
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
    paid <= count &&
    personId != null &&
    rateTry != null &&
    cardSourceValid &&
    dueDayValid &&
    !closed;

  // "Already paid N" places the start month: on a new plan whenever it is set,
  // on an edit only once the owner corrects it — an edit that leaves the count
  // alone leaves the schedule where it is.
  const paidChanged = isEdit ? paidChoice != null && paid !== storedPaid : paid > 0;
  const resolvedStart = paidChanged
    ? deriveStartMonth(paid, monthKeyOf(todayISO()), dueDay, todayISO())
    : startMonth;
  const reschedule = existing != null && resolvedStart !== existing.startMonth;

  const save = async () => {
    if (!valid || !personId) return;
    await operationGuard.run(async () => {
      setBusy(true);
      try {
        const person = persons.find((p) => p.id === personId)!;
        const input = {
          title: title.trim(),
          kind,
          totalAmountMinor: amountMode === "total" ? amountMinor! : null,
          monthlyAmountMinor: amountMode === "monthly" ? amountMinor! : null,
          installmentCount: count,
          currency,
          fxRate: currency === "TRY" ? null : String(rateTry),
          startMonth: resolvedStart,
          dueDay,
          paymentSourceId: sourceId,
          personId,
          personIsSelf: person.isSelf,
          categoryId,
          note: existing?.note ?? null,
          tryFactor: rateTry!,
        };
        if (isEdit) await updateInstallmentPlan(userId, existing!.id, input, { reschedule });
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
      <DataGateScreen status={dataStatus} retry={retryData}>
        <Stack.Screen options={{ title: isEdit ? tr.installments.editTitle : tr.installments.newTitle }} />
      </DataGateScreen>
    );
  }

  return (
    <Screen width="workspace">
      <Stack.Screen options={{ title: isEdit ? tr.installments.editTitle : tr.installments.newTitle }} />
      <DataStateNotice status={dataStatus} retry={retryData} />
      {existing ? <PlanState planId={existing.id} /> : null}
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
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={tr.installments.planType}
              style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md }}
            >
              <PlanKindChoice
                icon={CreditCard}
                label={tr.installments.plan}
                selected={kind === "card_installment"}
                onPress={() => setKind("card_installment")}
              />
              <PlanKindChoice
                icon={Landmark}
                label={tr.installments.loan}
                selected={kind === "loan"}
                onPress={() => setKind("loan")}
              />
            </View>
            <Field label={tr.installments.titleField} value={title} onChangeText={setTitle} placeholder={titlePlaceholder} />
            <Segmented
              options={[
                { value: "total", label: tr.installments.totalAmount },
                { value: "monthly", label: tr.installments.monthlyAmount },
              ]}
              value={amountMode}
              onChange={setModeChoice}
            />
            <MoneyField
              label={`${amountMode === "total" ? tr.installments.totalAmount : tr.installments.monthlyAmount}${currency === "TRY" ? "" : ` · ${currency}`}`}
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
                <Field label={tr.tx.alreadyPaid} value={paidStr} onChangeText={setPaidChoice} keyboardType="number-pad" />
              </View>
            </Row>
            {rateTry == null ? <Body muted style={{ marginBottom: spacing.sm }}>{tr.errors.fxUnavailable}</Body> : null}
            {valid && amountMinor ? (
              <Body muted>
                {amountMode === "monthly"
                  ? tr.installments.monthlyTotalInfo(count, formatMinorCompact(amountMinor, currency), formatMinorCompact(amountMinor * count, currency))
                  : (() => {
                const shares = installmentShareRange(amountMinor, count);
                if (!shares) return null;
                return shares.first === shares.rest
                  ? tr.tx.installmentInfo(formatMinorCompact(shares.first, currency), count)
                  : tr.tx.installmentInfoUneven(count, formatMinorCompact(shares.first, currency), formatMinorCompact(shares.rest, currency));
              })()}
              </Body>
            ) : null}
          </Card>
        )}
        secondary={(
          <Card>
            <PanelHeader icon={CalendarRange} title={tr.installments.scheduleAndAssignment} description={tr.installments.scheduleAndAssignmentHint} />
            {paidChanged ? (
              <Body muted style={{ marginBottom: spacing.md }}>
                {tr.installments.progress(paid, count)} → {tr.installments.startMonth}: {monthLabel(resolvedStart)}
              </Body>
            ) : (
              <>
                <Label>{tr.installments.startMonth}</Label>
                <Spread style={{ marginBottom: spacing.md }}>
                  <IconButton icon={ChevronLeft} label={tr.installments.startMonth} onPress={() => setStartMonth(addMonthsToKey(startMonth, -1))} />
                  <Heading>{monthLabel(startMonth)}</Heading>
                  <IconButton icon={ChevronRight} label={tr.installments.startMonth} onPress={() => setStartMonth(addMonthsToKey(startMonth, 1))} />
                </Spread>
              </>
            )}
            {reschedule ? (
              <Body muted style={{ marginBottom: spacing.md }}>{tr.installments.rescheduleNote}</Body>
            ) : null}

            <Select
              label={tr.tx.source}
              placeholder={tr.tx.sourcePlaceholder}
              options={sourceOptions.map((s) => ({ value: s.id, label: s.name, icon: <PaymentSourceLogo name={s.name} type={s.type} logoRef={s.logoRef} size={SOURCE_MARK} /> }))}
              value={sourceId}
              onChange={setSourceId}
              onCreate={{ label: tr.installments.addCard, run: () => router.push("/payment-sources") }}
            />
            {kind === "card_installment" && !cardSourceValid ? (
              <Body muted style={{ marginBottom: spacing.sm }}>{tr.tx.cardCycleMissing}</Body>
            ) : null}
            {kind === "loan" ? (
              <>
                <Field
                  label={tr.installments.dueDayField}
                  value={dueDayStr}
                  onChangeText={setDueDayStr}
                  keyboardType="number-pad"
                  placeholder={String(selectedSource?.dueDay ?? 1)}
                />
                <Body muted style={{ marginBottom: spacing.md }}>{tr.installments.dueDayHint}</Body>
              </>
            ) : null}
            <PersonAssignment people={persons} value={personId} onChange={setPersonChoice} />
            <Select
              label={tr.tx.category}
              placeholder={tr.tx.categoryPlaceholder}
              options={categories.filter((c) => c.kind === "expense").map((c) => ({ value: c.id, label: c.name, icon: categoryIconComponent(c) }))}
              value={categoryId}
              onChange={setCategoryId}
              onCreate={{ label: tr.tx.addCategory, run: () => router.push("/columns-editor") }}
            />

            {closed ? <Body muted style={{ marginBottom: spacing.sm }}>{tr.installments.closedEditLocked}</Body> : null}
            <Button label={tr.common.save} onPress={() => void save()} disabled={!valid} loading={busy} />
            {isEdit ? (
              <View style={{ marginTop: spacing.md }}>
                <Button icon={Trash} label={tr.installments.delete} variant="danger" onPress={confirmDelete} />
              </View>
            ) : null}
          </Card>
        )}
      />
      {existing?.kind === "loan" ? <LoanActions plan={existing} persons={persons} rateTry={rateTry} /> : null}
      {existing ? <PlanRefunds planId={existing.id} /> : null}
    </Screen>
  );
}
