/** Dashboard: current balance, action-needed payments, upcoming timeline and
 * one concise monthly insight. Detailed exploration belongs to Analysis. */

import React from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { ArrowDownLeft, ArrowUpRight, CalendarClock, ChartNoAxesColumn, ChevronDown, ChevronRight, ChevronUp, History, Plus, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react-native";
import { buildDashboardModel } from "../../domain/dashboard";
import { daysBetweenISO, firstDayOf, lastDayOf, monthKeyOf, todayISO, yearOf, type ISODate } from "../../domain/dates";
import { formatMinor } from "../../domain/money";
import { buildUpcomingTimeline } from "../../domain/upcoming";
import { clockOrDateTimeLabel, dateLabel, dateTimeLabel, monthName, tr } from "../../i18n/tr";
import { useSession } from "../../auth/session";
import {
  useCategoriesState,
  useCreditCardStatementsState,
  useLedgerState,
  usePendingExpectedState,
  usePersonsState,
  useRecurringIncomesState,
  useSourcesState,
  useSubscriptionsState,
  useUserId,
} from "../../data/hooks";
import { combineLiveQueryStatus } from "../../data/live-state";
import { confirmExpected, FxRateUnavailableError, revertExpected } from "../../data/repo";
import { marketSellRateTry, MARKET_SYMBOLS, useMarkets } from "../../services/markets";
import { convertToTryMinor } from "../../domain/fx";
import { lookupRate, useFxRates } from "../../services/fx-fetch";
import { appAlert } from "../../ui/dialog";
import { scheduleSync } from "../../sync/engine";
import { Amount, Badge, Body, Button, Card, DataStateNotice, Divider, HeroCard, ListRow, MetricStrip, Row, STATUS_W, Screen, SectionHeader, Segmented, Spread } from "../../ui/components";
import { Bars, Donut, distributionDonutData, useSeriesColors } from "../../ui/charts";
import { CalendarSheet } from "../../ui/calendar";
import { BrandMark } from "../../ui/brand";
import { shouldUseSideNavigation } from "../../ui/responsive";
import { FirstRunTour } from "../../ui/tour";
import { useUndo } from "../../ui/undo";
import { errorNotice } from "../../ui/haptics";
import { shouldUseCompactChart } from "../../ui/responsive";
import { font, heroSurface, radius, spacing, type, useTheme } from "../../ui/theme";
import { devError } from "../../services/logger";
import { useOperationGuard } from "../../ui/operation-guard";

function MarketInstrumentArt({ code, size = 44 }: { code: string; size?: number }) {
  const { palette } = useTheme();
  const currency = code === "USDTRY" ? "$" : code === "EURTRY" ? "€" : null;
  const frame = {
    width: size,
    height: size,
    flexShrink: 0,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  };
  if (currency) {
    return (
      <View accessible={false} style={frame}>
        <View
          style={{
            width: 30,
            height: 22,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 5,
            borderWidth: 1,
            borderColor: palette.primary + "90",
            backgroundColor: palette.primarySoft,
          }}
        >
          <View style={{ position: "absolute", left: 3, top: 3, bottom: 3, width: 3, borderRadius: 2, backgroundColor: palette.primary + "90" }} />
          <View style={{ position: "absolute", right: 3, top: 3, bottom: 3, width: 3, borderRadius: 2, backgroundColor: palette.primary + "90" }} />
          <Text style={[type.heading, { color: palette.primaryText, fontFamily: font.bold, fontSize: 15 }]}>{currency}</Text>
        </View>
      </View>
    );
  }

  if (code === "ALTIN") {
    return (
      <View accessible={false} style={frame}>
        <View
          style={{
            width: 30,
            height: 23,
            borderRadius: 5,
            borderWidth: 1,
            borderColor: palette.tertiary + "90",
            backgroundColor: palette.tertiarySoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View style={{ position: "absolute", left: 4, right: 4, top: 4, height: 3, borderRadius: 2, backgroundColor: palette.tertiary + "A0" }} />
          <Text style={[type.small, { color: palette.tertiaryText, fontFamily: font.bold, fontSize: 9, marginTop: 5 }]}>Au</Text>
        </View>
      </View>
    );
  }

  const coinMark = code === "CEYREK_YENI" ? "¼" : code === "TEK_YENI" ? "1" : "C";
  return (
    <View accessible={false} style={frame}>
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1.5,
          borderColor: palette.tertiary,
          backgroundColor: palette.tertiarySoft,
        }}
      >
        <View style={{ position: "absolute", inset: 3, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.tertiary + "80" }} />
        <Text style={[type.small, { color: palette.tertiaryText, fontFamily: font.bold, fontSize: 11 }]}>{coinMark}</Text>
      </View>
    </View>
  );
}

function MarketsCard({ fill = false, desktopColumns = 2 }: { fill?: boolean; desktopColumns?: 2 | 3 }) {
  const { palette } = useTheme();
  const { width } = useWindowDimensions();
  const userId = useUserId();
  const { prices, status, lastEventAt } = useMarkets();
  useFxRates();
  if (status === "idle") return null;

  const priceText = (v: number) =>
    new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  // Display hierarchy: live/last-known quotes → dated FX reference rates →
  // an explanatory fallback. The card never renders empty values or "—".
  const quoted = MARKET_SYMBOLS.filter(({ code }) => prices[code] != null);
  const referenceRows = quoted.length > 0
    ? []
    : ([["USD", tr.markets.usd], ["EUR", tr.markets.eur]] as const).flatMap(([currency, label]) => {
        const rate = lookupRate(userId, currency);
        return rate ? [{ label, rate }] : [];
      });
  const statusLabel = status === "live"
    ? tr.markets.live
    : quoted.length > 0 && lastEventAt
      ? tr.markets.updatedAt(clockOrDateTimeLabel(lastEventAt))
      : status === "connecting"
        ? tr.markets.connecting
        : tr.markets.offline;
  const marketColumns = width >= 960 ? desktopColumns : width >= 360 ? 2 : 1;

  return (
    <>
      <SectionHeader>{tr.markets.title}</SectionHeader>
      <Card style={fill ? { flex: 1 } : undefined}>
        <Row
          gap={spacing.xs}
          style={{ justifyContent: "flex-end", marginBottom: spacing.xs }}
          accessible
          role="group"
          accessibilityLiveRegion="polite"
          accessibilityLabel={statusLabel}
        >
          {/* The dot claims liveness only once real quotes are flowing. */}
          <View accessible={false} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: status === "live" ? palette.success : palette.textSecondary }} />
          <Text style={[type.small, { color: palette.textSecondary, textAlign: "right", flexShrink: 1 }]}>{statusLabel}</Text>
        </Row>
        {quoted.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {quoted.map(({ code, label }) => {
              const p = prices[code]!;
              const direction = p.direction === "up"
                ? tr.markets.rising
                : p.direction === "down"
                  ? tr.markets.falling
                  : tr.markets.unchanged;
              return (
                <View
                  key={code}
                  accessible
                  role="group"
                  accessibilityLabel={tr.markets.quote(label, priceText(p.buyTry), `${priceText(p.sellTry)}\u00A0₺`, direction)}
                  style={{
                    flexGrow: 1,
                    flexBasis: marketColumns === 3 ? "29%" : marketColumns === 2 ? "46%" : "100%",
                    minWidth: 0,
                    minHeight: marketColumns === 3 ? 102 : 112,
                    justifyContent: "space-between",
                    padding: spacing.md,
                    borderRadius: radius.md,
                    backgroundColor: palette.surfaceAlt,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: palette.border + "70",
                  }}
                >
                  <Row gap={spacing.xs} style={{ alignItems: "center" }}>
                    <View style={{ width: width < 430 ? 40 : 44, height: width < 430 ? 40 : 44, flexShrink: 0 }}>
                      <MarketInstrumentArt code={code} size={width < 430 ? 40 : 44} />
                      {p.direction === "up" ? (
                        <View style={{ position: "absolute", right: -2, top: -2, borderRadius: 8, padding: 2, backgroundColor: palette.surface }}>
                          <TrendingUp accessible={false} size={12} color={palette.positive} />
                        </View>
                      ) : p.direction === "down" ? (
                        <View style={{ position: "absolute", right: -2, top: -2, borderRadius: 8, padding: 2, backgroundColor: palette.surface }}>
                          <TrendingDown accessible={false} size={12} color={palette.negative} />
                        </View>
                      ) : null}
                    </View>
                    <Body
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontFamily: font.semibold,
                        fontSize: width < 430 ? 13 : undefined,
                        lineHeight: width < 430 ? 16 : undefined,
                        textAlignVertical: "center",
                      }}
                    >
                      {label}
                    </Body>
                  </Row>
                  <View style={{ marginTop: spacing.sm, gap: 3 }}>
                    <Spread>
                      <Text style={[type.small, { color: palette.textSecondary }]}>{tr.markets.buy}</Text>
                      <Text style={[type.amountSm, { color: palette.textSecondary, textAlign: "right" }]}>{priceText(p.buyTry)}</Text>
                    </Spread>
                    <Spread>
                      <Text style={[type.small, { color: palette.textSecondary }]}>{tr.markets.sell}</Text>
                      <Text style={[type.amount, { color: palette.text, textAlign: "right" }]}>
                        {`${priceText(p.sellTry)}\u00A0₺`}
                      </Text>
                    </Spread>
                  </View>
                </View>
              );
            })}
          </View>
        ) : referenceRows.length > 0 ? (
          <>
            {referenceRows.map(({ label, rate }) => (
              <Spread
                key={label}
                accessible
                role="group"
                accessibilityLabel={`${label}. ${tr.markets.referenceRate(dateLabel(rate.rate.rateDate))}. ${priceText(rate.rate.rateTry)} ₺`}
                style={{ paddingVertical: spacing.sm - 2 }}
              >
                <View style={{ flexShrink: 1 }}>
                  <Body>{label}</Body>
                  <Text style={[type.small, { color: palette.textSecondary }]}>{tr.markets.referenceRate(dateLabel(rate.rate.rateDate))}</Text>
                </View>
                <Text style={[type.amount, { color: palette.text }]}>{`${priceText(rate.rate.rateTry)} ₺`}</Text>
              </Spread>
            ))}
            <Body muted style={{ marginTop: spacing.sm, fontSize: 12 }}>{tr.markets.offlineHint}</Body>
          </>
        ) : (
          <Body muted>{tr.markets.noData}</Body>
        )}
      </Card>
    </>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return tr.dashboard.greetingNight;
  if (hour < 12) return tr.dashboard.greetingMorning;
  if (hour < 18) return tr.dashboard.greetingDay;
  return tr.dashboard.greetingEvening;
}

