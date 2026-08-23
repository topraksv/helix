/** Dashboard: current balance, action-needed payments, upcoming timeline and
 * one concise monthly insight. Detailed exploration belongs to Analysis. */

import React, { useMemo } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import ArrowDownLeft from "lucide-react-native/icons/arrow-down-left";
import ArrowUpRight from "lucide-react-native/icons/arrow-up-right";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import ChartNoAxesColumn from "lucide-react-native/icons/chart-no-axes-column";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import History from "lucide-react-native/icons/rotate-ccw-clock";
import Plus from "lucide-react-native/icons/plus";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import TrendingDown from "lucide-react-native/icons/trending-down";
import TrendingUp from "lucide-react-native/icons/trending-up";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { balanceDeclarationDrift, parseBalanceDeclaration } from "../../domain/balance-declaration";
import { buildDashboardModel } from "../../domain/dashboard";
import { daysBetweenISO, firstDayOf, lastDayOf, monthKeyOf, todayISO, yearOf, type ISODate } from "../../domain/dates";
import { formatMinorCompact } from "../../domain/money";
import { AMOUNT_LABELS, needsVariableAmountEntry, occurrenceAmountText } from "../../domain/subscriptions";
import { buildUpcomingTimeline } from "../../domain/upcoming";
import { clockOrDateTimeLabel, dateLabel, dateTimeLabel, monthName, tr } from "../../i18n/tr";
import { useSession } from "../../auth/session";
import { kv } from "../../services/kv";
import {
  settingValue,
  useCategoriesState,
  useCreditCardStatementsState,
  useLedgerState,
  useSettingsMapState,
  usePendingExpectedState,
  usePersonsState,
  useRecurringIncomesState,
  useSourcesState,
  useSubscriptionsState,
  useUserId,
} from "../../data/hooks";
import { combineLiveStates } from "../../data/live-state";
import { confirmExpected, FxRateUnavailableError, revertExpected, setExpectedAmount } from "../../data/repo";
import { MARKET_SYMBOLS } from "../../domain/investment-catalog";
import { marketSellRateTry, useMarkets } from "../../services/markets";
import { convertToTryMinor } from "../../domain/fx";
import { lookupRate, useFxRates } from "../../services/fx-fetch";
import { appAlert } from "../../ui/dialog";
import { scheduleSync } from "../../sync/engine";
import { Amount, Badge, Body, Button, Card, DataStateNotice, DisclosureChevron, Divider, Eyebrow, HeroCard, ListRow, MetricStrip, Row, Screen, SectionHeader, Segmented, Skeleton, Spread, STATUS_W } from "../../ui/components";
import { Collapse, useScreenFocus, useValueFlash } from "../../ui/motion-primitives";
import { Bars, ChartFrame, Donut, distributionDonutData, useSeriesColors } from "../../ui/charts";
import { CalendarSheet } from "../../ui/calendar";
import { ExpectedAmountSheet } from "../../ui/expected-amount-sheet";
import { BrandMark } from "../../ui/brand";
import { FirstRunTour } from "../../ui/tour";
import { useUndo } from "../../ui/undo";
import { errorNotice } from "../../ui/haptics";
import { marketTileColumns, shouldPairDashboardPanels, shouldSplitDashboardHero, shouldUseCompactChart, shouldUseLargeDonut } from "../../ui/responsive";
import { useContentWidth, useMeasuredWidth } from "../../ui/viewport";
import { interactionSurface } from "../../ui/interaction";
import { useWarmRoute } from "../../ui/route-warmup";
import { circle, controlSize, font, heroSurface, iconSize, radius, spacing, type, useTheme } from "../../ui/theme";
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
          <Text style={[type.heading, { color: palette.primaryText, fontFamily: font.bold, fontSize: type.body.fontSize }]}>{currency}</Text>
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
          <Text style={[type.small, { color: palette.tertiaryText, fontFamily: font.bold, fontSize: type.micro.fontSize, marginTop: 5 }]}>Au</Text>
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
          borderRadius: circle(30),
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1.5,
          borderColor: palette.tertiary,
          backgroundColor: palette.tertiarySoft,
        }}
      >
        <View style={{ position: "absolute", inset: 3, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.tertiary + "80" }} />
        <Text style={[type.small, { color: palette.tertiaryText, fontFamily: font.bold, fontSize: type.caption.fontSize }]}>{coinMark}</Text>
      </View>
    </View>
  );
}

