/** Installments & loans, viewed one MONTH at a time: step through months and
 *  filter by card to see exactly which installments fall due that month. A plan
 *  that has no payment in the selected month (finished, or not yet started) is
 *  hidden — each month shows only its own live installments (spec §3.2, §2.8). */

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { PaymentSourceLogo } from "../../../ui/logo";
import { useContentWidth } from "../../../ui/viewport";
import { useLocalSearchParams, useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CreditCard from "lucide-react-native/icons/credit-card";
import Landmark from "lucide-react-native/icons/landmark";
import Plus from "lucide-react-native/icons/plus";
import Undo2 from "lucide-react-native/icons/undo-2";
import { installmentDisplayTitle, planProgress, type GeneratedInstallment } from "../../../domain/installments";
import { monthKeyOf, todayISO, type MonthKey } from "../../../domain/dates";
import { formatMinorCompact } from "../../../domain/money";
import { monthLabel, tr } from "../../../i18n/tr";
import {
  useCardSettlement,
  useCategoriesState,
  usePersonsState,
  usePlansState,
  useSourcesState,
  useAllTransactionsState,
} from "../../../data/hooks";
import { combineLiveStates } from "../../../data/live-state";
import { Amount, Badge, Body, Button, Card, CardList, CardListSkeleton, DataGateScreen, DataStateNotice, EmptyState, Heading, MonthStepper, Screen, SectionHeader, SegmentBar, Segmented, Select } from "../../../ui/components";
import { Bars, ChartFrame, Donut, distributionDonutData, useSeriesColors } from "../../../ui/charts";
import { font, radius, segmentedMaxWidth, spacing, type, useTheme } from "../../../ui/theme";
import { WorkspaceSplit } from "../../../ui/workspace-layout";
import { shouldUseCompactInstallmentCard, shouldUseWideWorkspace } from "../../../ui/responsive";

/** The Select's own icon column, so a source mark fits it exactly. */
const SOURCE_MARK = 22;

/**
 * The viewed month's instalments, taken apart by the category each plan was
 * entered under.
 *
 * It is the header total and nothing else — same month, same card filter, the
 * owner's own plans — so the chart can never disagree with the figure above
 * it. The card, the two views and the ring are Analiz's, because a pie and a
 * bar chart that look different on two screens read as two different kinds of
 * fact.
 */
function InstallmentCategoryChart({
  items,
  categories,
  month,
  compact,
}: {
  items: { categoryId: string | null; amountMinor: number }[];
  categories: { id: string; name: string }[];
  month: MonthKey;
  compact: boolean;
}) {
  const colors = useSeriesColors();
  const [chartType, setChartType] = useState<"pie" | "bars">("pie");
  const byCategory = new Map<string, number>();
  let uncategorizedMinor = 0;
  let totalMinor = 0;
  for (const item of items) {
    totalMinor += item.amountMinor;
    if (item.categoryId) byCategory.set(item.categoryId, (byCategory.get(item.categoryId) ?? 0) + item.amountMinor);
    else uncategorizedMinor += item.amountMinor;
  }
  if (totalMinor <= 0) return null;
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const donut = distributionDonutData(
    { expenseByCategory: byCategory, uncategorizedExpenseMinor: uncategorizedMinor, expenseTotalMinor: totalMinor, transferTotalMinor: 0, incomeTotalMinor: 0, workbookRemainderMinor: 0 },
    colors,
    (id) => names.get(id) ?? tr.common.none,
  );
  return (
    <Card testID="installments-category-chart">
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.md, marginBottom: spacing.md }}>
        <Heading style={{ marginTop: 0, marginBottom: 0, flexShrink: 1 }}>{tr.installments.byCategoryTitle(monthLabel(month))}</Heading>
        <View style={{ flexGrow: 1, flexBasis: segmentedMaxWidth(2), maxWidth: segmentedMaxWidth(2), minWidth: 160 }}>
          <Segmented
            noMargin
            options={[
              { value: "pie", label: tr.analysis.chartPie },
              { value: "bars", label: tr.analysis.chartBars },
            ]}
            value={chartType}
            onChange={setChartType}
          />
        </View>
      </View>
      {chartType === "pie" ? (
        <Donut slices={donut.slices} supplementalSlices={donut.supplementalSlices} totalMinor={donut.totalMinor} size={compact ? 168 : 220} />
      ) : (
        <ChartFrame>
          {(chartWidth) => (
            <Bars
              width={chartWidth}
              groups={donut.slices.map((slice) => ({ label: slice.label, values: [slice.valueMinor] }))}
              series={[{ label: monthLabel(month), color: colors[0] }]}
            />
          )}
        </ChartFrame>
      )}
    </Card>
  );
}