export default function DashboardScreen() {
  const userId = useUserId();
  const previousLoginAt = useSession((state) => state.previousLoginAt);
  const today = todayISO();
  const year = yearOf(today);
  const month = monthKeyOf(today);
  const ledgerState = useLedgerState(year);
  const categoriesState = useCategoriesState();
  const personsState = usePersonsState();
  const expectedState = usePendingExpectedState();
  const subscriptionsState = useSubscriptionsState();
  const incomesState = useRecurringIncomesState();
  const sourcesState = useSourcesState();
  const cardStatementsState = useCreditCardStatementsState();
  const bundle = ledgerState.data;
  const categories = categoriesState.data;
  const persons = personsState.data;
  const expected = expectedState.data;
  const subscriptions = subscriptionsState.data;
  const incomes = incomesState.data;
  const sources = sourcesState.data;
  const cardStatements = cardStatementsState.data;
  const liveStates = [
    ledgerState,
    categoriesState,
    personsState,
    expectedState,
    subscriptionsState,
    incomesState,
    sourcesState,
    cardStatementsState,
  ];
  const dataStatus = combineLiveQueryStatus(liveStates);
  const retryData = () => {
    ledgerState.retry();
    categoriesState.retry();
    personsState.retry();
    expectedState.retry();
    subscriptionsState.retry();
    incomesState.retry();
    sourcesState.retry();
    cardStatementsState.retry();
  };
  const router = useRouter();
  const undo = useUndo();
  const { palette, scheme } = useTheme();
  const hero = heroSurface(palette, scheme);
  const heroInk = hero.ink;
  const { width } = useWindowDimensions();
  const chartColors = useSeriesColors();
  // Re-render when FX rates land so foreign-currency projections settle.
  useFxRates();

  const txLike = bundle?.txLike ?? [];
  const selfPersonId = persons.find((p) => p.isSelf)?.id;
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const subscriptionById = new Map(subscriptions.map((subscription) => [subscription.id, subscription]));
  const incomeById = new Map(incomes.map((income) => [income.id, income]));

  const catName = (id: string | null) => (id ? categoryById.get(id)?.name : undefined);
  const nameOf = (e: (typeof expected)[number]) =>
    subscriptionById.get(e.refId)?.name ?? incomeById.get(e.refId)?.name ?? tr.common.paymentFallback;
  // Missing FX stays missing; a foreign amount is never treated as TRY.
  const expectedTryMinor = (currency: string, amountMinor: number): number | null => {
    if (currency === "TRY") return amountMinor;
    const rateTry = marketSellRateTry(currency) ?? lookupRate(userId, currency)?.rate.rateTry ?? null;
    return rateTry == null ? null : convertToTryMinor(amountMinor, rateTry);
  };
  const monthEnd = lastDayOf(month);
  const model = buildDashboardModel({
    transactions: txLike,
    expected,
    ledger: bundle?.ledger ?? [],
    actualBalanceMinor: bundle?.actualBalanceMinor ?? null,
    today,
    monthStart: firstDayOf(month),
    monthEnd,
    currentMonth: month,
    year,
    expectedTryMinor,
  });
  const { lateItems: late, incomingMinor, outgoingMinor: remainingFixedMinor } = model;
  const upcoming = buildUpcomingTimeline({
    expected,
    transactions: txLike,
    expectedSources: [
      ...subscriptions.map((subscription) => ({
        id: subscription.id,
        name: subscription.name,
        sourceType: "subscription" as const,
        categoryName: catName(subscription.categoryId) ?? null,
      })),
      ...incomes.map((income) => ({
        id: income.id,
        name: income.name,
        sourceType: "recurring_income" as const,
        categoryName: catName(income.categoryId) ?? null,
      })),
    ],
    categories: categories.map((category) => ({ id: category.id, name: category.name })),
    cards: sources.filter((source) => source.type === "credit_card"),
    statements: cardStatements,
    today,
    horizonDays: 31,
  }).filter((item) => item.status === "upcoming");
  const dashboardLate = late.slice(0, 5);
  const dashboardUpcoming = upcoming.slice(0, Math.max(0, 5 - dashboardLate.length));
  const timelineTypeLabel = (sourceType: (typeof upcoming)[number]["sourceType"]) => ({
    recurring_income: tr.dashboard.expectedIncome,
    subscription: tr.subs.title,
    scheduled_transaction: tr.dashboard.scheduledTx,
    card_statement: tr.dashboard.cardStatement,
  })[sourceType];

  const projected = model.projectedMinor;
  const monthIncomeMinor = model.distribution.incomeTotalMinor;
  const monthOutflowMinor = model.distribution.expenseTotalMinor + model.distribution.transferTotalMinor;
  const monthNetMinor = monthIncomeMinor - monthOutflowMinor;
  const monthDonut = distributionDonutData(
    model.distribution,
    chartColors,
    (id) => categoryById.get(id)?.name ?? tr.common.none,
  );
  const hasMonthFlow = monthIncomeMinor !== 0 || monthDonut.slices.length > 0 || monthDonut.supplementalSlices.length > 0;
  const monthBars = [{
    label: monthName(month),
    values: [monthIncomeMinor, model.distribution.expenseTotalMinor, model.distribution.transferTotalMinor],
  }];
  const monthBarSeries = [
    { label: tr.cashflow.income, color: palette.positive },
    { label: tr.cashflow.expense, color: palette.negative },
    { label: tr.cashflow.transfer, color: palette.secondary },
  ];

  // A paid item realizes on its actual payment day, not its planned due day.
  const [showForecast, setShowForecast] = React.useState(false);
  const [chartType, setChartType] = React.useState<"pie" | "bars">("pie");
  const [paying, setPaying] = React.useState<(typeof expected)[number] | null>(null);
  const defaultPaidDate = (dueDate: string): ISODate => (dueDate <= today ? (dueDate as ISODate) : today);
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  const operationGuard = useOperationGuard();
  const confirm = async (e: (typeof expected)[number], paidOn: ISODate) => {
    if (!selfPersonId) return;
    await operationGuard.run(async () => {
      setConfirmingId(e.id);
      try {
        const sub = subscriptionById.get(e.refId);
        const income = incomeById.get(e.refId);
        await confirmExpected(userId, e.id, {
          personId: sub?.personId ?? income?.personId ?? selfPersonId,
          categoryId: sub?.categoryId ?? income?.categoryId ?? null,
          paidOn,
        });
        scheduleSync(userId);
        undo.show(`${nameOf(e)} ✓`, () => revertExpected(userId, e.id));
      } catch (err) {
        errorNotice();
        if (err instanceof FxRateUnavailableError) void appAlert(tr.errors.fxUnavailable);
        else {
          devError("confirm", err);
          void appAlert(tr.errors.saveFailed);
        }
      } finally {
        setConfirmingId(null);
      }
    });
  };

  const projectedDelta = bundle && projected != null ? projected - bundle.actualBalanceMinor : null;
  const wideDashboard = width >= 960;
  const pairedDashboard = wideDashboard;
  const dashboardUpcomingCount = late.length + upcoming.length;
  const marketDesktopColumns: 2 | 3 = dashboardUpcomingCount <= 3 ? 3 : 2;
  const analysisSection = (
    <>
      <SectionHeader>{tr.dashboard.monthInsight}</SectionHeader>
      <Card>
        <ListRow
          icon={ChartNoAxesColumn}
          title={tr.dashboard.monthNet(formatMinor(monthNetMinor))}
          subtitle={tr.dashboard.monthFlowSummary(formatMinor(monthIncomeMinor), formatMinor(monthOutflowMinor))}
          chevron
          // Root-level route, not the tab's own. Pushing into the Cash Flow
          // stack from here would mount that tab's index underneath, and the
          // iOS edge swipe pops to whatever is underneath — the Financial
          // Table, not this screen. At the root, what is underneath IS this
          // screen, so the gesture and the back button agree.
          onPress={() => router.push("/analytics")}
        />
        <Divider />
        {hasMonthFlow ? (
          <>
            <Segmented
              noMargin
              options={[
                { value: "pie", label: tr.analysis.chartPie },
                { value: "bars", label: tr.analysis.chartBars },
              ]}
              value={chartType}
              onChange={setChartType}
            />
            {/* No `alignItems: center` here: the chart already lays its ring
                and legend out as one centred row, and centring the wrapper
                collapsed that row to its content width so the two wrapped and
                stacked with a third of the card empty on either side. */}
            <View style={{ marginTop: spacing.lg }}>
              {chartType === "pie" ? (
                <Donut
                  slices={monthDonut.slices}
                  supplementalSlices={monthDonut.supplementalSlices}
                  totalMinor={monthDonut.totalMinor}
                  size={shouldUseCompactChart(width) ? 152 : 236}
                />
              ) : (
                <Bars
                  width={Math.max(240, Math.min(width - spacing.xxl * 2, 1040))}
                  groups={monthBars}
                  series={monthBarSeries}
                />
              )}
            </View>
          </>
        ) : (
          <Body muted style={{ marginTop: spacing.md }}>{tr.analysis.noResults}</Body>
        )}
      </Card>
    </>
  );
  return (
    <Screen
      title={greeting()}
      subtitle={dateLabel(today)}
      // The rail already carries the mark and the product name at desktop
      // widths; repeating it beside the greeting is the same identity twice on
      // one screen. Phones have no rail, so the greeting keeps it.
      leading={shouldUseSideNavigation(width) ? undefined : <BrandMark size={40} />}
      width="workspace"
    >
      <FirstRunTour />
      <DataStateNotice status={dataStatus} retry={retryData} />
      {previousLoginAt ? (
        <View style={{ marginBottom: spacing.sm, alignSelf: "flex-start" }}>
          <Badge icon={ShieldCheck} text={tr.dashboard.lastLogin(dateTimeLabel(previousLoginAt))} />
        </View>
      ) : null}
      {/* "When did you pay?" — records the actual paid day for an expected item,
          so an early/manual payment realizes on that date. Future days disabled. */}
      {paying ? (
        <CalendarSheet
          value={defaultPaidDate(paying.dueDate)}
          max={today}
          onSelect={(iso) => void confirm(paying, iso)}
          onClose={() => setPaying(null)}
        />
      ) : null}
      {/* Reconciliation nudge — shown only when payments are actually overdue and
          awaiting confirmation (not on a stale "days since last entry" timer, which
          lingered even with nothing to do). Derived from live data, so it clears
          itself the moment the last item is confirmed. */}
      {late.length > 0 ? (
        <Card tone="warning" onPress={() => router.push("/reconciliation")}>
          <Row>
            <History accessible={false} size={20} color={palette.warning} />
            <View style={{ flex: 1 }}>
              <Body>{tr.dashboard.pendingConfirm(late.length)}</Body>
              <Body muted>{tr.dashboard.catchUp}</Body>
            </View>
            <ChevronRight accessible={false} size={18} color={palette.textSecondary} />
          </Row>
        </Card>
      ) : null}

      {bundle ? (
        <HeroCard>
          <View style={wideDashboard ? { flexDirection: "row", alignItems: "stretch" } : undefined}>
            <View style={wideDashboard ? { flex: 1, paddingRight: spacing.xl, justifyContent: "center" } : undefined}>
              <Text style={[type.label, { color: heroInk, textTransform: "uppercase", letterSpacing: 1, fontSize: 11 }]}>
                {tr.dashboard.actualBalance}
              </Text>
              <Amount
                minor={bundle.actualBalanceMinor}
                hero
                colorized={false}
                color={heroInk}
                style={{ marginTop: spacing.xs, textAlign: "left" }}
              />
              {projected != null ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showForecast }}
                  onPress={() => setShowForecast((v) => !v)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.sm,
                    marginTop: spacing.md,
                    paddingTop: spacing.md,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: palette.border,
                    opacity: pressed ? 0.72 : 1,
                  })}
                >
                  {projectedDelta != null && projectedDelta >= 0 ? (
                    <TrendingUp size={18} color={palette.positiveText} />
                  ) : (
                    <TrendingDown size={18} color={palette.negativeText} />
                  )}
                  <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                    <Text style={[type.label, { color: palette.textSecondary }]}>{tr.dashboard.forecastToggle}</Text>
                    <Amount
                      minor={projected}
                      colorized={false}
                      color={projected >= 0 ? palette.positiveText : palette.negativeText}
                      style={{ textAlign: "left" }}
                    />
                  </View>
                  {showForecast ? <ChevronUp size={18} color={palette.accentText} /> : <ChevronDown size={18} color={palette.accentText} />}
                </Pressable>
              ) : null}
            </View>

            <View
              accessible={false}
              style={wideDashboard
                ? { width: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginHorizontal: spacing.xl }
                : { height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginVertical: spacing.lg }}
            />

            <View style={wideDashboard ? { flex: 1, paddingLeft: spacing.xl, justifyContent: "space-between" } : undefined}>
              <View>
                <Text style={[type.label, { color: palette.textSecondary, textTransform: "uppercase", letterSpacing: 1.1, fontSize: 11 }]}>
                  {monthName(month)}
                </Text>
                <MetricStrip
                  style={{ marginTop: spacing.md }}
                  items={[
                    { label: tr.cashflow.income, value: <Amount minor={monthIncomeMinor} colorized={false} color={palette.positiveText} style={{ textAlign: "left" }} /> },
                    { label: tr.dashboard.outflow, value: <Amount minor={-monthOutflowMinor} colorized={false} color={palette.negativeText} style={{ textAlign: "left" }} /> },
                    { label: tr.dashboard.netChange, value: <Amount minor={monthNetMinor} colorized={false} color={palette.textStrong} style={{ textAlign: "left" }} /> },
                  ]}
                />
              </View>
              <Row style={{ marginTop: spacing.lg }}>
                <View style={{ flex: 1 }}>
                  <Button icon={Plus} label={tr.cashflow.addTransaction} onPress={() => router.push("/transaction")} />
                </View>
                {late.length > 0 ? (
                  <View style={{ flex: 1 }}>
                    <Button icon={History} label={tr.dashboard.catchupShort} variant="secondary" onPress={() => router.push("/reconciliation")} />
                  </View>
                ) : null}
              </Row>
            </View>
          </View>
        </HeroCard>
      ) : (
        <HeroCard>
          {/* Same label/amount line heights as the loaded state. */}
          <View style={{ width: 120, height: 13, borderRadius: radius.sm, backgroundColor: palette.border }} />
          <View style={{ width: 208, height: 38, borderRadius: radius.sm, backgroundColor: palette.border, marginTop: spacing.xs }} />
        </HeroCard>
      )}

      {bundle && showForecast && projected != null ? (
        <Card>
          <Body muted style={{ fontSize: 12, marginBottom: spacing.sm }}>{tr.dashboard.forecastHint}</Body>
          <Spread style={{ marginBottom: spacing.xs }}>
            <Body muted>{tr.dashboard.forecastCurrent}</Body>
            <Amount minor={bundle.actualBalanceMinor} />
          </Spread>
          {incomingMinor > 0 ? (
            <Spread style={{ marginBottom: spacing.xs }}>
              <Body style={{ color: palette.positiveText }}>{tr.dashboard.forecastIncoming}</Body>
              <Amount minor={incomingMinor} colorized={false} color={palette.positiveText} />
            </Spread>
          ) : null}
          {remainingFixedMinor > 0 ? (
            <Spread style={{ marginBottom: spacing.xs }}>
              <Body style={{ color: palette.negativeText }}>{tr.dashboard.forecastOutgoing}</Body>
              <Amount minor={-remainingFixedMinor} colorized={false} color={palette.negativeText} />
            </Spread>
          ) : null}
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginVertical: spacing.sm }} />
          <Spread>
            <Body style={{ fontFamily: font.semibold }}>{tr.dashboard.forecastResult}</Body>
            <Amount
              minor={projected}
              colorized={false}
              color={projected >= 0 ? palette.positiveText : palette.negativeText}
            />
          </Spread>
        </Card>
      ) : null}

      {analysisSection}

      <View style={pairedDashboard ? { flexDirection: "row", alignItems: "stretch", gap: spacing.lg } : undefined}>
        <View style={pairedDashboard ? { flex: 1 } : undefined}>
          <MarketsCard fill={pairedDashboard} desktopColumns={marketDesktopColumns} />
        </View>

        <View style={pairedDashboard ? { flex: 1 } : undefined}>
          {/* Upcoming payments */}
          <SectionHeader>{tr.dashboard.upcoming}</SectionHeader>
      {dataStatus === "loading" || dataStatus === "error" ? null : (late.length > 0 || upcoming.length > 0) && selfPersonId ? (
        <Card style={pairedDashboard ? { flex: 1 } : undefined}>
          <View style={pairedDashboard ? { flexGrow: 1 } : undefined}>
            {dashboardLate.map((e) => (
              <ListRow
                key={e.id}
                icon={e.direction === "in" ? ArrowDownLeft : ArrowUpRight}
                iconColor={palette.error}
                title={nameOf(e)}
                subtitle={`${tr.dashboard.late} · ${dateLabel(e.dueDate)} · ${formatMinor(e.amountMinor, e.currency)}`}
                right={(
                  <View style={{ width: STATUS_W }}>
                    <Button
                      size="sm"
                      label={e.direction === "in" ? tr.dashboard.received : tr.dashboard.markPaid}
                      variant="secondary"
                      loading={confirmingId === e.id}
                      disabled={confirmingId != null}
                      onPress={() => setPaying(e)}
                    />
                  </View>
                )}
              />
            ))}
            {dashboardUpcoming.map((u) => (
              <ListRow
                key={u.key}
                icon={u.direction === "in" ? ArrowDownLeft : CalendarClock}
                iconColor={u.direction === "in" ? palette.positive : undefined}
                title={u.name ?? u.categoryName ?? tr.common.paymentFallback}
                subtitle={`${timelineTypeLabel(u.sourceType)} · ${tr.dashboard.inDays(daysBetweenISO(today, u.date))} · ${formatMinor(u.amountMinor, u.currency)}`}
                right={u.kind === "expected" && u.expectedId ? (
                  <View style={{ width: STATUS_W }}>
                    <Button
                      size="sm"
                      label={u.direction === "in" ? tr.dashboard.received : tr.dashboard.markPaid}
                      variant="secondary"
                      loading={confirmingId === u.expectedId}
                      disabled={confirmingId != null}
                      onPress={() => {
                        const expectedItem = expected.find((item) => item.id === u.expectedId);
                        if (expectedItem) setPaying(expectedItem);
                      }}
                    />
                  </View>
                ) : undefined}
              />
            ))}
          </View>
          {/* A card's trailing link action is `sm`, like every other one in the
              app. A regular button's 48pt minimum height centres its label
              14.5pt from the card's padding while a ListRow insets its text by
              10 — which is exactly the uneven top/bottom gap this card had. */}
          <Button label={tr.dashboard.allUpcoming} variant="ghost" size="sm" onPress={() => router.push("/upcoming" as Href)} />
        </Card>
      ) : (
        /* A compact calendar picture gives an otherwise empty equal-height
           desktop panel visual weight without inventing any future payment. */
        <Card style={pairedDashboard ? { flex: 1 } : undefined}>
          <View style={pairedDashboard ? { flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.sm } : { alignItems: "center", gap: spacing.sm }}>
            <View
              accessible={false}
              style={{
                width: pairedDashboard ? "76%" : 84,
                maxWidth: 300,
                height: pairedDashboard ? 170 : 68,
                overflow: "hidden",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: palette.border + "70",
                backgroundColor: palette.surfaceAlt,
              }}
            >
              <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: pairedDashboard ? 8 : 6, backgroundColor: palette.primary }} />
              {pairedDashboard ? (
                <View style={{ alignSelf: "stretch", flex: 1, padding: spacing.lg, paddingTop: spacing.xl }}>
                  <Spread style={{ marginBottom: spacing.md }}>
                    <CalendarClock size={22} color={palette.accentText} strokeWidth={1.8} />
                    <View style={{ flexDirection: "row", gap: 4 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.surfaceStrong }} />
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.surfaceStrong }} />
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.primary }} />
                    </View>
                  </Spread>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {Array.from({ length: 20 }, (_, index) => (
                      <View
                        key={index}
                        style={{
                          flexBasis: "16%",
                          flexGrow: 1,
                          height: 15,
                          borderRadius: 3,
                          backgroundColor: index === 17 ? palette.primarySoft : palette.surface,
                          borderWidth: StyleSheet.hairlineWidth,
                          borderColor: index === 17 ? palette.primary + "70" : palette.border + "50",
                        }}
                      />
                    ))}
                  </View>
                </View>
              ) : (
                <>
                  <CalendarClock size={25} color={palette.accentText} strokeWidth={1.8} />
                  <View style={{ position: "absolute", bottom: spacing.sm, flexDirection: "row", gap: 4 }}>
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: palette.surfaceStrong }} />
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: palette.surfaceStrong }} />
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: palette.primary }} />
                  </View>
                </>
              )}
            </View>
            <Body muted style={{ textAlign: "center" }}>{tr.dashboard.noUpcoming}</Body>
          </View>
          <View style={{ marginTop: spacing.xs }}>
            <Button
              label={tr.dashboard.allUpcoming}
              variant="ghost"
              size="sm"
              onPress={() => router.push("/upcoming" as Href)}
            />
          </View>
        </Card>
      )}
        </View>
      </View>

    </Screen>
  );
}
