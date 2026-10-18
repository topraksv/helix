import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import ArrowDownToLine from "lucide-react-native/icons/arrow-down-to-line";
import ArrowUpFromLine from "lucide-react-native/icons/arrow-up-from-line";
import Landmark from "lucide-react-native/icons/landmark";
import PackagePlus from "lucide-react-native/icons/package-plus";
import Pencil from "lucide-react-native/icons/pencil";
import Plus from "lucide-react-native/icons/plus";
import Sparkles from "lucide-react-native/icons/sparkles";
import Trash from "lucide-react-native/icons/trash";
import WalletCards from "lucide-react-native/icons/wallet-cards";
import {
  deleteInvestmentOperation,
  restoreInvestmentOperation,
} from "../../../data/repo";
import {
  useAllTransactionsState,
  useInvestmentCategoriesState,
  useInvestmentOperationsState,
  useInvestmentProductsState,
  useInvestmentProfilesState,
  useInvestmentWalletSnapshot,
  usePersonsState,
  useUserId,
} from "../../../data/hooks";
import { combineLiveStates } from "../../../data/live-state";
import { INVESTMENT_ASSET_TYPES, type InvestmentAssetType } from "../../../domain/investments";
import { formatMinorCompact } from "../../../domain/money";
import { todayISO } from "../../../domain/dates";
import { dateLabel, tr } from "../../../i18n/tr";
import { Amount, Body, Button, Card, ChipPicker, DataStateNotice, EmptyState, Eyebrow, Heading, HeroCard, IconButton, MetricStrip, Row, Screen, SectionHeader, Spread } from "../../../ui/components";
import { Donut, useSeriesColors, walletDonutSlices } from "../../../ui/charts";
import { interactionSurface } from "../../../ui/interaction";
import { actionTileMetrics, circle, density, font, iconSize, radius, spacing, type, useTheme } from "../../../ui/theme";
import { useContentWidth, useMeasuredWidth } from "../../../ui/viewport";
import { ASSET_TYPE_ICONS } from "../../../ui/category-icon";
import { WorkspaceGrid } from "../../../ui/workspace-layout";
import { appAlert, appConfirm } from "../../../ui/dialog";
import { scheduleSync } from "../../../sync/engine";
import { userMessage } from "../../../domain/user-error";
import { useUndo } from "../../../ui/undo";
import { shouldUseCompactInvestmentHero, shouldUseDesktopInvestmentHero, shouldUseTallInvestmentHero } from "../../../ui/responsive";

// Every peer section inside the wallet uses one 16pt boundary; internal label/value gaps stay smaller.
const INVESTMENT_SECTION_GAP = spacing.lg;

function Stat({
  label,
  value,
  accent,
  compact = false,
}: {
  label: string;
  value: React.ReactNode;
  accent: string;
  compact?: boolean;
}) {
  const { palette } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        minWidth: compact ? 0 : 132,
        minHeight: compact ? 44 : undefined,
        paddingLeft: spacing.sm,
        borderLeftWidth: 3,
        borderLeftColor: accent,
      }}
    >
      <Text
        style={[
          type.small,
          {
            color: palette.textSecondary,
            minHeight: compact ? 24 : 32,
            ...(compact ? { fontSize: type.micro.fontSize, lineHeight: 12 } : null),
          },
        ]}
      >
        {label}
      </Text>
      <View style={{ marginTop: 2 }}>{value}</View>
    </View>
  );
}

