import React, { useMemo } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bitcoin,
  ChartNoAxesCombined,
  Coins,
  Landmark,
  Pencil,
  PackagePlus,
  PiggyBank,
  Plus,
  Sparkles,
  Trash2,
  WalletCards,
  type LucideIcon,
} from "lucide-react-native";
import { deleteInvestmentOperation, restoreInvestmentOperation } from "../../../data/repo";
import {
  useAllTransactionsState,
  useInvestmentCategoriesState,
  useInvestmentOperationsState,
  useInvestmentProductsState,
  useInvestmentProfilesState,
  useUserId,
} from "../../../data/hooks";
import { combineLiveQueryStatus } from "../../../data/live-state";
import {
  type InvestmentAssetType,
} from "../../../domain/investments";
import { projectInvestmentState } from "../../../domain/investment-projection";
import { formatMinor, formatMinorCompact } from "../../../domain/money";
import { todayISO } from "../../../domain/dates";
import { tr } from "../../../i18n/tr";
import {
  Amount,
  Body,
  Button,
  Card,
  DataStateNotice,
  EmptyState,
  Heading,
  Row,
  Screen,
  SectionHeader,
  Spread,
  IconButton,
} from "../../../ui/components";
import { Donut, useSeriesColors } from "../../../ui/charts";
import { font, radius, spacing, type, useTheme } from "../../../ui/theme";
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
  pension: PiggyBank,
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
            ...(compact ? { fontSize: 10, lineHeight: 12 } : null),
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
  compact,
}: {
  direction: "in" | "out";
  label: string;
  minor: number;
  compact: boolean;
}) {
  const { palette } = useTheme();
  const Icon = direction === "in" ? ArrowDownToLine : ArrowUpFromLine;
  const iconColor = direction === "in" ? palette.positiveText : palette.secondaryText;
  const iconBackground = direction === "in" ? palette.success + "20" : palette.secondarySoft;
  return (
    <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
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
        <Text
          accessibilityLabel={`${label}: ${formatMinor(minor)}`}
          style={[type.amountSm, { color: direction === "in" ? palette.positiveText : palette.text, marginTop: 1 }]}
        >
          {compact ? formatMinorCompact(minor) : formatMinor(minor)}
        </Text>
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
    : `${tr.investments.distribution}. ${ordered.map((slice) => `${slice.label}: ${formatMinor(slice.valueMinor)}`).join(", ")}.`;
  return (
    <View
      testID="investment-mobile-allocation"
      accessible
      accessibilityRole="image"
      accessibilityLabel={summary}
      style={{ marginTop: spacing.lg }}
    >
      <Text style={[type.small, { color: palette.textSecondary }]}>{tr.investments.distribution}</Text>
      <View
        accessible={false}
        style={{
          height: 9,
          flexDirection: "row",
          overflow: "hidden",
          borderRadius: radius.full,
          backgroundColor: palette.surfaceStrong,
          marginTop: spacing.sm,
        }}
      >
        {visible.map((slice) => (
          <View
            key={slice.label}
            style={{
              flex: totalMinor > 0 ? slice.valueMinor / totalMinor : 0,
              backgroundColor: slice.color,
            }}
          />
        ))}
      </View>
      <View accessible={false} style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
        {visible.map((slice) => (
          <View key={slice.label} style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View style={{ width: 7, height: 7, flexShrink: 0, borderRadius: 3, backgroundColor: slice.color }} />
              <Text
                style={[type.small, { flex: 1, color: palette.textSecondary, fontSize: 10, lineHeight: 12 }]}
              >
                {slice.label}
              </Text>
            </View>
            <Text style={[type.amountSm, { color: palette.text, fontSize: 11, marginTop: 2 }]}>
              %{totalMinor > 0 ? Math.round((slice.valueMinor / totalMinor) * 100) : 0}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function InvestmentQuickAction({
  icon: Icon,
  label,
  tone,
  disabled = false,
  onPress,
}: {
  icon: React.ComponentType<{ size?: number; color?: string; accessible?: boolean; strokeWidth?: number }>;
  label: string;
  tone: "primary" | "secondary" | "quiet";
  disabled?: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
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
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        minHeight: 64,
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        paddingHorizontal: spacing.xs,
        paddingVertical: spacing.sm,
        borderRadius: radius.md,
        backgroundColor: pressed ? palette.surfaceHover : "transparent",
        opacity: disabled ? 0.45 : 1,
        transform: [{ translateY: pressed && !disabled ? 1 : 0 }],
      })}
    >
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
        <Icon accessible={false} size={15} color={foreground} strokeWidth={2.2} />
      </View>
      <Text
        style={[type.small, { color: disabled ? palette.textMuted : palette.text, fontSize: 10, lineHeight: 12, textAlign: "center" }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function InvestmentsScreen() {
  const router = useRouter();
  const userId = useUserId();
  const undo = useUndo();
  const { width } = useWindowDimensions();
  const compact = width < 560;
  const { palette } = useTheme();
  const colors = useSeriesColors();
  const profilesState = useInvestmentProfilesState();
  const productsState = useInvestmentProductsState();
  const operationsState = useInvestmentOperationsState();
  const transactionsState = useAllTransactionsState();
  const categoriesState = useInvestmentCategoriesState();
  const states = [profilesState, productsState, operationsState, transactionsState, categoriesState];
  const status = combineLiveQueryStatus(states);
  const ready = states.every((state) => state.updatedAt != null);
  const profile = profilesState.data[0];
  const state = useMemo(() => {
    if (!profile) return null;
    try {
      return projectInvestmentState(profile, productsState.data, operationsState.data, transactionsState.data, categoriesState.data);
    } catch {
      return null;
    }
  }, [profile, productsState.data, operationsState.data, transactionsState.data, categoriesState.data]);
  const retry = () => states.forEach((source) => source.retry());
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
      <Screen title={tr.investments.title} maxWidth={820}>
        <View style={{ minHeight: width >= 760 ? 420 : 340, alignItems: "center", justifyContent: "center" }}>
          <View
            accessible={false}
            style={{
              width: 104,
              height: 104,
              borderRadius: 52,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: palette.primarySoft,
              marginBottom: spacing.lg,
            }}
          >
            <View style={{ position: "absolute", width: 82, height: 82, borderRadius: 41, borderWidth: 1, borderColor: palette.primary + "65" }} />
            <Landmark size={40} color={palette.primaryText} />
          </View>
          <Heading>{tr.investments.setupTitle}</Heading>
          <Body style={{ textAlign: "center", maxWidth: 520, marginTop: spacing.sm, marginBottom: spacing.lg }}>
            {tr.investments.setupBody}
          </Body>
          <Button icon={Sparkles} label={tr.investments.setupAction} onPress={() => router.push("/investments/setup")} />
        </View>
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
        <Text
          testID="investment-cash-amount"
          accessibilityLabel={`${tr.investments.cash}: ${formatMinor(state.cashMinor)}`}
          style={[type.amountLg, { color: palette.textStrong, fontSize: 30, textAlign: "left", marginTop: spacing.sm }]}
        >
          {formatMinorCompact(state.cashMinor)}
        </Text>
      ) : (
        <View testID="investment-cash-amount">
          <Amount minor={state.cashMinor} colorized={false} style={{ fontSize: width >= 760 ? 34 : 30, textAlign: "left", marginTop: spacing.sm }} />
        </View>
      )}
      <Text style={[type.small, { color: palette.textSecondary, marginTop: spacing.xs }]}>
        {tr.investments.portfolioTotal}: {compact ? formatMinorCompact(totalCapital) : formatMinor(totalCapital)}
      </Text>
    </View>
  );
  const distributionChart = (
    <Donut
      slices={slices}
      totalMinor={totalCapital}
      size={width >= 760 ? 148 : 112}
    />
  );

  return (
    <Screen
      title={tr.investments.title}
      maxWidth={1120}
      right={<Button icon={Plus} size="sm" label={tr.investments.addOperation} onPress={() => router.push({ pathname: "/investments/operation", params: { kind: "buy" } })} />}
    >
      <DataStateNotice status={status} retry={retry} />
      <View testID="investment-wallet-summary">
        <Card style={{ marginBottom: spacing.lg }}>
          {compact ? (
            <>
              {cashSummary}
              <AllocationStrip slices={slices} totalMinor={totalCapital} />
            </>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.lg }}>
              {cashSummary}
              {distributionChart}
            </View>
          )}
          <View style={{ flexDirection: "row", gap: compact ? spacing.sm : spacing.xl, marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: palette.surfaceAlt }}>
            <TransferMetric direction="in" label={tr.investments.transferredIn} minor={transferredInMinor} compact={compact} />
            <TransferMetric direction="out" label={tr.investments.transferredOut} minor={transferredOutMinor} compact={compact} />
          </View>
          <View style={{ flexDirection: "row", gap: compact ? spacing.sm : spacing.lg, marginTop: spacing.lg }}>
            <Stat compact={compact} label={tr.investments.investedCost} accent={palette.primary} value={<Text style={[type.amountSm, { color: palette.text }]}>{formatMinorCompact(state.investedCostMinor)}</Text>} />
            <Stat compact={compact} label={tr.investments.activeProducts} accent={palette.secondary} value={<Text style={[type.amountSm, { color: palette.text }]}>{active.length}</Text>} />
            <Stat
              compact={compact}
              label={tr.investments.realizedResult}
              accent={state.realizedProfitLossMinor >= 0 ? palette.positive : palette.negative}
              value={<Text style={[type.amountSm, { color: state.realizedProfitLossMinor >= 0 ? palette.positiveText : palette.negativeText }]}>{compact ? formatMinorCompact(state.realizedProfitLossMinor) : formatMinor(state.realizedProfitLossMinor)}</Text>}
            />
          </View>
        </Card>
      </View>

      <View
        testID="investment-actions"
        style={{
          width: "100%",
          maxWidth: 820,
          alignSelf: "flex-start",
          flexDirection: "row",
          gap: spacing.xs,
          padding: spacing.xs,
          borderRadius: radius.lg,
          backgroundColor: palette.surface,
          marginBottom: spacing.lg,
        }}
      >
        <InvestmentQuickAction icon={PackagePlus} tone="primary" label={tr.investments.addProduct} onPress={() => router.push("/investments/product")} />
        <InvestmentQuickAction icon={ArrowDownToLine} tone="secondary" label={tr.investments.addExisting} onPress={() => router.push({ pathname: "/investments/operation", params: { kind: "existing" } })} />
        <InvestmentQuickAction icon={ArrowUpFromLine} tone="quiet" label={tr.investments.sell} disabled={active.length === 0} onPress={() => router.push({ pathname: "/investments/operation", params: { kind: "sell" } })} />
        <InvestmentQuickAction icon={WalletCards} tone="secondary" label={tr.investments.refundShort} disabled={state.cashMinor <= 0} onPress={() => router.push({ pathname: "/transaction", params: { intent: "investment-refund" } })} />
      </View>

      <SectionHeader>{tr.investments.activeProducts}</SectionHeader>
      {active.length === 0 ? (
        <Card><EmptyState icon={Landmark} title={tr.investments.noProducts} hint={tr.investments.noProductsHint} /></Card>
      ) : (
        <WorkspaceGrid testID="investment-products">
          {active.map((product) => {
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
                      {product.quantity ?? tr.investments.quantityUnknown}
                    </Text>
                  </View>
                </Spread>
                <Row style={{ marginTop: spacing.lg }}>
                  <Stat compact={compact} label={tr.investments.averageCost} accent={palette.border} value={<Text style={[type.amountSm, { color: palette.text }]}>{product.averageCostMinor == null ? "—" : formatMinorCompact(product.averageCostMinor)}</Text>} />
                  <Stat compact={compact} label={tr.investments.totalCost} accent={palette.primary} value={<Text style={[type.amountSm, { color: palette.text }]}>{formatMinorCompact(product.costMinor)}</Text>} />
                  {product.realizedProfitLossMinor !== 0 ? (
                    <Stat
                      compact={compact}
                      label={resultPositive ? tr.investments.realizedProfit : tr.investments.realizedLoss}
                      accent={resultPositive ? palette.positive : palette.negative}
                      value={<Text style={[type.amountSm, { color: resultPositive ? palette.positiveText : palette.negativeText }]}>{compact ? formatMinorCompact(product.realizedProfitLossMinor) : formatMinor(product.realizedProfitLossMinor)}</Text>}
                    />
                  ) : null}
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
                      <Text
                        style={[type.amountSm, { color: movementTone.text, marginTop: 3 }]}
                      >
                        {formatMinorCompact(operation.totalMinor)}
                      </Text>
                    ) : null}
                  </View>
                  {!compact ? (
                    <Text
                      style={[type.amountSm, { color: movementTone.text, fontSize: 13 }]}
                    >
                      {formatMinor(operation.totalMinor)}
                    </Text>
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