/**
 * What is true of a plan beyond its figures, beside its count.
 *
 * "x/y ödendi" counts a card instalment paid once its statement is due, which
 * is the assumption a statement without a payment record keeps. A recorded
 * payment is a fact, so the viewed month's statement says which it was.
 */
function PlanBadges({
  watchedBy,
  closedOn,
  refundedMinor,
  statementId,
  byStatement,
}: {
  watchedBy: string | undefined;
  closedOn: string | null;
  refundedMinor: number;
  statementId: string | undefined;
  byStatement: ReturnType<typeof useCardSettlement>["byStatement"];
}) {
  const statementState = statementId ? byStatement.get(statementId)?.state : undefined;
  return (
    <>
      {watchedBy ? <Badge text={`${tr.installments.watchOnly}: ${watchedBy}`} tone="warning" /> : null}
      {closedOn ? <Badge text={tr.installments.closedBadge} tone="success" /> : null}
      {refundedMinor > 0 ? <Badge text={tr.installments.refundBadge(formatMinorCompact(refundedMinor))} tone="success" /> : null}
      {statementState ? <Badge text={tr.installments.statementState[statementState]} tone={statementState === "full" ? "success" : "warning"} /> : null}
    </>
  );
}

export default function InstallmentsScreen() {
  const plansState = usePlansState();
  const sourcesState = useSourcesState();
  const personsState = usePersonsState();
  const transactionsState = useAllTransactionsState();
  const categoriesState = useCategoriesState();
  const plans = plansState.data;
  const sources = sourcesState.data;
  const persons = personsState.data;
  const allTx = transactionsState.data;
  const router = useRouter();
  const { palette } = useTheme();
  const contentWidth = useContentWidth();
  const compact = shouldUseCompactInstallmentCard(contentWidth);
  // Beside the list on a desktop, under the month's total; under everything on
  // a phone, where the list is what the screen is opened for.
  const wide = shouldUseWideWorkspace(contentWidth);
  const [requestedMonth, setRequestedMonth] = useState(monthKeyOf(todayISO()));
  /**
   * Arriving with a card already chosen.
   *
   * "Yaklaşan Ödemeler" lists a card statement as one row with one amount, and
   * the question it raises is which installments make it up. That question is
   * this screen filtered to that card, so the row hands the card over rather
   * than dropping the reader into an unfiltered list to find it again. A seed,
   * not a binding: the picker is still the thing that decides, and clearing it
   * here does not send the reader back through the row.
   */
  const { card } = useLocalSearchParams<{ card?: string }>();
  const [cardFilter, setCardFilter] = useState<string | null>(card ?? null);
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([plansState, sourcesState, personsState, transactionsState, categoriesState]);
  const { byStatement } = useCardSettlement();

  const selfIds = new Set(persons.filter((p) => p.isSelf).map((p) => p.id));
  const sourceName = new Map(sources.map((s) => [s.id, s.name]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const personName = new Map(persons.map((p) => [p.id, p.name]));
  const noteByPlan = new Map<string, string>();
  for (const tx of allTx) {
    if (tx.installmentPlanId && tx.note && !noteByPlan.has(tx.installmentPlanId)) noteByPlan.set(tx.installmentPlanId, tx.note);
  }

  // The stepper walks the instalment months and nothing else: a plan ending in
  // October 2027 used to offer 2035, and every one of those months was empty.
  //
  // What made the bounds wrong on their own was the STARTING point, not the
  // bounds. The screen opens on this month, and a workspace whose last
  // instalment fell in June opens outside its own range — so Back worked,
  // Forward was dead from the first press, and walking away from today was a
  // one-way trip. The view is clamped INTO the range instead of the range
  // being widened to reach today, because a month with no instalment in it has
  // nothing to show whichever direction you arrive from.
  const planMonths = allTx
    .filter((t) => t.installmentPlanId != null)
    .map((t) => monthKeyOf(t.effectiveDate))
    .sort();
  const currentMonth = monthKeyOf(todayISO());
  const firstPlanMonth = planMonths[0] ?? currentMonth;
  const lastPlanMonth = planMonths.at(-1) ?? currentMonth;
  // Derived, not stored: clamping through state would need an effect, and an
  // effect that corrects state on the render after the data arrives is the
  // one-frame flash of an out-of-range month.
  const viewMonth = requestedMonth < firstPlanMonth
    ? firstPlanMonth
    : requestedMonth > lastPlanMonth ? lastPlanMonth : requestedMonth;

  const itemsByPlan = new Map<string, GeneratedInstallment[]>();
  // Refunds are the plan's rows without an instalment number: credits the
  // statement shows beside the instalments, netted out of what a month costs.
  // A closed loan's payoff is unnumbered too: it costs its month like an
  // instalment, and it refunds nothing.
  const refundedByPlan = new Map<string, number>();
  const refundInMonth = new Map<string, number>();
  /** The statement each card plan's instalment in the viewed month is billed on. */
  const statementInMonth = new Map<string, string>();
  for (const t of allTx) {
    if (!t.installmentPlanId) continue;
    if (t.installmentNo == null) {
      if (t.amountTryMinor < 0) refundedByPlan.set(t.installmentPlanId, (refundedByPlan.get(t.installmentPlanId) ?? 0) - t.amountTryMinor);
      if (monthKeyOf(t.effectiveDate) === viewMonth) {
        refundInMonth.set(t.installmentPlanId, (refundInMonth.get(t.installmentPlanId) ?? 0) + t.amountTryMinor);
      }
      continue;
    }
    if (t.cardStatementId && monthKeyOf(t.effectiveDate) === viewMonth) statementInMonth.set(t.installmentPlanId, t.cardStatementId);
    const list = itemsByPlan.get(t.installmentPlanId) ?? [];
    list.push({
      installmentNo: t.installmentNo,
      month: monthKeyOf(t.effectiveDate),
      amountMinor: t.amountTryMinor,
      effectiveDate: t.effectiveDate,
      status: t.status,
    });
    itemsByPlan.set(t.installmentPlanId, list);
  }
  for (const list of itemsByPlan.values()) list.sort((a, b) => a.installmentNo - b.installmentNo);

  // The one installment (if any) a plan pays in the viewed month.
  const itemInMonth = (planId: string) => itemsByPlan.get(planId)?.find((it) => it.month === viewMonth);
  /** Whether the viewed month holds anything of this plan's: an instalment or a refund. */
  const inMonth = (planId: string) => itemInMonth(planId) != null || refundInMonth.has(planId);
  /** What the plan costs in the viewed month, its refunds netted out. */
  const netInMonth = (planId: string) => (itemInMonth(planId)?.amountMinor ?? 0) + (refundInMonth.get(planId) ?? 0);
  /** How far into the plan the viewed month is, or the paid count outside it. */
  const reachedNo = (planId: string, paidSoFar: number) => itemInMonth(planId)?.installmentNo ?? paidSoFar;
  /**
   * Where the plan stands TODAY, whichever month is being viewed.
   *
   * The line above the bar is the one fixed fact on this card: in September it
   * says September, and it says it while you walk back through June to see what
   * that month cost. The bar and the count beside it are the moving parts.
   */
  const asOfToday = (planId: string, paidSoFar: number, total: number) => {
    const today = itemsByPlan.get(planId)?.find((item) => item.month === currentMonth);
    return today
      ? tr.installments.thisMonthInstallment(monthLabel(currentMonth), today.installmentNo, total)
      : tr.installments.progress(paidSoFar, total);
  };

  // Cards that actually carry an installment this month — the filter never
  // offers a card with nothing to show. (Plain derivation; the React Compiler
  // memoizes it — a manual useMemo over the itemInMonth closure would bail out.)
  const cardIdsThisMonth = new Set<string>();
  for (const p of plans) {
    if (p.paymentSourceId && itemInMonth(p.id)) cardIdsThisMonth.add(p.paymentSourceId);
  }
  const cardOptions = [
    { value: "" as string, label: tr.installments.allCards },
    ...[...cardIdsThisMonth].map((id) => ({
      value: id,
      label: sourceName.get(id) ?? tr.installments.noSource,
      icon: sourceById.get(id)
        ? <PaymentSourceLogo name={sourceById.get(id)!.name} type={sourceById.get(id)!.type} logoRef={sourceById.get(id)!.logoRef} size={SOURCE_MARK} />
        : undefined,
    })),
  ];

  const matchesCard = (p: (typeof plans)[number]) => cardFilter == null || p.paymentSourceId === cardFilter;
  const activeThisMonth = (p: (typeof plans)[number]) => inMonth(p.id) && matchesCard(p);
  const selfPlans = plans.filter((p) => selfIds.has(p.personId) && activeThisMonth(p));
  const otherPlans = plans.filter((p) => !selfIds.has(p.personId) && activeThisMonth(p));

  // Header total = what this month's shown installments actually cost.
  const monthObligationMinor = selfPlans.reduce((sum, p) => sum + netInMonth(p.id), 0);
  const watchedObligationMinor = otherPlans.reduce((sum, p) => sum + netInMonth(p.id), 0);

  const renderPlan = (plan: (typeof plans)[number], watchedBy?: string) => {
    const items = itemsByPlan.get(plan.id) ?? [];
    const progress = planProgress(items);
    const finished = progress.remaining === 0;
    const refunded = refundedByPlan.get(plan.id) ?? 0;
    // The plan's own count, not the number of rows it happens to have: an
    // imported plan can be missing the months its workbook kept in another
    // column, and "3/21" of a 24-month loan is a figure nobody recognises.
    const total = Math.max(plan.installmentCount, progress.total);
    // The bar walks the MONTH being viewed, which is the question this screen
    // answers — where am I in this plan in September? The static paid-so-far
    // count stays on the right of it, where it reads as the running tally.
    const reached = reachedNo(plan.id, progress.paid);
    const Icon = plan.kind === "loan" ? Landmark : CreditCard;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${installmentDisplayTitle(plan.title, noteByPlan.get(plan.id), tr.installments.plan)}. ${inMonth(plan.id) ? formatMinorCompact(netInMonth(plan.id)) : ""}. ${tr.installments.progress(progress.paid, total)}`}
        onPress={() => router.push({ pathname: "/installment-new", params: { id: plan.id } })}
        style={({ pressed }) => [pressed && { opacity: 0.6 }]}
      >
        <View style={{ paddingVertical: spacing.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <View
              accessible={false}
              style={{
                width: 38,
                height: 38,
                flexShrink: 0,
                borderRadius: radius.md,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: plan.kind === "loan" ? palette.secondarySoft : palette.primarySoft,
              }}
            >
              <Icon accessible={false} size={18} color={plan.kind === "loan" ? palette.secondaryText : palette.primaryText} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Body style={{ fontFamily: font.medium }}>
              {installmentDisplayTitle(plan.title, noteByPlan.get(plan.id), tr.installments.plan)}
              </Body>
              <Body muted style={{ marginTop: 2 }}>{sourceName.get(plan.paymentSourceId ?? "") ?? tr.installments.noSource}</Body>
            </View>
            <ChevronRight accessible={false} size={18} color={palette.textSecondary} />
          </View>

          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.md, marginTop: spacing.md }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.small, { color: palette.textSecondary }]}>
                {asOfToday(plan.id, progress.paid, total)}
              </Text>
              {inMonth(plan.id) ? <Amount minor={netInMonth(plan.id)} colorized={false} style={{ fontSize: compact ? type.moneyInput.fontSize : type.heading.fontSize, textAlign: "left", marginTop: 2 }} /> : null}
            </View>
            <View style={{ alignItems: "flex-end", gap: spacing.xs }}>
              {/* Moves with the bar under it: both answer "where is this plan in
                  the month I am looking at". */}
              <Text style={[type.label, { color: finished ? palette.positiveText : palette.textStrong }]}>{reached}/{total}</Text>
              <PlanBadges
                watchedBy={watchedBy}
                closedOn={plan.closedOn}
                refundedMinor={refunded}
                statementId={statementInMonth.get(plan.id)}
                byStatement={byStatement}
              />
            </View>
          </View>

          {/* One segment per instalment, the same shape the monthly limit uses:
              a plan is a countable number of steps, and a smooth bar hid which
              one you are on. */}
          <View style={{ marginTop: spacing.sm }}>
            <SegmentBar
              ratio={reached / Math.max(total, 1)}
              segments={total}
              tone={finished ? palette.success : palette.primary}
              height={8}
            />
          </View>
        </View>
      </Pressable>
    );
  };

  const nothingThisMonth = selfPlans.length === 0 && otherPlans.length === 0;
  const categoryChart = (
    <InstallmentCategoryChart
      items={selfPlans.map((plan) => ({ categoryId: plan.categoryId, amountMinor: netInMonth(plan.id) }))}
      categories={categoriesState.data}
      month={viewMonth}
      compact={compact}
    />
  );

  if (!dataReady) return <DataGateScreen status={dataStatus} retry={retryData} skeleton={<CardListSkeleton />} />;

  return (
    <Screen width="workspace">
      <DataStateNotice status={dataStatus} retry={retryData} />
      <WorkspaceSplit
        testID="installments-workspace"
        primary={(
          <View>
            <MonthStepper value={viewMonth} onChange={setRequestedMonth} min={firstPlanMonth} max={lastPlanMonth} />
            <Card>
              <Body muted>{tr.installments.thisMonthTotal} · {monthLabel(viewMonth)}</Body>
              {/* This screen's ONE hero figure, so it counts — the same rule
                  Durum and Yatırımlar follow. Stepping to another month is a
                  real change, so it counts from the figure just left rather
                  than from zero, which is what makes the step read as a step.
                  The watched-balance card below deliberately does NOT count:
                  two figures moving at once is noise, not emphasis. */}
              <Amount minor={monthObligationMinor} large count colorized={false} />
              <View style={{ marginTop: spacing.md }}>
                <Select
                  label={tr.installments.cardFilter}
                  options={cardOptions}
                  value={cardFilter ?? ""}
                  onChange={(value) => setCardFilter(value === "" ? null : value)}
                  onCreate={{ label: tr.installments.addCard, run: () => router.push("/payment-sources") }}
                />
              </View>
              <Button icon={Plus} label={tr.installments.newPlan} onPress={() => router.push("/installment-new")} />
              {/* A refund belongs to a purchase, so the button opens a list of
                  purchases to choose from rather than an empty form. */}
              <View style={{ marginTop: spacing.sm }}>
                <Button icon={Undo2} label={tr.installments.refundAdd} variant="secondary" onPress={() => router.push("/installment-refund")} />
              </View>
            </Card>
            {wide ? categoryChart : null}
          </View>
        )}
        secondary={(
          <View>
            {plans.length === 0 ? (
              <EmptyState icon={CreditCard} title={tr.installments.emptyTitle} hint={tr.installments.emptyHint} />
            ) : nothingThisMonth ? (
              <EmptyState icon={CreditCard} title={tr.installments.noneThisMonth} hint={tr.installments.noneThisMonthHint} />
            ) : null}

            <CardList items={selfPlans} keyExtractor={(p) => p.id} renderItem={(p) => renderPlan(p)} />

            {otherPlans.length > 0 ? (
              <>
                <SectionHeader>{tr.installments.othersSection}</SectionHeader>
                <Card>
                  <Body muted>{tr.installments.watchedMonthTotal} · {monthLabel(viewMonth)}</Body>
                  <Amount minor={watchedObligationMinor} large colorized={false} />
                  <Body muted style={{ marginTop: spacing.xs }}>{tr.installments.watchedBalanceHint}</Body>
                </Card>
                <CardList items={otherPlans} keyExtractor={(p) => p.id} renderItem={(p) => renderPlan(p, personName.get(p.personId) ?? "")} />
              </>
            ) : null}
          </View>
        )}
      />
      {wide ? null : categoryChart}
    </Screen>
  );
}