/**
 * One live quote.
 *
 * Its own component because each tile owns a flash of its own: a feed tick is
 * the one thing in this app that changes without the user doing anything, and
 * the only sign it had happened was a number being different from the one
 * nobody was looking at. The tint is an opacity over a resting tile, so it
 * stays on the native driver, and it is armed only while the screen is the one
 * on show — a background tab must not animate.
 *
 * The provider re-sends a symbol only when its price moves, and the store
 * throttles to one apply every three seconds, so this is a punctuation mark
 * rather than a pulse.
 */
function QuoteTile({
  code,
  label,
  price,
  columns,
  cramped,
  live,
}: {
  code: string;
  label: string;
  price: { buyTry: number; sellTry: number; direction: "up" | "down" | "" };
  columns: number;
  cramped: boolean;
  live: boolean;
}) {
  const { palette } = useTheme();
  const flash = useValueFlash(price.sellTry, live);
  const priceText = (v: number) =>
    new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  const direction = price.direction === "up"
    ? tr.markets.rising
    : price.direction === "down"
      ? tr.markets.falling
      : tr.markets.unchanged;
  const size = cramped ? 40 : 44;
  return (
    <View
      accessible
      role="group"
      accessibilityLabel={tr.markets.quote(label, priceText(price.buyTry), `${priceText(price.sellTry)}\u00A0₺`, direction)}
      style={{
        flexGrow: 1,
        flexBasis: columns === 3 ? "29%" : columns === 2 ? "46%" : "100%",
        minWidth: 0,
        minHeight: columns === 3 ? 102 : 112,
        justifyContent: "space-between",
        padding: spacing.md,
        borderRadius: radius.md,
        backgroundColor: palette.surfaceAlt,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border + "70",
        overflow: "hidden",
      }}
    >
      {price.direction !== "" ? (
        <Animated.View
          pointerEvents="none"
          accessible={false}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            opacity: flash,
            backgroundColor: (price.direction === "up" ? palette.positive : palette.negative) + "24",
          }}
        />
      ) : null}
      <Row gap={spacing.xs} style={{ alignItems: "center" }}>
        <View style={{ width: size, height: size, flexShrink: 0 }}>
          <MarketInstrumentArt code={code} size={size} />
          {price.direction === "up" ? (
            <View style={{ position: "absolute", right: -2, top: -2, borderRadius: radius.sm, padding: 2, backgroundColor: palette.surface }}>
              <TrendingUp accessible={false} size={12} color={palette.positive} />
            </View>
          ) : price.direction === "down" ? (
            <View style={{ position: "absolute", right: -2, top: -2, borderRadius: radius.sm, padding: 2, backgroundColor: palette.surface }}>
              <TrendingDown accessible={false} size={12} color={palette.negative} />
            </View>
          ) : null}
        </View>
        <Body
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: font.semibold,
            fontSize: cramped ? type.label.fontSize : undefined,
            lineHeight: cramped ? 16 : undefined,
            textAlignVertical: "center",
          }}
        >
          {label}
        </Body>
      </Row>
      <View style={{ marginTop: spacing.sm, gap: 3 }}>
        <Spread>
          <Text style={[type.small, { color: palette.textSecondary }]}>{tr.markets.buy}</Text>
          <Text style={[type.amountSm, { color: palette.textSecondary, textAlign: "right" }]}>{priceText(price.buyTry)}</Text>
        </Spread>
        <Spread>
          <Text style={[type.small, { color: palette.textSecondary }]}>{tr.markets.sell}</Text>
          <Text style={[type.amount, { color: palette.text, textAlign: "right" }]}>
            {`${priceText(price.sellTry)}\u00A0₺`}
          </Text>
        </Spread>
      </View>
    </View>
  );
}