function TransferMetric({
  direction,
  label,
  minor,
  stacked = false,
}: {
  direction: "in" | "out";
  label: string;
  minor: number;
  stacked?: boolean;
}) {
  const { palette } = useTheme();
  // Glyphs are wallet-relative (into/out of this wallet). A transfer is neither
  // income nor expense, so neither direction takes positive ink: money into the
  // wallet leaves the spendable balance.
  const Icon = direction === "in" ? ArrowDownToLine : ArrowUpFromLine;
  return (
    <View style={{ flex: stacked ? undefined : 1, width: stacked ? "100%" : undefined, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <View
        accessible={false}
        style={{
          width: 30,
          height: 30,
          flexShrink: 0,
          borderRadius: radius.full,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette.surfaceAlt,
        }}
      >
        <Icon accessible={false} size={14} color={palette.textSecondary} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.small, { color: palette.textSecondary }]}>{label}</Text>
        <Amount
          minor={minor}
          colorized={false}
          color={minor === 0 ? palette.textSecondary : palette.text}
          accessibilityLabel={`${label}: ${formatMinorCompact(minor)}`}
          // Zero is not a gain, so it takes muted ink.
          style={[type.amountSm, { marginTop: 1, textAlign: "left" }]}
        />
      </View>
    </View>
  );
}

