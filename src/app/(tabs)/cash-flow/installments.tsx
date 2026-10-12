/** Installments and loans, one month at a time, filterable by card; a plan with no payment that month is hidden (spec §3.1, §2.11). */

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
import { installmentDisplayTitle, planProgress, planRowsByMonth } from "../../../domain/installments";
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

/** The viewed month's instalments by category; same month and filter as the header total, in Analiz's chart language so the two screens read alike. */
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

/** Facts beside a plan's count. "x/y ödendi" assumes a card instalment is paid once its statement is due; a recorded payment is a fact, so the statement state says which. */
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
  /** A card handed in from Yaklaşan Ödemeler seeds the filter; the picker still decides. */
  const { card } = useLocalSearchParams<{ card?: string }>();
  const [cardFilter, setCardFilter] = useState<string | null>(card ?? null);
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([plansState, sourcesState, personsState, transactionsState, categoriesState]);
  const { byStatement } = useCardSettlement();

  const selfIds = new Set(persons.filter((p) => p.isSelf).map((p) => p.id));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const personName = new Map(persons.map((p) => [p.id, p.name]));
  const noteByPlan = new Map<string, string>();
  for (const tx of allTx) {
    if (tx.installmentPlanId && tx.note && !noteByPlan.has(tx.installmentPlanId)) noteByPlan.set(tx.installmentPlanId, tx.note);
  }

  // The stepper walks instalment months only.
  // The view is clamped into that range, so opening outside it cannot dead-end Forward.
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

  const { itemsByPlan, refundedByPlan, refundInMonth, statementInMonth } = planRowsByMonth(allTx, viewMonth);

  // The one installment (if any) a plan pays in the viewed month.
  const itemInMonth = (planId: string) => itemsByPlan.get(planId)?.find((it) => it.month === viewMonth);
  /** Whether the viewed month holds anything of this plan's: an instalment or a refund. */
  const inMonth = (planId: string) => itemInMonth(planId) != null || refundInMonth.has(planId);
  /** What the plan costs in the viewed month, its refunds netted out. */
  const netInMonth = (planId: string) => (itemInMonth(planId)?.amountMinor ?? 0) + (refundInMonth.get(planId) ?? 0);
  /** How far into the plan the viewed month is, or the paid count outside it. */
  const reachedNo = (planId: string, paidSoFar: number) => itemInMonth(planId)?.installmentNo ?? paidSoFar;
  /** Where the plan stands today, whichever month is viewed: the fixed line above the bar. */
  const asOfToday = (planId: string, paidSoFar: number, total: number) => {
    const today = itemsByPlan.get(planId)?.find((item) => item.month === currentMonth);
    return today
      ? tr.installments.thisMonthInstallment(monthLabel(currentMonth), today.installmentNo, total)
      : tr.installments.progress(paidSoFar, total);
  };

  // Cards with an instalment this month. No useMemo: the React Compiler memoizes it, and a manual memo over the closure would bail out.
  const cardIdsThisMonth = new Set<string>();
  for (const p of plans) {
    if (p.paymentSourceId && itemInMonth(p.id)) cardIdsThisMonth.add(p.paymentSourceId);
  }
  const cardOptions = [
    { value: "" as string, label: tr.installments.allCards },
    ...[...cardIdsThisMonth].map((id) => {
      const source = sourceById.get(id);
      return {
        value: id,
        label: source?.name ?? tr.installments.noSource,
        icon: source
          ? <PaymentSourceLogo name={source.name} type={source.type} logoRef={source.logoRef} size={SOURCE_MARK} />
          : undefined,
      };
    }),
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
    // The plan's own count: an imported plan can be missing rows.
    const total = Math.max(plan.installmentCount, progress.total);
    // The bar walks the viewed month; the paid tally sits to its right.
    const reached = reachedNo(plan.id, progress.paid);
    const Icon = plan.kind === "loan" ? Landmark : CreditCard;
    const title = installmentDisplayTitle(plan.title, noteByPlan.get(plan.id), tr.installments.plan);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${inMonth(plan.id) ? formatMinorCompact(netInMonth(plan.id)) : ""}. ${tr.installments.progress(progress.paid, total)}`}
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
                {title}
              </Body>
              <Body muted style={{ marginTop: 2 }}>{sourceById.get(plan.paymentSourceId ?? "")?.name ?? tr.installments.noSource}</Body>
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

          {/* One segment per instalment, like the monthly limit. */}
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
              {/* The screen's one counting hero, from the previous figure; the watched-balance card deliberately does not count. */}
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