function MarketsCard({ fill = false, desktopColumns = 2 }: { fill?: boolean; desktopColumns?: 2 | 3 }) {
  const { palette } = useTheme();
  // How many quote tiles fit is a question about this card, not about the
  // window: the same card is a full-width strip on a phone and one column of a
  // desktop pair, and only the card knows which.
  const [cardWidth, onCardLayout] = useMeasuredWidth(320);
  const userId = useUserId();
  const { prices, status, lastEventAt } = useMarkets();
  // A feed tick must not animate a card nobody is looking at.
  const focused = useScreenFocus();
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
  const marketColumns = marketTileColumns(cardWidth, desktopColumns);
  // A tile is cramped by how much of the card it actually gets, not by the
  // window: two columns of a 358px phone card and two columns of a 500px
  // desktop column are different tiles.
  const crampedTile = cardWidth / marketColumns < 215;

  return (
    <>
      <SectionHeader>{tr.markets.title}</SectionHeader>
      <Card onLayout={onCardLayout} style={fill ? { flex: 1 } : undefined}>
        <Row
          gap={spacing.xs}
          style={{ justifyContent: "flex-end", marginBottom: spacing.xs }}
          accessible
          role="group"
          accessibilityLiveRegion="polite"
          accessibilityLabel={statusLabel}
        >
          {/* The dot claims liveness only once real quotes are flowing. */}
          <View accessible={false} style={{ width: 7, height: 7, borderRadius: circle(7), backgroundColor: status === "live" ? palette.success : palette.textSecondary }} />
          <Text style={[type.small, { color: palette.textSecondary, textAlign: "right", flexShrink: 1 }]}>{statusLabel}</Text>
        </Row>
        {quoted.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {quoted.map(({ code, label }) => (
              <QuoteTile
                key={code}
                code={code}
                label={label}
                price={prices[code]!}
                columns={marketColumns}
                cramped={crampedTile}
                live={focused}
              />
            ))}
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
            <Body muted style={{ marginTop: spacing.sm, fontSize: type.small.fontSize }}>{tr.markets.offlineHint}</Body>
          </>
        ) : (
          // The card is stretched to its neighbour's height when the two share
          // a desktop row, so a single sentence pinned to the top left leaves
          // the column looking abandoned. One line of copy centres in the space
          // it was given instead.
          <View style={fill ? { flex: 1, justifyContent: "center", paddingVertical: spacing.lg } : undefined}>
            <Body muted style={{ textAlign: fill ? "center" : "left", maxWidth: 380, alignSelf: fill ? "center" : "auto" }}>
              {tr.markets.noData}
            </Body>
          </View>
        )}
      </Card>
    </>
  );
}

/**
 * Re-render when the wall clock crosses an hour.
 *
 * The greeting and the date under it are both read from `new Date()` at render
 * time and nothing asked for another render, so a session left open said "İyi
 * günler" at 19:00 and was still saying "İyi akşamlar" — over yesterday's date
 * — at three in the morning. The timer is armed to the next hour boundary
 * rather than to a fixed interval, so it fires once an hour on the hour and
 * costs one render.
 */
function useHourTick(): number {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(now.getHours() + 1, 0, 0, 0);
    const timer = setTimeout(() => setTick((value) => value + 1), next.getTime() - now.getTime());
    return () => clearTimeout(timer);
  }, [tick]);
  return tick;
}

const CHART_TYPE_KEY = "helix.dashboard.chart";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return tr.dashboard.greetingNight;
  if (hour < 12) return tr.dashboard.greetingMorning;
  if (hour < 18) return tr.dashboard.greetingDay;
  return tr.dashboard.greetingEvening;
}

