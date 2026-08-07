import React, { useMemo, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import ArrowDownToLine from "lucide-react-native/icons/arrow-down-to-line";
import ArrowUpFromLine from "lucide-react-native/icons/arrow-up-from-line";
import Bitcoin from "lucide-react-native/icons/bitcoin";
import ChartNoAxesCombined from "lucide-react-native/icons/chart-no-axes-combined";
import Coins from "lucide-react-native/icons/coins";
import Landmark from "lucide-react-native/icons/landmark";
import PackagePlus from "lucide-react-native/icons/package-plus";
import Pencil from "lucide-react-native/icons/pencil";
import Plus from "lucide-react-native/icons/plus";
import Sparkles from "lucide-react-native/icons/sparkles";
import Trash2 from "lucide-react-native/icons/trash-2";
import Umbrella from "lucide-react-native/icons/umbrella";
import WalletCards from "lucide-react-native/icons/wallet-cards";
import type { LucideIcon } from "lucide-react-native";
import { deleteInvestmentOperation, restoreInvestmentOperation } from "../../../data/repo";
import {
  useAllTransactionsState,
  useInvestmentCategoriesState,
  useInvestmentOperationsState,
  useInvestmentProductsState,
  useInvestmentProfilesState,
  useInvestmentWallet,
  usePersonsState,
  useUserId,
} from "../../../data/hooks";
import { combineLiveStates } from "../../../data/live-state";
import {
  type InvestmentAssetType,
} from "../../../domain/investments";
import { formatMinorCompact } from "../../../domain/money";
import { todayISO } from "../../../domain/dates";
import { tr } from "../../../i18n/tr";
import {
  Amount,
  Body,
  Button,
  Card,
  ChipPicker,
  DataStateNotice,
  EmptyState,
  Heading,
  HeroCard,
  MetricStrip,
  Row,
  Screen,
  SectionHeader,
  Spread,
  IconButton,
} from "../../../ui/components";
import { Donut, useSeriesColors } from "../../../ui/charts";
import { useDrawIn } from "../../../ui/motion-primitives";
import { interactionSurface } from "../../../ui/interaction";
import { actionTileMetrics, circle, density, font, iconSize, motion, radius, spacing, type, useTheme } from "../../../ui/theme";
import { useContentWidth, useMeasuredWidth } from "../../../ui/viewport";
import { WorkspaceGrid } from "../../../ui/workspace-layout";
import { appAlert, appConfirm } from "../../../ui/dialog";
import { scheduleSync } from "../../../sync/engine";
import { userMessage } from "../../../domain/user-error";
import { useUndo } from "../../../ui/undo";

const ASSET_TYPES: InvestmentAssetType[] = ["metal", "currency", "equity", "fund", "crypto", "pension"];
const ASSET_ICONS: Record<InvestmentAssetType, LucideIcon> = {
  metal: Coins,
  currency: WalletCards,
  equity: ChartNoAxesCombined,
  fund: Landmark,
  crypto: Bitcoin,
  pension: Umbrella,
};

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
  const Icon = direction === "in" ? ArrowDownToLine : ArrowUpFromLine;
  const iconColor = direction === "in" ? palette.positiveText : palette.secondaryText;
  const iconBackground = direction === "in" ? palette.success + "20" : palette.secondarySoft;
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
          backgroundColor: iconBackground,
        }}
      >
        <Icon accessible={false} size={14} color={iconColor} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.small, { color: palette.textSecondary }]}>{label}</Text>
        <Amount
          minor={minor}
          colorized={false}
          color={minor === 0 ? palette.textSecondary : direction === "in" ? palette.positiveText : palette.text}
          accessibilityLabel={`${label}: ${formatMinorCompact(minor)}`}
          // Zero is not a gain. The inbound metric was painted green whatever
          // it held, so a wallet that had never received a transfer still
          // reported "₺0,00" in the colour this app reserves for money coming
          // in.
          style={[type.amountSm, { marginTop: 1, textAlign: "left" }]}
        />
      </View>
    </View>
  );
}

