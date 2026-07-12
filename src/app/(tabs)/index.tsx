/** Dashboard: catch-up banner, actual vs projected balance (§2.7),
 *  upcoming/late expected items with confirm, distribution, trend. */

import React, { useEffect } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { ArrowDownLeft, ArrowUpRight, CalendarClock, ChevronRight, History, PartyPopper, Plus, TrendingDown, TrendingUp } from "lucide-react-native";
import { distributionForRange, fixedVsVariable } from "../../domain/analytics";
import { projectedBalance } from "../../domain/balance";
import { firstDayOf, lastDayOf, monthKeyOf, monthOf, todayISO, yearOf } from "../../domain/dates";
import { formatMinor } from "../../domain/money";
import { dateLabel, monthLabel, tr } from "../../i18n/tr";
import {
  daysBetween,
  useCategories,
  useLastEntryInfo,
  useLedger,
  usePendingExpected,
  usePersons,
  useRecurringIncomes,
  useSubscriptions,
  useUserId,
} from "../../data/hooks";
import { confirmExpected, FxRateUnavailableError, revertExpected } from "../../data/repo";
import { connectMarkets, marketSellRateTry, MARKET_SYMBOLS, useMarkets } from "../../services/markets";
import { convertToTryMinor } from "../../domain/fx";
import { lookupRate } from "../../services/fx-fetch";
import { appAlert } from "../../ui/dialog";
import { scheduleSync } from "../../sync/engine";
import { Amount, Body, Button, Card, EmptyState, Heading, HeroCard, ListRow, Row, Screen, SectionHeader, Spread, STATUS_W, StatusPill } from "../../ui/components";
import { Bars, Donut, SplitBar, useSeriesColors } from "../../ui/charts";
import { BrandMark } from "../../ui/brand";
import { FirstRunTour } from "../../ui/tour";
import { useUndo } from "../../ui/undo";
import { radius, spacing, type, useTheme } from "../../ui/theme";