export default function DashboardScreen() {
  // The ledger is the tab this app exists for and the most expensive one to
  // create. Built while the navigator is fading between two scenes it drops
  // frames once, on the first arrival; built here, in idle, it drops none.
  useWarmRoute("cash-flow");
  useHourTick();
  const userId = useUserId();
  const previousLoginAt = useSession((state) => state.previousLoginAt);
  // "You told me X; the table says Y" — computed here so the hero can mark it
  // and the ledger's own closing row can mark the same thing.

  const today = todayISO();
  const year = yearOf(today);
  const month = monthKeyOf(today);
  const ledgerState = useLedgerState(year);
  const settingsState = useSettingsMapState();
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
  const { status: dataStatus, retry: retryData } = combineLiveStates([
    ledgerState,
    categoriesState,
    personsState,
    expectedState,
    subscriptionsState,
    incomesState,
    sourcesState,
    cardStatementsState,
  ]);
  const router = useRouter();
  const undo = useUndo();
  const { palette, scheme } = useTheme();
  const hero = heroSurface(palette, scheme);
  const heroInk = hero.ink;
  const contentWidth = useContentWidth();
  const chartColors = useSeriesColors();
  // Re-render when FX rates land so foreign-currency projections settle.
  useFxRates();

  // Its own memo, so the empty-ledger fallback is one stable array rather than
  // a new one per render feeding everything derived from it.
  const txLike = useMemo(() => bundle?.txLike ?? [], [bundle]);
  const selfPersonId = persons.find((p) => p.isSelf)?.id;
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const subscriptionById = useMemo(() => new Map(subscriptions.map((s) => [s.id, s])), [subscriptions]);
  const incomeById = useMemo(() => new Map(incomes.map((income) => [income.id, income])), [incomes]);

  const catName = React.useCallback(
    (id: string | null) => (id ? categoryById.get(id)?.name : undefined),
    [categoryById],
  );
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
  // Derived from every transaction the account has, so it is derived from the
  // data and not from the render. `buildDashboardModel` above deliberately is
  // NOT memoized: its `expectedTryMinor` reads the live market store, which
  // this screen does not subscribe to, so pinning it to a dependency list would
  // pin an exchange rate.
  const upcoming = useMemo(() => buildUpcomingTimeline({
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
  }).filter((item) => item.status === "upcoming"),
  [expected, txLike, subscriptions, incomes, categories, sources, cardStatements, today, catName]);
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
  // Remembered, like the ledger's own view mode and pins. It was the one
  // view preference in the app that reset itself: choosing bars and coming
  // back from another tab put the pie chart back.
  const [chartType, setChartType] = React.useState<"pie" | "bars">("pie");
  React.useEffect(() => {
    void kv.get(CHART_TYPE_KEY).then((value) => {
      if (value === "pie" || value === "bars") setChartType(value);
    });
  }, []);
  const changeChartType = React.useCallback((value: "pie" | "bars") => {
    setChartType(value);
    void kv.set(CHART_TYPE_KEY, value);
  }, []);
  const [paying, setPaying] = React.useState<(typeof expected)[number] | null>(null);
  const [amountEditing, setAmountEditing] = React.useState<(typeof expected)[number] | null>(null);
  const defaultPaidDate = (dueDate: string): ISODate => (dueDate <= today ? (dueDate as ISODate) : today);
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  const operationGuard = useOperationGuard();
  const needsAmountEntry = (e: (typeof expected)[number]) => needsVariableAmountEntry(e, subscriptionById);
  // One rule for how an estimated amount reads, shared with the catch-up and
  // upcoming screens so the three cannot drift apart.
  const amountFragment = (item: { amountMinor: number; currency: string; amountIsEstimated?: boolean }) =>
    occurrenceAmountText(item, formatMinorCompact, AMOUNT_LABELS);
  const saveExpectedAmount = async (amountMinor: number) => {
    if (!amountEditing) return;
    await setExpectedAmount(userId, amountEditing.id, amountMinor);
    scheduleSync(userId);
    undo.show(tr.subs.amountEntrySaved);
  };
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
  // "You told me X; the table says Y" — the ledger has moved away from the last
  // figure the user confirmed against a real account.
  const balanceDrift = balanceDeclarationDrift(
    parseBalanceDeclaration(settingValue<unknown>(settingsState.data, "balance_declared", null)),
    bundle?.actualBalanceMinor ?? null,
  );
  const wideDashboard = shouldSplitDashboardHero(contentWidth);
  const pairedDashboard = shouldPairDashboardPanels(contentWidth);
  const dashboardUpcomingCount = late.length + upcoming.length;
  const marketDesktopColumns: 2 | 3 = dashboardUpcomingCount <= 3 ? 3 : 2;
  const analysisSection = (
    <>
      <SectionHeader>{tr.dashboard.monthInsight}</SectionHeader>
      <Card>
        <ListRow
          icon={ChartNoAxesColumn}
          title={tr.dashboard.monthNet(formatMinorCompact(monthNetMinor))}
          subtitle={tr.dashboard.monthFlowSummary(formatMinorCompact(monthIncomeMinor), formatMinorCompact(monthOutflowMinor))}
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
              onChange={changeChartType}
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
                  // A ceiling per class of viewport, not a fixed ring: the
                  // month card owns a whole desktop row, and a 236 ring in it
                  // is a small picture in a large frame. `Donut` still fits
                  // whatever box it actually gets.
                  size={shouldUseCompactChart(contentWidth) ? 152 : shouldUseLargeDonut(contentWidth) ? 300 : 236}
                />
              ) : (
                <ChartFrame>
                  {(chartWidth) => <Bars width={chartWidth} groups={monthBars} series={monthBarSeries} />}
                </ChartFrame>
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
      leading={<BrandMark size={40} />}
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
      {amountEditing ? (
        <ExpectedAmountSheet
          currency={amountEditing.currency}
          currentMinor={amountEditing.amountMinor}
          isEstimated={amountEditing.amountIsEstimated === true}
          onSave={saveExpectedAmount}
          onClose={() => setAmountEditing(null)}
          onError={(error) => {
            devError("dashboard.amount", error);
            void appAlert(tr.errors.saveFailed);
          }}
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
              <Row gap={spacing.sm} style={{ alignItems: "center" }}>
                <Eyebrow color={heroInk}>{tr.dashboard.actualBalance}</Eyebrow>
                {/* The ledger has moved away from the last figure the user
                    confirmed against a real account. The mark is the way to the
                    screen that can say by how much and put it right. */}
                {balanceDrift != null ? (
                  // The painted pill stays compact — it sits beside a label
                  // in a hero — but the PRESSABLE is the platform minimum.
                  // It used to be the pill: 2pt of vertical padding around a
                  // 10pt label measured about 18pt tall, on a control that
                  // navigates. `hitSlop` would not have rescued it either;
                  // react-native-web does not implement it, which is the same
                  // trap `IconButton` documents.
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={tr.settings.balanceDriftTitle}
                    onPress={() => router.push("/opening-balance")}
                    style={{ minHeight: controlSize.minimumTarget, justifyContent: "center" }}
                  >
                    {(state) => (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                          paddingHorizontal: spacing.sm,
                          paddingVertical: spacing.xs,
                          borderRadius: radius.full,
                          backgroundColor: palette.warning + "1C",
                          ...interactionSurface(palette, state, { base: palette.warning + "1C" }),
                          borderWidth: StyleSheet.hairlineWidth,
                          borderColor: palette.warning + "80",
                        }}
                      >
                        <TriangleAlert accessible={false} size={iconSize.compact} color={palette.warningText} strokeWidth={2.4} />
                        <Text style={[type.small, { color: palette.warningText, fontFamily: font.semibold }]}>
                          {tr.settings.balanceDriftShort}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                ) : null}
              </Row>
              <Amount
                testID="dashboard-current-balance"
                minor={bundle.actualBalanceMinor}
                hero
                count
                colorized={false}
                color={heroInk}
                style={{ marginTop: spacing.xs, textAlign: "left" }}
              />
              {projected != null ? (
                <Pressable
                  testID="dashboard-forecast-toggle"
                  accessibilityRole="button"
                  accessibilityLabel={`${tr.dashboard.forecastToggle} ${
                    projectedDelta != null && projectedDelta >= 0 ? tr.dashboard.forecastRising : tr.dashboard.forecastFalling
                  }`}
                  accessibilityState={{ expanded: showForecast }}
                  onPress={() => setShowForecast((v) => !v)}
                  style={(state) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.sm,
                    marginTop: spacing.md,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: palette.border,
                    // The row reaches the rule below it and stops there.
                    //
                    // Phone only. The wide layout draws that rule as a vertical
                    // divider beside this column, so there is nothing under the
                    // row to reach and its trailing space is left alone.
                    //
                    // The space is PADDING, not a cancelled margin. Pulling the
                    // rule up by exactly the padding it was supposed to sit
                    // below put the line through the middle of the lit band and
                    // left the amount resting on it — measured 0px from text to
                    // rule and the fill 12px past it. A control's painted box
                    // and its layout box have to be the same box, so the room
                    // under the amount is the row's own padding and the fill
                    // covers all of it.
                    // The padding stays SYMMETRIC. `resilience.spec.ts` requires
                    // it and is right to: this is one control, and a box whose
                    // label sits nearer its top border than its bottom edge
                    // reads as a mistake. So the phone grows both sides rather
                    // than only the one that had to reach the rule.
                    ...(wideDashboard
                      ? { paddingVertical: spacing.md, marginBottom: -spacing.md }
                      : { paddingVertical: spacing.lg }),
                    ...interactionSurface(palette, state),
                  })}
                >
                  {/* Direction is carried by the glyph, never by colour. The
                      arrow used to be painted from `projectedDelta` while the
                      amount beside it was painted from its own sign, so a
                      forecast that fell but stayed positive rendered a red
                      arrow next to a green number — two contradictory readings
                      of the same row, in the one vocabulary this app reserves
                      for the sign of money. */}
                  {projectedDelta != null && projectedDelta >= 0 ? (
                    <TrendingUp accessible={false} size={iconSize.accessory} color={palette.textSecondary} />
                  ) : (
                    <TrendingDown accessible={false} size={iconSize.accessory} color={palette.textSecondary} />
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
                  <DisclosureChevron open={showForecast} size={18} color={palette.accentText} />
                </Pressable>
              ) : null}
            </View>

            <View
              accessible={false}
              style={wideDashboard
                ? { width: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginHorizontal: spacing.xl }
                : {
                    height: StyleSheet.hairlineWidth,
                    backgroundColor: palette.border,
                    // Nothing between the forecast row and this line: the row
                    // owns the space down to it, so its hover fill ends ON the
                    // rule rather than a gap short of it. The full gap returns
                    // when that row is absent and there is nothing to touch.
                    marginTop: projected != null ? 0 : spacing.lg,
                    marginBottom: spacing.lg,
                  }}
            />

            <View style={wideDashboard ? { flex: 1, paddingLeft: spacing.xl, justifyContent: "space-between" } : undefined}>
              <View>
                <Eyebrow>{monthName(month)}</Eyebrow>
                <MetricStrip
                  testID="dashboard-month-metrics"
                  style={{ marginTop: spacing.md }}
                  items={[
                    // The three figures share one line and shorten together:
                    // the strip uses the shared compact scale, e.g. ₺1.2 Mn,
                    // rather than dropping "Net değişim" onto a second row.
                    { label: tr.cashflow.income, minor: monthIncomeMinor, color: palette.positiveText },
                    { label: tr.dashboard.outflow, minor: -monthOutflowMinor, color: palette.negativeText },
                    { label: tr.dashboard.netChange, minor: monthNetMinor },
                  ]}
                />
              </View>
              {/* One door per destination. The warning card directly above this
                  hero already opens reconciliation, is the more visible of the
                  two and carries the count; a second button 800px down the same
                  screen only made the hero's primary action share its row. */}
              <Row style={{ marginTop: spacing.lg }}>
                <View style={{ flex: 1 }}>
                  <Button icon={Plus} label={tr.cashflow.addTransaction} onPress={() => router.push("/transaction")} />
                </View>
              </Row>
            </View>
          </View>
        </HeroCard>
      ) : (
        <HeroCard>
          {/* Same label and amount line heights as the loaded state, so the
              hero does not change height when the figures arrive. These used
              to be flat blocks of `border` — a colour that reads as a rule,
              not as content — and they did not move, so they looked like a
              layout that had failed rather than one that was loading. */}
          <Skeleton width={120} height={type.label.fontSize} />
          <Skeleton width={208} height={type.amountLg.fontSize} style={{ marginTop: spacing.xs }} />
        </HeroCard>
      )}

      {/* Collapses rather than blinking: the toggle that opens it sits directly
          above, so the panel has to be seen to come out of it. */}
      <Collapse open={Boolean(bundle) && showForecast && projected != null}>
        {bundle && projected != null ? (
        <Card style={{ marginBottom: 0 }}>
          {/* One sentence: what the figure is, and that today's balance is not
              it. Two stacked notices read as fine print nobody finishes. */}
          <Body muted style={{ fontSize: type.small.fontSize, marginBottom: spacing.sm }}>{tr.dashboard.forecastHint}</Body>
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
          <Divider />
          <Spread>
            <Body style={{ fontFamily: font.semibold }}>{tr.dashboard.forecastResult}</Body>
            <Amount
              minor={projected}
              colorized={false}
              color={projected >= 0 ? palette.positiveText : palette.negativeText}
            />
          </Spread>
          {/* The figure above sums what is KNOWN, and stays that. This is the
              other end of the same month: what it looks like once the spending
              no rule predicts is expected to happen too. It sits below the
              result rather than inside the arithmetic because it is measured
              from history, not recorded — and a reader has to be able to tell
              which of the two numbers is which. */}
          {model.expectedVariableMinor != null && model.expectedVariableMinor > 0 ? (
            <>
              <Spread style={{ marginTop: spacing.xs }}>
                <Body muted>{tr.dashboard.forecastTypical}</Body>
                <Amount
                  minor={projected - model.expectedVariableMinor}
                  colorized={false}
                  color={palette.textSecondary}
                />
              </Spread>
              <Body muted style={{ fontSize: type.small.fontSize, marginTop: spacing.xs }}>
                {tr.dashboard.forecastTypicalHint(formatMinorCompact(model.expectedVariableMinor))}
              </Body>
            </>
          ) : null}
        </Card>
        ) : null}
      </Collapse>

      {/* The month owns its own row, the two panels share the one under it.
          The distribution is the screen's one piece of analysis and it reads
          across: a ring on the left and its legend on the right, using the
          whole column rather than centring 650px of content inside 1180 and
          leaving a dead margin either side. Below it the payments to act on and
          the ambient market strip are peers in width but not in weight, so the
          task takes the larger share — and the pair keeps the page short enough
          that a desktop does not have to scroll for either. */}
      {analysisSection}

      {/* Equal columns, equal heights. The two panels answer different
          questions but they are the page's footer row, and a row whose two
          cards end at different heights reads as one of them having failed to
          load. `stretch` plus `flex: 1` on the cards is what makes both bottoms
          land on the same line. */}
      <View style={pairedDashboard ? { flexDirection: "row", alignItems: "stretch", gap: spacing.lg } : undefined}>
        <View style={pairedDashboard ? { flex: 1, minWidth: 0 } : undefined}>
          {/* Upcoming payments */}
          <SectionHeader>{tr.dashboard.upcoming}</SectionHeader>
      {dataStatus === "error" ? null : dataStatus === "loading" ? (
        /* The panel keeps its shape instead of leaving a gap that the real
           card later pushes open. Three rows is what an ordinary account
           shows, so the page settles rather than jumps. */
        <Card style={pairedDashboard ? { flex: 1 } : undefined}>
          {[0, 1, 2].map((row) => (
            <Row key={row} gap={spacing.md} style={{ alignItems: "center", paddingVertical: spacing.md - 2 }}>
              <Skeleton width={24} height={24} radius={radius.sm} />
              <View style={{ flex: 1, gap: 6 }}>
                <Skeleton width="60%" height={type.body.fontSize} />
                <Skeleton width="40%" height={type.small.fontSize} />
              </View>
              <Skeleton width={STATUS_W} height={controlSize.minimumTarget} radius={radius.md} />
            </Row>
          ))}
        </Card>
      ) : (late.length > 0 || upcoming.length > 0) && selfPersonId ? (
        <Card style={pairedDashboard ? { flex: 1 } : undefined}>
          <View style={pairedDashboard ? { flexGrow: 1 } : undefined}>
            {dashboardLate.map((e) => (
              <ListRow
                key={e.id}
                icon={e.direction === "in" ? ArrowDownLeft : ArrowUpRight}
                iconColor={palette.error}
                title={nameOf(e)}
                subtitle={`${tr.dashboard.late} · ${dateLabel(e.dueDate)} · ${amountFragment(e)}`}
                right={(
                  <View style={{ width: STATUS_W }}>
                    <Button
                      size="sm"
                      label={needsAmountEntry(e) ? tr.subs.enterAmount : e.direction === "in" ? tr.dashboard.received : tr.dashboard.markPaid}
                      variant="secondary"
                      tone={e.direction === "in" ? "positive" : "primary"}
                      loading={confirmingId === e.id}
                      disabled={confirmingId != null}
                      onPress={() => needsAmountEntry(e) ? setAmountEditing(e) : setPaying(e)}
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
                subtitle={`${timelineTypeLabel(u.sourceType)} · ${tr.dashboard.inDays(daysBetweenISO(today, u.date))} · ${amountFragment(u)}`}
                right={u.kind === "expected" && u.expectedId ? (
                  <View style={{ width: STATUS_W }}>
                    <Button
                      size="sm"
                      label={u.amountIsEstimated ? tr.subs.enterAmount : u.direction === "in" ? tr.dashboard.received : tr.dashboard.markPaid}
                      variant="secondary"
                      tone={u.direction === "in" ? "positive" : "primary"}
                      loading={confirmingId === u.expectedId}
                      disabled={confirmingId != null}
                      onPress={() => {
                        const expectedItem = expected.find((item) => item.id === u.expectedId);
                        if (expectedItem) {
                          if (needsAmountEntry(expectedItem)) setAmountEditing(expectedItem);
                          else setPaying(expectedItem);
                        }
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
          <Row gap={spacing.sm}>
            <View style={{ flex: 1 }}>
              <Button label={tr.dashboard.allUpcoming} variant="ghost" size="sm" onPress={() => router.push("/upcoming" as Href)} />
            </View>
            {/* The inbox is the actionable half of the same data: what is
                waiting for a decision, rather than the whole calendar. */}
            <View style={{ flex: 1 }}>
              <Button
                testID="dashboard-attention-link"
                label={tr.attention.title}
                variant="ghost"
                size="sm"
                onPress={() => router.push("/attention" as Href)}
              />
            </View>
          </Row>
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
                      <View style={{ width: 6, height: 6, borderRadius: circle(6), backgroundColor: palette.surfaceStrong }} />
                      <View style={{ width: 6, height: 6, borderRadius: circle(6), backgroundColor: palette.surfaceStrong }} />
                      <View style={{ width: 6, height: 6, borderRadius: circle(6), backgroundColor: palette.primary }} />
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
                    <View style={{ width: 5, height: 5, borderRadius: circle(5), backgroundColor: palette.surfaceStrong }} />
                    <View style={{ width: 5, height: 5, borderRadius: circle(5), backgroundColor: palette.surfaceStrong }} />
                    <View style={{ width: 5, height: 5, borderRadius: circle(5), backgroundColor: palette.primary }} />
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

        <View style={pairedDashboard ? { flex: 1, minWidth: 0 } : undefined}>
          <MarketsCard fill={pairedDashboard} desktopColumns={marketDesktopColumns} />
        </View>
      </View>

    </Screen>
  );
}