function InvestmentQuickAction({
  icon: Icon,
  label,
  caption,
  tone,
  compact,
  disabledReason,
  onPress,
}: {
  icon: React.ComponentType<{ size?: number; color?: string; accessible?: boolean; strokeWidth?: number }>;
  label: string;
  /** What the action does to the money, in three words. */
  caption: string;
  tone: "primary" | "secondary" | "quiet";
  compact: boolean;
  /** Dimmed, yet a tap says why: a dead tile teaches nothing. */
  disabledReason?: string | null;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const disabled = disabledReason != null;
  const metrics = actionTileMetrics(compact);
  const isPrimary = tone === "primary";
  const foreground = isPrimary
    ? palette.onPrimary
    : tone === "secondary"
      ? palette.secondaryText
      : palette.textSecondary;
  const iconBackground = isPrimary
    ? palette.primaryStrong
    : tone === "secondary"
      ? palette.secondarySoft
      : palette.surfaceStrong;
  const iconForeground = disabled ? palette.textMuted : foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${caption}`}
      accessibilityState={{ disabled }}
      accessibilityHint={disabledReason ?? undefined}
      onPress={disabledReason ? () => void appAlert(disabledReason, label) : onPress}
      style={(state) => ({
        flex: 1,
        minWidth: 0,
        alignItems: "center",
        height: metrics.height,
        padding: metrics.padding,
        gap: metrics.gap,
        justifyContent: "flex-start",
        borderRadius: radius.md,
        ...interactionSurface(palette, state, {
          base: isPrimary && !disabled ? palette.primary : palette.surface,
          enabled: !disabled,
        }),
        opacity: disabled ? 0.45 : 1,
        transform: [{ translateY: state.pressed && !disabled ? 1 : 0 }],
      })}
    >
      <View
        testID="investment-action-icon"
        accessible={false}
        style={{
          width: metrics.iconSize,
          height: metrics.iconSize,
          flexShrink: 0,
          borderRadius: radius.full,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: iconBackground,
        }}
      >
        <Icon accessible={false} size={iconSize.compact} color={iconForeground} strokeWidth={2.2} />
      </View>
      <View
        testID="investment-action-label"
        style={{ width: "100%", height: metrics.labelHeight, alignItems: "center", justifyContent: "flex-start" }}
      >
        <Text
          style={[type.micro, { color: disabled ? palette.textMuted : isPrimary ? palette.onPrimary : palette.text, lineHeight: metrics.lineBox, textAlign: "center", fontFamily: font.semibold }]}
        >
          {label}
        </Text>
      </View>
      <View
        testID="investment-action-caption"
        style={{ width: "100%", height: metrics.captionHeight, alignItems: "center", justifyContent: "flex-start" }}
      >
        <Text
          style={[type.micro, { color: palette.textSecondary, lineHeight: metrics.lineBox, textAlign: "center" }]}
        >
          {caption}
        </Text>
      </View>
    </Pressable>
  );
}


export default function InvestmentsScreen() {
  const router = useRouter();
  const userId = useUserId();
  const undo = useUndo();
  // Measured from the card, not the page column, so the layout is right at every zoom.
  const [heroWidth, onHeroLayout] = useMeasuredWidth(0);
  const contentColumn = useContentWidth();
  const heroBox = heroWidth > 0 ? heroWidth - density.dashboard.cardPadding * 2 : contentColumn;
  const compact = shouldUseCompactInvestmentHero(heroBox);
  const desktop = shouldUseDesktopInvestmentHero(heroBox);
  const [productFilter, setProductFilter] = useState<"all" | InvestmentAssetType>("all");
  const { palette } = useTheme();
  const colors = useSeriesColors();
  const profilesState = useInvestmentProfilesState();
  const productsState = useInvestmentProductsState();
  const operationsState = useInvestmentOperationsState();
  const transactionsState = useAllTransactionsState();
  const categoriesState = useInvestmentCategoriesState();
  const personsState = usePersonsState();
  const { status, ready, retry } = combineLiveStates([profilesState, productsState, operationsState, transactionsState, categoriesState, personsState]);
  const profile = profilesState.data[0];
  const selfPersonIds = useMemo(
    () => new Set(personsState.data.filter((person) => person.isSelf).map((person) => person.id)),
    [personsState.data],
  );
  // Hoisted above the early returns to keep hook order unconditional.
  const today = todayISO();
  const transferCategoryIds = useMemo(
    () => new Set(categoriesState.data.filter((category) => category.isTransfer).map((category) => category.id)),
    [categoriesState.data],
  );
  const startedOn = profile?.startedOn;
  const walletTransfers = useMemo(
    () => transactionsState.data.filter((transaction) =>
      transaction.type === "transfer"
      && transaction.status === "realized"
      && transaction.deletedAt == null
      && selfPersonIds.has(transaction.personId)
      && startedOn != null
      && transaction.effectiveDate >= startedOn
      && transaction.effectiveDate <= today
      && transaction.categoryId != null
      && transferCategoryIds.has(transaction.categoryId),
    ),
    [transactionsState.data, selfPersonIds, transferCategoryIds, startedOn, today],
  );
  const transferredInMinor = useMemo(
    () => walletTransfers.reduce((sum, transaction) => sum + Math.max(0, transaction.amountTryMinor), 0),
    [walletTransfers],
  );
  const transferredOutMinor = useMemo(
    () => walletTransfers.reduce((sum, transaction) => sum + Math.max(0, -transaction.amountTryMinor), 0),
    [walletTransfers],
  );
  const wallet = useInvestmentWalletSnapshot();
  const state = wallet.data;
  const productById = new Map(productsState.data.map((product) => [product.id, product]));
  const deleteOperation = async (id: string) => {
    if (!(await appConfirm(tr.investments.deleteOperation, tr.investments.deleteOperationBody, { confirmLabel: tr.common.delete, danger: true }))) return;
    try {
      const snapshot = await deleteInvestmentOperation(userId, id);
      if (!snapshot) return;
      scheduleSync(userId);
      undo.show(tr.investments.operationDeleted, async () => {
        await restoreInvestmentOperation(userId, snapshot);
        scheduleSync(userId);
      });
    } catch (error) {
      void appAlert(userMessage(error, tr.investments.insufficientCash), tr.errors.title);
    }
  };
  if (ready && !profile) {
    return (
      <Screen title={tr.investments.title} width="workspace">
        <HeroCard style={{ minHeight: shouldUseTallInvestmentHero(contentColumn) ? 420 : 340, marginTop: spacing.md }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <View
            accessible={false}
            style={{
              width: 104,
              height: 104,
              borderRadius: circle(104),
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: palette.primarySoft,
              marginBottom: spacing.lg,
            }}
          >
            <View style={{ position: "absolute", width: 82, height: 82, borderRadius: circle(82), borderWidth: 1, borderColor: palette.primary + "65" }} />
            <Landmark size={40} color={palette.primaryText} />
          </View>
          <Heading>{tr.investments.setupTitle}</Heading>
          <Body style={{ textAlign: "center", maxWidth: 520, marginTop: spacing.sm, marginBottom: spacing.lg }}>
            {tr.investments.setupBody}
          </Body>
          <Button icon={Sparkles} label={tr.investments.setupAction} onPress={() => router.push("/investments/setup")} />
        </View>
        </HeroCard>
      </Screen>
    );
  }

  if (!state) {
    return (
      <Screen title={tr.investments.title}>
        {/* A replay refusal (oversold, wallet overdrawn) gets its own message; DataStateNotice covers only read failures. */}
        {status === "ready" ? (
          <EmptyState
            icon={Landmark}
            title={tr.investments.title}
            hint={userMessage(wallet.error, tr.investments.insufficientCash)}
          />
        ) : (
          <DataStateNotice status={status} retry={retry} />
        )}
      </Screen>
    );
  }

  const active = state.products.filter((product) => product.active);
  const activeAssetTypes = INVESTMENT_ASSET_TYPES.filter((assetType) => active.some((product) => product.assetType === assetType));
  const visibleActive = productFilter === "all"
    ? active
    : active.filter((product) => product.assetType === productFilter);
  const byType = new Map<InvestmentAssetType, number>();
  for (const product of active) byType.set(product.assetType, (byType.get(product.assetType) ?? 0) + product.costMinor);
  const slices = walletDonutSlices({
    cashLabel: tr.investments.cash,
    cashMinor: state.cashMinor,
    // The full canonical list, empties included: the position in it is what
    // fixes each type's colour, so filtering here would recolour every type
    // below the one that just went to zero.
    assets: INVESTMENT_ASSET_TYPES.map((assetType) => ({
      label: tr.investments.types[assetType],
      valueMinor: byType.get(assetType) ?? 0,
    })),
    colors,
  });
  const totalCapital = state.cashMinor + state.investedCostMinor;
  const cashSummary = (
    <View style={compact ? { width: "100%" } : { flex: 1, minWidth: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ width: 38, height: 38, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft }}>
          <WalletCards accessible={false} size={19} color={palette.primaryText} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.label, { color: palette.textStrong, fontFamily: font.semibold }]}>{tr.investments.cash}</Text>
          <Text style={[type.small, { color: palette.textSecondary }]}>{tr.investments.readyToInvest}</Text>
        </View>
      </View>
      {compact ? (
        <Amount
          minor={state.cashMinor}
          large
          count
          colorized={false}
          testID="investment-cash-amount"
          accessibilityLabel={`${tr.investments.cash}: ${formatMinorCompact(state.cashMinor)}`}
          style={{ color: palette.textStrong, textAlign: "left", marginTop: spacing.sm }}
        />
      ) : (
        <View testID="investment-cash-amount">
          <Amount
            minor={state.cashMinor}
            large
            count
            colorized={false}
            accessibilityLabel={`${tr.investments.cash}: ${formatMinorCompact(state.cashMinor)}`}
            style={{ fontSize: heroBox >= 700 ? type.amountLg.fontSize : type.amountMd.fontSize, textAlign: "left", marginTop: spacing.sm }}
          />
        </View>
      )}
      {/* The shared compact formatter is the money display policy; a "₺1 Mn" total beside exact parts is that policy, not this line. */}
      <Text style={[type.small, { color: palette.textSecondary, marginTop: spacing.xs }]}>
        {tr.investments.portfolioTotal}: {formatMinorCompact(totalCapital)}
      </Text>
    </View>
  );
  const distributionChart = (
    <Donut
      slices={slices}
      totalMinor={totalCapital}
      // The ring takes a share of the box it is in, so it grows and shrinks
      // with the card instead of stepping between three fixed sizes.
      size={Math.round(Math.min(232, Math.max(112, heroBox * (desktop ? 0.24 : 0.2))))}
    />
  );
  const transferSummary = (
    <View
      testID="investment-transfer-summary"
      style={{
        // Stacked rows at every width: paired, a phone wraps the labels unevenly.
        flexDirection: "column",
        gap: spacing.sm,
        marginTop: INVESTMENT_SECTION_GAP,
        padding: spacing.md,
        borderRadius: radius.md,
        backgroundColor: palette.surfaceAlt,
      }}
    >
      <TransferMetric direction="in" label={tr.investments.transferredIn} minor={transferredInMinor} stacked />
      <TransferMetric direction="out" label={tr.investments.transferredOut} minor={transferredOutMinor} stacked />
    </View>
  );
  const portfolioMetrics = (
    <MetricStrip
      testID="investment-portfolio-metrics"
      align="center"
      style={{ marginTop: INVESTMENT_SECTION_GAP }}
      items={[
        { label: tr.investments.investedCost, minor: state.investedCostMinor, color: palette.text },
        { label: tr.investments.activeProducts, node: <Text style={[type.amount, { color: palette.text }]}>{active.length}</Text> },
        { label: tr.investments.realizedResult, minor: state.realizedProfitLossMinor, color: state.realizedProfitLossMinor >= 0 ? palette.positiveText : palette.negativeText },
      ]}
    />
  );

  return (
    <Screen
      title={tr.investments.title}
      width="workspace"
      right={<Button icon={Plus} size="sm" label={tr.investments.addOperation} onPress={() => router.push({ pathname: "/investments/operation", params: { kind: "buy" } })} />}
    >
      <DataStateNotice status={wallet.error ? "stale" : status} retry={retry} />
      <View testID="investment-wallet-summary">
        <HeroCard style={{ marginBottom: spacing.lg }} onLayout={onHeroLayout}>
          {compact ? (
            <>
              {cashSummary}
              {/* The same ring at every width, so the phone can select a holding too. */}
              <View testID="investment-distribution-chart" style={{ marginTop: INVESTMENT_SECTION_GAP }}>
                <Eyebrow>{tr.investments.distribution}</Eyebrow>
                <View style={{ marginTop: spacing.md }}>
                  <Donut slices={slices} totalMinor={totalCapital} size={168} />
                </View>
              </View>
              {transferSummary}
              {portfolioMetrics}
            </>
          ) : desktop ? (
            <View style={{ flexDirection: "row", alignItems: "stretch", gap: spacing.xl }}>
              <View style={{ flex: 0.82, minWidth: 0 }}>
                {cashSummary}
                {transferSummary}
                {portfolioMetrics}
              </View>
              <View testID="investment-distribution-chart" style={{ flex: 1.18, minWidth: 0, justifyContent: "center" }}>
                {distributionChart}
              </View>
            </View>
          ) : (
            // The desktop arrangement at a smaller scale, so the ring sits at the same height at every breakpoint.
            <View style={{ flexDirection: "row", alignItems: "stretch", gap: spacing.lg }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                {cashSummary}
                {transferSummary}
                {portfolioMetrics}
              </View>
              <View testID="investment-distribution-chart" style={{ flex: 1, minWidth: 0, justifyContent: "center" }}>
                {distributionChart}
              </View>
            </View>
          )}
        </HeroCard>
      </View>

      {/* The wallet's primary actions span the hero's width; tiles share it evenly. */}
      <View
        testID="investment-actions"
        style={{
          width: "100%",
          flexDirection: "row",
          borderRadius: radius.lg,
          overflow: "hidden",
          backgroundColor: palette.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.border + "70",
          marginBottom: spacing.lg,
        }}
      >
        <InvestmentQuickAction compact={compact} icon={PackagePlus} tone="secondary" label={tr.investments.addProduct} caption={tr.investments.addProductCaption} onPress={() => router.push("/investments/product")} />
        <InvestmentQuickAction compact={compact} icon={ArrowDownToLine} tone="secondary" label={tr.investments.addExisting} caption={tr.investments.addExistingCaption} onPress={() => router.push({ pathname: "/investments/operation", params: { kind: "existing" } })} />
        {/* The reason waits for the data: a tile read while the lists are still loading would say there is nothing to sell. */}
        <InvestmentQuickAction compact={compact} icon={ArrowUpFromLine} tone="quiet" label={tr.investments.sell} caption={tr.investments.sellCaption} disabledReason={ready && active.length === 0 ? tr.investments.noProductToSell : null} onPress={() => router.push({ pathname: "/investments/operation", params: { kind: "sell" } })} />
        <InvestmentQuickAction compact={compact} icon={WalletCards} tone="secondary" label={tr.investments.refundShort} caption={tr.investments.refundCaption} disabledReason={ready && state.cashMinor <= 0 ? tr.investments.noCashToMove : null} onPress={() => router.push({ pathname: "/transaction", params: { intent: "investment-refund" } })} />
      </View>

      <SectionHeader>{tr.investments.activeProducts}</SectionHeader>
      {active.length > 0 ? (
        <View testID="investment-product-filter" style={{ marginBottom: spacing.sm }}>
          <Text style={[type.small, { color: palette.textSecondary, marginBottom: spacing.xs }]}>{tr.investments.productFilter}</Text>
          <ChipPicker
            compact
            options={[
              { value: "all" as const, label: tr.common.all },
              ...activeAssetTypes.map((assetType) => ({ value: assetType, label: tr.investments.types[assetType] })),
            ]}
            value={productFilter}
            onChange={setProductFilter}
          />
        </View>
      ) : null}
      {visibleActive.length === 0 ? (
        <Card>
          <EmptyState
            icon={Landmark}
            title={active.length === 0 ? tr.investments.noProducts : tr.investments.noFilteredProducts}
            hint={active.length === 0 ? tr.investments.noProductsHint : tr.investments.noFilteredProductsHint}
          />
        </Card>
      ) : (
        <WorkspaceGrid testID="investment-products" layout="stack">
          {visibleActive.map((product) => {
            const resultPositive = product.realizedProfitLossMinor >= 0;
            const ProductIcon = ASSET_TYPE_ICONS[product.assetType];
            return (
              <Card key={product.id} style={{ marginBottom: spacing.md }}>
                <Spread style={{ alignItems: "center", gap: spacing.sm }}>
                  <View style={{ width: 42, height: 42, flexShrink: 0, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft }}>
                    <ProductIcon accessible={false} size={21} color={palette.primaryText} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.small, { color: palette.textSecondary }]}>{tr.investments.types[product.assetType]}</Text>
                    <Text style={[type.heading, { color: palette.textStrong, marginTop: 2 }]}>{product.name}</Text>
                  </View>
                  <View style={{ maxWidth: compact ? 116 : 220, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.full, backgroundColor: palette.surfaceAlt }}>
                    <Text style={[type.small, { color: palette.primaryText, fontFamily: font.semibold, textAlign: "center" }]}>
                      {product.quantity != null ? tr.investments.quantityHeld(product.quantity) : tr.investments.quantityUnknown}
                    </Text>
                  </View>
                </Spread>
                <Row style={{ marginTop: spacing.lg, alignItems: "stretch", justifyContent: "center" }}>
                  <Stat
                    compact={compact}
                    label={tr.investments.averageCost}
                    accent={palette.border}
                    value={product.averageCostMinor == null ? (
                      <Text style={[type.amountSm, { color: palette.text }]}>—</Text>
                    ) : (
                      <Amount
                        minor={product.averageCostMinor}
                        colorized={false}
                        color={palette.text}
                        accessibilityLabel={formatMinorCompact(product.averageCostMinor)}
                        style={[type.amountSm, { textAlign: "left" }]}
                      />
                    )}
                  />
                  <Stat
                    compact={compact}
                    label={tr.investments.totalCost}
                    accent={palette.primary}
                    value={(
                      <Amount
                        minor={product.costMinor}
                        colorized={false}
                        color={palette.text}
                        accessibilityLabel={formatMinorCompact(product.costMinor)}
                        style={[type.amountSm, { textAlign: "left" }]}
                      />
                    )}
                  />
                  <Stat
                    compact={compact}
                    label={product.realizedProfitLossMinor === 0 ? tr.investments.realizedResult : resultPositive ? tr.investments.realizedProfit : tr.investments.realizedLoss}
                    accent={product.realizedProfitLossMinor === 0 ? palette.border : resultPositive ? palette.positive : palette.negative}
                    /* ₺0,00, not "—": the hero states the same quantity as ₺0,00, and a dash would mean "not recorded". */
                    value={(
                      <Amount
                        minor={product.realizedProfitLossMinor}
                        colorized={false}
                        color={
                          product.realizedProfitLossMinor === 0
                            ? palette.textSecondary
                            : resultPositive ? palette.positiveText : palette.negativeText
                        }
                        accessibilityLabel={formatMinorCompact(product.realizedProfitLossMinor)}
                        style={[type.amountSm, { textAlign: "left" }]}
                      />
                    )}
                  />
                </Row>
              </Card>
            );
          })}
        </WorkspaceGrid>
      )}

      {operationsState.data.length > 0 ? (
        <>
          <SectionHeader>{tr.investments.history}</SectionHeader>
          <Card>
            {[...operationsState.data].reverse().map((operation, index) => {
              const product = productById.get(operation.productId);
              const movementTone = operation.kind === "sell"
                ? { line: palette.positive, text: palette.positiveText }
                : operation.kind === "buy"
                  ? { line: palette.negative, text: palette.negativeText }
                  : operation.kind === "contribution"
                    ? { line: palette.warning, text: palette.warningText }
                    : { line: palette.secondary, text: palette.secondaryText };
              const productName = product?.name ?? tr.investments.product;
              const detail = `${tr.investments.operationTitle[operation.kind]} · ${dateLabel(operation.operationDate)}`;
              // Every row draws the same two icons, so the name is what tells a listener which record they act on —
              // everything the row shows, amount included, or two buys on one day read alike.
              const subject = `${productName} · ${detail} · ${formatMinorCompact(operation.totalMinor)}`;
              return (
                <View
                  key={operation.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.sm,
                    paddingVertical: spacing.sm,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: palette.border + "70",
                  }}
                >
                  <View style={{ width: 8, height: 36, borderRadius: circle(8), backgroundColor: movementTone.line }} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.label, { color: palette.text }]}>{productName}</Text>
                    <Text style={[type.small, { color: palette.textSecondary }]}>{detail}</Text>
                    {compact ? (
                      <Amount
                        minor={operation.totalMinor}
                        colorized={false}
                        color={movementTone.text}
                        accessibilityLabel={formatMinorCompact(operation.totalMinor)}
                        style={[type.amountSm, { marginTop: 3, textAlign: "left" }]}
                      />
                    ) : null}
                  </View>
                  {!compact ? (
                    <Amount
                      minor={operation.totalMinor}
                      colorized={false}
                      color={movementTone.text}
                      accessibilityLabel={formatMinorCompact(operation.totalMinor)}
                      style={[type.amountSm, { fontSize: type.label.fontSize, textAlign: "right" }]}
                    />
                  ) : null}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: spacing.xs }}>
                    <IconButton label={`${tr.common.edit} · ${subject}`} icon={Pencil} onPress={() => router.push({ pathname: "/investments/operation", params: { id: operation.id, kind: operation.kind } })} />
                    <IconButton label={`${tr.investments.deleteOperation} · ${subject}`} icon={Trash} tone="danger" onPress={() => void deleteOperation(operation.id)} />
                  </View>
                </View>
              );
            })}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