function MarketsCard() {
  const { palette } = useTheme();
  const { prices, status } = useMarkets();
  useEffect(() => connectMarkets(), []);
  if (status === "error" || Object.keys(prices).length === 0) return null;

  const priceText = (v: number) =>
    new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  return (
    <Card>
      <Spread style={{ marginBottom: spacing.xs }}>
        <Heading style={{ marginVertical: 0 }}>{tr.markets.title}</Heading>
        <Row gap={spacing.xs}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: palette.positive }} />
          <Text style={[type.small, { color: palette.textMuted }]}>{tr.markets.source}</Text>
        </Row>
      </Spread>
      {/* column headers over the price columns */}
      <Spread style={{ marginBottom: spacing.xs }}>
        <View />
        <Row gap={spacing.sm}>
          <Text style={[type.small, { color: palette.textMuted, minWidth: 78, textAlign: "right" }]}>{tr.markets.buy}</Text>
          <Text style={[type.small, { color: palette.textMuted, minWidth: 92, textAlign: "right" }]}>{tr.markets.sell}</Text>
          <View style={{ width: 15 }} />
        </Row>
      </Spread>
      {MARKET_SYMBOLS.map(({ code, label }) => {
        const p = prices[code];
        if (!p) return null;
        return (
          <Spread key={code} style={{ paddingVertical: spacing.sm - 2 }}>
            <Body>{label}</Body>
            <Row gap={spacing.sm}>
              <Text style={[type.amountSm, { color: palette.textMuted, minWidth: 78, textAlign: "right" }]}>{priceText(p.buyTry)}</Text>
              <Text style={[type.amount, { color: palette.text, minWidth: 92, textAlign: "right" }]}>
                {priceText(p.sellTry)} ₺
              </Text>
              {p.direction === "up" ? (
                <TrendingUp size={15} color={palette.positive} />
              ) : p.direction === "down" ? (
                <TrendingDown size={15} color={palette.negative} />
              ) : (
                <View style={{ width: 15 }} />
              )}
            </Row>
          </Spread>
        );
      })}
    </Card>
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
  const today = todayISO();
  const year = yearOf(today);
  const month = monthKeyOf(today);
  const bundle = useLedger(year);
  const categories = useCategories();
  const persons = usePersons();
  const expected = usePendingExpected();
  const subscriptions = useSubscriptions();
  const incomes = useRecurringIncomes();
  const lastEntry = useLastEntryInfo();
  const router = useRouter();
  const colors = useSeriesColors();
  const undo = useUndo();
  const { width } = useWindowDimensions();
  const { palette } = useTheme();

  // No manual useMemo here: the React Compiler (enabled app-wide) memoizes
  // these derivations automatically and bails out when useMemo is hand-rolled.
  // Reuse the ledger's already-built txLike instead of running a second
  // full-table live query (useAllTransactions) + toTxLike on the same data.
  const txLike = bundle?.txLike ?? [];
  const selfPersonId = persons.find((p) => p.isSelf)?.id;

  const pendingItems = expected.filter((e) => e.status === "pending" || e.status === "late");
  const late = pendingItems.filter((e) => e.status === "late" || (e.status === "pending" && e.dueDate < today));

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name;
  const nameOf = (e: (typeof expected)[number]) =>
    subscriptions.find((s) => s.id === e.refId)?.name ?? incomes.find((i) => i.id === e.refId)?.name ?? tr.common.paymentFallback;
  // Convert an expected amount to TRY minor for projections using the best
  // available rate (live Harem → cached TCMB). Returns null when no rate is
  // known — such an item is left out of the projection rather than counted at
  // its raw foreign value (which would silently distort the figure). Foreign
  // subscriptions were previously dropped entirely; now they count when a rate
  // exists (the common USD/EUR case, once TCMB has been cached).
  const expectedTryMinor = (currency: string, amountMinor: number): number | null => {
    if (currency === "TRY") return amountMinor;
    const rateTry = marketSellRateTry(currency) ?? lookupRate(userId, currency)?.rate.rateTry ?? null;
    return rateTry == null ? null : convertToTryMinor(amountMinor, rateTry);
  };
  // Upcoming = the next ~31 days of everything you'll pay/receive on a fixed
  // schedule: subscriptions + recurring incomes (expected items) AND your own
  // future-dated one-off entries (a bill you scheduled ahead). A month-wide
  // window so each monthly obligation shows once, auto-pay or not.
  const upcoming: {
    key: string;
    kind: "expected" | "tx";
    expectedId?: string;
    direction: "in" | "out";
    name: string;
    typeLabel: string;
    amountMinor: number;
    currency: string;
    date: string;
  }[] = [
    ...pendingItems
      .filter((e) => e.status === "pending" && e.dueDate >= today && daysBetween(today, e.dueDate) <= 31)
      .map((e) => ({
        key: e.id,
        kind: "expected" as const,
        expectedId: e.id,
        direction: e.direction,
        name: nameOf(e),
        typeLabel:
          e.direction === "in"
            ? tr.dashboard.expectedIncome
            : catName(subscriptions.find((s) => s.id === e.refId)?.categoryId ?? null) ?? tr.subs.title,
        amountMinor: e.amountMinor,
        currency: e.currency,
        date: e.dueDate,
      })),
    ...txLike
      // Aggregates are whole-month totals (bulk / cell entries anchored to a
      // nominal mid-month day), NOT scheduled individual payments — they must
      // never appear as "upcoming payments".
      .filter((t) => t.personIsSelf && !t.isAggregate && t.status === "pending" && t.effectiveDate > today && daysBetween(today, t.effectiveDate) <= 31)
      .map((t) => ({
        key: t.id,
        kind: "tx" as const,
        direction: (t.type === "income" ? "in" : "out") as "in" | "out",
        name: catName(t.categoryId) ?? tr.dashboard.scheduledTx,
        typeLabel: tr.dashboard.scheduledTx,
        amountMinor: t.amountTryMinor,
        currency: "TRY",
        date: t.effectiveDate,
      })),
  ]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 12);

  // One honest number: everything still owed on a fixed schedule this month —
  // unpaid subscriptions plus installments/future-dated expenses due by month end.
  const monthEnd = lastDayOf(month);
  const remainingFixedMinor =
    pendingItems
      .filter((e) => e.direction === "out" && e.dueDate >= today && e.dueDate <= monthEnd)
      .reduce((sum, e) => sum + (expectedTryMinor(e.currency, e.amountMinor) ?? 0), 0) +
    txLike
      .filter((t) => t.personIsSelf && t.type === "expense" && t.status === "pending" && t.effectiveDate >= today && t.effectiveDate <= monthEnd)
      .reduce((sum, t) => sum + t.amountTryMinor, 0);

  // Future pending transactions + unpaid expected items (installment tx are
  // already pending transactions, so expected covers only subs/incomes → no double count).
  const projected = bundle
    ? projectedBalance(
        bundle.actualBalanceMinor,
        [
          ...txLike
            .filter((t) => t.personIsSelf && t.status === "pending" && t.effectiveDate > today)
            .map((t) => ({ direction: (t.type === "income" ? "in" : "out") as "in" | "out", amountTryMinor: t.amountTryMinor, date: t.effectiveDate })),
          ...pendingItems
            .filter((e) => e.dueDate >= today)
            .flatMap((e) => {
              const m = expectedTryMinor(e.currency, e.amountMinor);
              return m == null ? [] : [{ direction: e.direction, amountTryMinor: m, date: e.dueDate }];
            }),
        ],
        lastDayOf(month),
      )
    : null;

  const dist = distributionForRange(txLike, firstDayOf(month), lastDayOf(month), today);
  const fv = fixedVsVariable(txLike, firstDayOf(month), lastDayOf(month), today);

  const donutEntries = [...dist.expenseByCategory.entries()]
    .map(([id, v]) => ({ label: categories.find((c) => c.id === id)?.name ?? tr.common.none, valueMinor: v }))
    .sort((a, b) => b.valueMinor - a.valueMinor);
  const donutRest = donutEntries.slice(7).reduce((sum, e) => sum + e.valueMinor, 0);
  const donutSlices = [
    ...donutEntries.slice(0, 7).map((e, i) => ({ ...e, color: colors[i % colors.length] })),
    ...(donutRest > 0 ? [{ label: tr.common.other, valueMinor: donutRest, color: colors[7] }] : []),
  ];

  const trendMonths = bundle ? bundle.ledger.filter((m) => yearOf(m.month) === year && m.month <= month) : [];
  // Grouped income-vs-expense bars read far clearer than three overlapping
  // lines where a cumulative balance dwarfed the monthly flows.
  const trendGroups =
    trendMonths.length >= 2
      ? trendMonths.map((m) => ({ label: tr.months[monthOf(m.month) - 1].slice(0, 3), values: [m.incomeMinor, m.expenseMinor] }))
      : null;
  const thisMonthNet = trendMonths.find((m) => m.month === month);

  // One confirmation at a time: the button shows a spinner while the write is
  // in flight, so a double-tap can't submit the same expected item twice.
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  const confirm = async (e: (typeof expected)[number]) => {
    if (!selfPersonId || confirmingId) return;
    setConfirmingId(e.id);
    try {
      const sub = subscriptions.find((s) => s.id === e.refId);
      const income = incomes.find((i) => i.id === e.refId);
      await confirmExpected(userId, e.id, {
        personId: sub?.personId ?? income?.personId ?? selfPersonId,
        categoryId: sub?.categoryId ?? income?.categoryId ?? null,
      });
      scheduleSync(userId);
      undo.show(`${nameOf(e)} ✓`, () => void revertExpected(userId, e.id));
    } catch (err) {
      // Foreign-currency item confirmed before any FX rate was cached: tell the
      // user to retry online instead of writing a corrupt TRY amount.
      if (err instanceof FxRateUnavailableError) void appAlert(tr.errors.fxUnavailable);
      else {
        console.error("[confirm]", err);
        void appAlert(tr.errors.saveFailed);
      }
    } finally {
      setConfirmingId(null);
    }
  };

  const projectedDelta = bundle && projected != null ? projected - bundle.actualBalanceMinor : null;

  return (
    <Screen title={greeting()} subtitle={dateLabel(today)} leading={<BrandMark size={40} />}>
      <FirstRunTour />
      {/* Catch-up banner */}
      {lastEntry.at != null && lastEntry.daysAgo != null && lastEntry.daysAgo >= 1 ? (
        <Pressable onPress={() => router.push("/reconciliation")} accessibilityRole="button">
          <Card style={{ backgroundColor: palette.warning + "14", borderWidth: 0 }}>
            <Row>
              <History size={20} color={palette.warning} />
              <View style={{ flex: 1 }}>
                <Body>{tr.dashboard.lastEntry(dateLabel(lastEntry.at), tr.dashboard.daysAgo(lastEntry.daysAgo))}</Body>
                <Body muted>{tr.dashboard.catchUp}</Body>
              </View>
              <ChevronRight size={18} color={palette.textMuted} />
            </Row>
          </Card>
        </Pressable>
      ) : null}

      {/* Hero balance */}
      {bundle ? (
        <HeroCard>
          <Text style={[type.label, { color: "rgba(255,255,255,0.75)", textTransform: "uppercase", letterSpacing: 1, fontSize: 11 }]}>
            {tr.dashboard.actualBalance}
          </Text>
          <Text style={[type.amountLg, { color: "#FFFFFF", fontSize: 38, marginTop: spacing.xs }]}>
            {formatMinor(bundle.actualBalanceMinor)}
          </Text>
          {projected != null && projectedDelta != null ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                marginTop: spacing.md,
                backgroundColor: "rgba(255,255,255,0.14)",
                alignSelf: "flex-start",
                borderRadius: radius.full,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs + 2,
              }}
            >
              {projectedDelta >= 0 ? (
                <TrendingUp size={14} color="#FFFFFF" />
              ) : (
                <TrendingDown size={14} color="#FFFFFF" />
              )}
              <Text style={[type.amountSm, { color: "#FFFFFF" }]}>
                {tr.dashboard.projectedBalance} · {formatMinor(projected)}
              </Text>
            </View>
          ) : null}
        </HeroCard>
      ) : null}

      {/* Remaining fixed spend this month — one honest figure */}
      {bundle && remainingFixedMinor > 0 ? (
        <Card>
          <Spread>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Body muted>{tr.dashboard.remainingFixed}</Body>
              <Body muted style={{ fontSize: 11, marginTop: 2 }}>{tr.dashboard.remainingFixedHint}</Body>
            </View>
            <Amount minor={-remainingFixedMinor} />
          </Spread>
        </Card>
      ) : null}

      {/* Quick actions */}
      <Row style={{ marginBottom: spacing.lg }}>
        <View style={{ flex: 1 }}>
          <Button icon={Plus} label={tr.cashflow.addTransaction} onPress={() => router.push("/transaction")} />
        </View>
        <View style={{ flex: 1 }}>
          <Button icon={History} label={tr.dashboard.catchupShort} variant="secondary" onPress={() => router.push("/reconciliation")} />
        </View>
      </Row>

      {/* Upcoming payments */}
      <SectionHeader>{tr.dashboard.upcoming}</SectionHeader>
      {(late.length > 0 || upcoming.length > 0) && selfPersonId ? (
        <Card>
          {late.map((e) => (
            <ListRow
              key={e.id}
              icon={e.direction === "in" ? ArrowDownLeft : ArrowUpRight}
              iconColor={palette.negative}
              title={nameOf(e)}
              subtitle={`${dateLabel(e.dueDate)} · ${formatMinor(e.amountMinor, e.currency)}`}
              right={
                // The "Geciken" status and the confirm button are rendered as
                // one symmetric pair — identical width and height, centred.
                <Row gap={spacing.sm}>
                  <StatusPill label={tr.dashboard.late} color={palette.negative} />
                  <View style={{ width: STATUS_W }}>
                    <Button
                      size="sm"
                      label={e.direction === "in" ? tr.dashboard.received : tr.dashboard.markPaid}
                      variant="secondary"
                      loading={confirmingId === e.id}
                      disabled={confirmingId != null}
                      onPress={() => void confirm(e)}
                    />
                  </View>
                </Row>
              }
            />
          ))}
          {upcoming.map((u) => (
            <ListRow
              key={u.key}
              icon={u.direction === "in" ? ArrowDownLeft : CalendarClock}
              iconColor={u.direction === "in" ? palette.positive : undefined}
              title={u.name}
              subtitle={`${u.typeLabel} · ${tr.dashboard.inDays(daysBetween(today, u.date))} · ${formatMinor(u.amountMinor, u.currency)}`}
              right={
                u.kind === "expected" && u.date <= today && u.expectedId ? (
                  <View style={{ width: STATUS_W }}>
                    <Button
                      size="sm"
                      label={u.direction === "in" ? tr.dashboard.received : tr.dashboard.markPaid}
                      variant="secondary"
                      loading={confirmingId === u.expectedId}
                      disabled={confirmingId != null}
                      onPress={() => {
                        const e = expected.find((x) => x.id === u.expectedId);
                        if (e) void confirm(e);
                      }}
                    />
                  </View>
                ) : undefined
              }
            />
          ))}
        </Card>
      ) : (
        <Card>
          <EmptyState icon={PartyPopper} title={tr.dashboard.noUpcoming} hint={tr.dashboard.upcomingHint} />
        </Card>
      )}

      {/* Live markets (Harem Altın feed) */}
      <MarketsCard />

      {/* Expense distribution */}
      {donutSlices.length > 0 ? (
        <Card>
          <Heading style={{ marginTop: 0 }}>
            {tr.dashboard.distribution} · {monthLabel(month)}
          </Heading>
          <Donut slices={donutSlices} />
          {dist.transferTotalMinor > 0 ? (
            <Body muted style={{ marginTop: spacing.sm }}>
              {tr.dashboard.investmentAside}: {formatMinor(dist.transferTotalMinor)}
            </Body>
          ) : null}
        </Card>
      ) : null}

      {/* Fixed vs variable */}
      {fv.fixedMinor + fv.variableMinor > 0 ? (
        <Card>
          <Heading style={{ marginTop: 0 }}>{tr.dashboard.fixedVsVariable}</Heading>
          <SplitBar
            parts={[
              { label: tr.dashboard.fixed, valueMinor: fv.fixedMinor, color: colors[0] },
              { label: tr.dashboard.variable, valueMinor: fv.variableMinor, color: colors[2] },
            ]}
          />
        </Card>
      ) : null}

      {/* Monthly income vs expense */}
      {trendGroups ? (
        <Card>
          <Spread style={{ marginBottom: spacing.xs }}>
            <Heading style={{ marginTop: 0, marginBottom: 0 }}>{tr.dashboard.trend}</Heading>
            {thisMonthNet ? (
              <Body muted style={{ fontSize: 12 }}>{tr.dashboard.trendNet(formatMinor(thisMonthNet.incomeMinor - thisMonthNet.expenseMinor))}</Body>
            ) : null}
          </Spread>
          <Bars
            width={Math.min(width - spacing.lg * 4, 640)}
            groups={trendGroups}
            series={[
              { label: tr.cashflow.income, color: colors[1] },
              { label: tr.cashflow.expense, color: colors[5] },
            ]}
          />
        </Card>
      ) : null}
    </Screen>
  );
}