function AllocationStrip({
  slices,
  totalMinor,
}: {
  slices: { label: string; valueMinor: number; color: string }[];
  totalMinor: number;
}) {
  const { palette } = useTheme();
  const ordered = [...slices].filter((slice) => slice.valueMinor > 0).sort((a, b) => b.valueMinor - a.valueMinor);
  const visible = ordered.length <= 3
    ? ordered
    : [
        ...ordered.slice(0, 2),
        {
          label: tr.common.other,
          valueMinor: ordered.slice(2).reduce((sum, slice) => sum + slice.valueMinor, 0),
          color: palette.textSecondary,
        },
      ];
  const summary = ordered.length === 0
    ? `${tr.investments.distribution}. ${tr.investments.distributionEmpty}`
    : `${tr.investments.distribution}. ${ordered.map((slice) => `${slice.label}: ${formatMinorCompact(slice.valueMinor)}`).join(", ")}.`;
  const draw = useDrawIn(true, motion.draw, visible.map((slice) => `${slice.label}:${slice.valueMinor}`).join("|"));
  return (
    <View
      testID="investment-mobile-allocation"
      accessible
      accessibilityRole="image"
      accessibilityLabel={summary}
      style={{ marginTop: spacing.lg }}
    >
      <Text style={[type.small, { color: palette.textSecondary }]}>{tr.investments.distribution}</Text>
      {/* A ranked bar per holding, not one stacked strip.
          The strip answered "what is the split" and nothing else: three clay
          tones in a 9pt track cannot be compared to each other, and the legend
          under it repeated every label to say so. A row per holding compares
          them directly — the longest bar IS the largest position — and costs
          the same height, which is what keeps the actions under this card above
          the fold on a phone. */}
      <View accessible={false} style={{ marginTop: spacing.sm, gap: spacing.sm }}>
        {visible.map((slice) => {
          const share = totalMinor > 0 ? slice.valueMinor / totalMinor : 0;
          return (
            <View key={slice.label} style={{ gap: 3 }}>
              <Row gap={spacing.sm}>
                <Text
                  style={[type.small, { flex: 1, minWidth: 0, color: palette.textSecondary, fontSize: type.caption.fontSize }]}
                >
                  {slice.label}
                </Text>
                <Text style={[type.amountSm, { color: palette.text, fontSize: type.caption.fontSize }]}>
                  %{Math.round(share * 100)}
                </Text>
              </Row>
              <View
                style={{
                  height: 7,
                  borderRadius: radius.full,
                  backgroundColor: palette.surfaceStrong,
                  overflow: "hidden",
                }}
              >
                <Animated.View
                  testID="investment-allocation-fill"
                  style={{
                    // A holding under one percent is still a holding: it keeps
                    // a visible stub rather than rounding away to nothing.
                    width: draw.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["0%", `${Math.max(share * 100, slice.valueMinor > 0 ? 2 : 0)}%`],
                    }),
                    height: "100%",
                    borderRadius: radius.full,
                    backgroundColor: slice.color,
                  }}
                >
                  <View />
                </Animated.View>
              </View>
            </View>
          );
        })}
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
  disabled = false,
  onPress,
}: {
  icon: React.ComponentType<{ size?: number; color?: string; accessible?: boolean; strokeWidth?: number }>;
  label: string;
  /** What the action does to the money, in three words. */
  caption: string;
  tone: "primary" | "secondary" | "quiet";
  compact: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const metrics = actionTileMetrics(compact);
  const foreground = tone === "primary"
    ? palette.primaryText
    : tone === "secondary"
      ? palette.secondaryText
      : palette.textSecondary;
  const iconBackground = tone === "primary"
    ? palette.primarySoft
    : tone === "secondary"
      ? palette.secondarySoft
      : palette.surfaceStrong;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${caption}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={(state) => ({
        flex: 1,
        minWidth: 0,
        alignItems: "center",
        height: metrics.height,
        padding: metrics.padding,
        gap: metrics.gap,
        justifyContent: "flex-start",
        borderRadius: radius.md,
        ...interactionSurface(palette, state),
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
        <Icon accessible={false} size={iconSize.compact} color={foreground} strokeWidth={2.2} />
      </View>
      <View
        testID="investment-action-label"
        style={{ width: "100%", height: metrics.labelHeight, alignItems: "center", justifyContent: "flex-start" }}
      >
        <Text
          style={[type.micro, { color: disabled ? palette.textMuted : palette.text, lineHeight: metrics.lineBox, textAlign: "center", fontFamily: font.semibold }]}
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
  // The hero composes itself from the card it is actually in. Reading the page
  // column instead was fine at 100% zoom and wrong everywhere else: at 175% the
  // same 1920 monitor reports 1097 CSS px, the layout picked its widest
  // arrangement, and a 204px ring sat in a column that no longer had room for
  // it beside the balance. A measured box is right at every zoom, on a tablet,
  // and inside whatever column the card ends up in.
  const [heroWidth, onHeroLayout] = useMeasuredWidth(0);
  const width = useContentWidth();
  const heroBox = heroWidth > 0 ? heroWidth - density.dashboard.cardPadding * 2 : width;
  const compact = heroBox < 520;
  const desktop = heroBox >= 860;
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
  const state = useInvestmentWallet();
  const productById = new Map(productsState.data.map((product) => [product.id, product]));
  const deleteOperation = async (id: string) => {
    if (!(await appConfirm(tr.common.delete, "Bu hareket kaldırıldığında cüzdan ve maliyetler yeniden hesaplanır.", { confirmLabel: tr.common.delete, danger: true }))) return;
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
        <HeroCard style={{ minHeight: width >= 760 ? 420 : 340, marginTop: spacing.md }}>
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
        <DataStateNotice status={status} retry={retry} />
      </Screen>
    );
  }

  const active = state.products.filter((product) => product.active);
  const activeAssetTypes = ASSET_TYPES.filter((assetType) => active.some((product) => product.assetType === assetType));
  const visibleActive = productFilter === "all"
    ? active
    : active.filter((product) => product.assetType === productFilter);
  const byType = new Map<InvestmentAssetType, number>();
  for (const product of active) byType.set(product.assetType, (byType.get(product.assetType) ?? 0) + product.costMinor);
  const slices = [
    ...(state.cashMinor > 0 ? [{ label: tr.investments.cash, valueMinor: state.cashMinor, color: palette.surfaceStrong }] : []),
    ...ASSET_TYPES.flatMap((assetType, index) => {
      const valueMinor = byType.get(assetType) ?? 0;
      return valueMinor > 0
        ? [{ label: tr.investments.types[assetType], valueMinor, color: colors[index] ?? colors[0] }]
        : [];
    }),
  ];
  const totalCapital = state.cashMinor + state.investedCostMinor;
  const transferCategoryIds = new Set(
    categoriesState.data.filter((category) => category.isTransfer).map((category) => category.id),
  );
  const walletTransfers = transactionsState.data.filter((transaction) =>
    transaction.type === "transfer"
    && transaction.status === "realized"
    && transaction.deletedAt == null
    && selfPersonIds.has(transaction.personId)
    && transaction.effectiveDate >= profile!.startedOn
    && transaction.effectiveDate <= todayISO()
    && transaction.categoryId != null
    && transferCategoryIds.has(transaction.categoryId),
  );
  const transferredInMinor = walletTransfers.reduce(
    (sum, transaction) => sum + Math.max(0, transaction.amountTryMinor),
    0,
  );
  const transferredOutMinor = walletTransfers.reduce(
    (sum, transaction) => sum + Math.max(0, -transaction.amountTryMinor),
    0,
  );
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
        // Two transfer lines read as rows under the balance they belong to.
        // Side by side they were a second, unrelated strip; only a phone, where
        // a column would cost two more rows of height, keeps them paired.
        flexDirection: compact ? "row" : "column",
        gap: compact ? spacing.sm : spacing.md,
        marginTop: spacing.lg,
        padding: spacing.md,
        borderRadius: radius.md,
        backgroundColor: palette.surfaceAlt,
      }}
    >
      <TransferMetric direction="in" label={tr.investments.transferredIn} minor={transferredInMinor} stacked={!compact} />
      <TransferMetric direction="out" label={tr.investments.transferredOut} minor={transferredOutMinor} stacked={!compact} />
    </View>
  );
  const portfolioMetrics = (
    <MetricStrip
      testID="investment-portfolio-metrics"
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
      <DataStateNotice status={status} retry={retry} />
      <View testID="investment-wallet-summary">
        <HeroCard style={{ marginBottom: spacing.lg }} onLayout={onHeroLayout}>
          {compact ? (
            <>
              {cashSummary}
              <AllocationStrip slices={slices} totalMinor={totalCapital} />
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
            <>
              {/* The middle band is the desktop arrangement at a smaller scale,
                  not a third layout: balance and its transfer lines in one
                  column, the ring in the other. The transfers used to sit in a
                  full-width strip below both, which read as a separate section
                  rather than as two facts about the balance above them. */}
              <View style={{ flexDirection: "row", alignItems: "stretch", gap: spacing.lg }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  {cashSummary}
                  {transferSummary}
                </View>
                <View testID="investment-distribution-chart" style={{ flex: 1, minWidth: 0, justifyContent: "center" }}>
                  {distributionChart}
                </View>
              </View>
              {portfolioMetrics}
            </>
          )}
        </HeroCard>
      </View>

      {/* These four are the page's primary actions and they belong to the
          wallet above them, so they span the same width the hero does. Bounded
          to a cluster they read as a half-empty second row under a full-width
          card — the tiles themselves keep their own even share of the row. */}
      <View
        testID="investment-actions"
        // The band spans the page and its four tiles share it evenly, the same
        // rule the ledger's toolbar follows: a control that changes where it
        // lives every time the window does is a control the user has to find
        // again. Bounded, it read as a narrow island under a full-width card.
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
        <InvestmentQuickAction compact={compact} icon={PackagePlus} tone="primary" label={tr.investments.addProduct} caption={tr.investments.addProductCaption} onPress={() => router.push("/investments/product")} />
        <InvestmentQuickAction compact={compact} icon={ArrowDownToLine} tone="secondary" label={tr.investments.addExisting} caption={tr.investments.addExistingCaption} onPress={() => router.push({ pathname: "/investments/operation", params: { kind: "existing" } })} />
        <InvestmentQuickAction compact={compact} icon={ArrowUpFromLine} tone="quiet" label={tr.investments.sell} caption={tr.investments.sellCaption} disabled={active.length === 0} onPress={() => router.push({ pathname: "/investments/operation", params: { kind: "sell" } })} />
        <InvestmentQuickAction compact={compact} icon={WalletCards} tone="secondary" label={tr.investments.refundShort} caption={tr.investments.refundCaption} disabled={state.cashMinor <= 0} onPress={() => router.push({ pathname: "/transaction", params: { intent: "investment-refund" } })} />
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
            const ProductIcon = ASSET_ICONS[product.assetType];
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
                  <View style={{ maxWidth: compact ? "42%" : "55%", paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.full, backgroundColor: palette.surfaceAlt }}>
                    <Text style={[type.small, { color: palette.primaryText, fontFamily: font.semibold, textAlign: "center" }]}>
                      {product.quantity ? tr.investments.quantityHeld(product.quantity) : tr.investments.quantityUnknown}
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
                    value={product.realizedProfitLossMinor === 0 ? (
                      <Text style={[type.amountSm, { color: palette.textSecondary }]}>—</Text>
                    ) : (
                      <Amount
                        minor={product.realizedProfitLossMinor}
                        colorized={false}
                        color={resultPositive ? palette.positiveText : palette.negativeText}
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
              const labels = {
                existing: tr.investments.operationTitle.existing,
                buy: tr.investments.operationTitle.buy,
                sell: tr.investments.operationTitle.sell,
                contribution: tr.investments.operationTitle.contribution,
              };
              return (
                <View
                  key={operation.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.sm,
                    paddingVertical: spacing.sm,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: palette.border + "70",
                  }}
                >
                  <View style={{ width: 8, height: 36, borderRadius: 4, backgroundColor: movementTone.line }} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.label, { color: palette.text }]}>{product?.name ?? tr.investments.product}</Text>
                    <Text style={[type.small, { color: palette.textSecondary }]}>{labels[operation.kind]} · {operation.operationDate}</Text>
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
                  <IconButton label={tr.common.edit} icon={Pencil} onPress={() => router.push({ pathname: "/investments/operation", params: { id: operation.id, kind: operation.kind } })} />
                  <IconButton label={tr.common.delete} icon={Trash2} tone="danger" onPress={() => void deleteOperation(operation.id)} />
                </View>
              );
            })}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
