import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Landmark,
  Plus,
} from "lucide-react-native";
import { addInvestmentOperation, updateInvestmentOperation } from "../../../data/repo";
import {
  useInvestmentOperationsState,
  useInvestmentProfilesState,
  useInvestmentProductsState,
  useUserId,
} from "../../../data/hooks";
import { todayISO } from "../../../domain/dates";
import {
  formatInvestmentQuantityAtoms,
  InvestmentDomainError,
  parseInvestmentQuantity,
  resolveInvestmentQuote,
  type InvestmentOperationKind,
} from "../../../domain/investments";
import { formatMinor } from "../../../domain/money";
import { userMessage } from "../../../domain/user-error";
import { tr } from "../../../i18n/tr";
import { scheduleSync } from "../../../sync/engine";
import { DateField } from "../../../ui/calendar";
import {
  Button,
  Card,
  DataStateNotice,
  FadeIn,
  Field,
  Label,
  MoneyField,
  PanelHeader,
  Screen,
  Segmented,
  Select,
} from "../../../ui/components";
import { appAlert } from "../../../ui/dialog";
import { navigateBack } from "../../../ui/navigation";
import { placeholderPools, useRotatingPlaceholder } from "../../../ui/placeholders";
import { controlSize, font, radius, spacing, type, useTheme } from "../../../ui/theme";

const VALID_KINDS = new Set<InvestmentOperationKind>(["existing", "buy", "sell", "contribution"]);
type ContributionMode = "units" | "amount";

function errorText(error: unknown): string {
  if (!(error instanceof InvestmentDomainError)) return userMessage(error, tr.errors.saveFailed);
  return {
    insufficient_cash: tr.investments.insufficientCash,
    oversold: tr.investments.oversold,
    unknown_quantity: tr.investments.unknownQuantity,
    quote_inconsistent: tr.investments.inconsistentQuote,
    quote_incomplete: tr.investments.incompleteQuote,
    invalid_quantity: tr.investments.invalidQuantity,
    invalid_money: tr.common.amountLimit,
    unknown_product: tr.investments.noProducts,
    invalid_operation: tr.investments.invalidOperation,
  }[error.code];
}

function holdingQuantities(
  products: ReturnType<typeof useInvestmentProductsState>["data"],
  operations: ReturnType<typeof useInvestmentOperationsState>["data"],
  editingId?: string,
): Map<string, bigint> {
  const quantities = new Map(products.map((product) => [product.id, 0n]));
  const unknown = new Set<string>();
  for (const operation of operations) {
    if (operation.id === editingId) continue;
    if (operation.quantity == null) {
      if (operation.kind === "contribution") unknown.add(operation.productId);
      continue;
    }
    const atoms = parseInvestmentQuantity(operation.quantity).atoms;
    const sign = operation.kind === "sell" ? -1n : 1n;
    quantities.set(operation.productId, (quantities.get(operation.productId) ?? 0n) + sign * atoms);
  }
  for (const productId of unknown) quantities.delete(productId);
  return quantities;
}

function moneyInputValue(minor: number): string {
  return (minor / 100).toFixed(2).replace(".", ",");
}

export default function InvestmentOperationScreen() {
  const params = useLocalSearchParams<{ kind?: string; productId?: string; id?: string }>();
  const requestedKind: InvestmentOperationKind = VALID_KINDS.has(params.kind as InvestmentOperationKind)
    ? params.kind as InvestmentOperationKind
    : "buy";
  const router = useRouter();
  const userId = useUserId();
  const { palette } = useTheme();
  const productsState = useInvestmentProductsState();
  const operationsState = useInvestmentOperationsState();
  const profilesState = useInvestmentProfilesState();
  const editing = params.id ? operationsState.data.find((operation) => operation.id === params.id) : undefined;
  const baseKind = editing?.kind ?? requestedKind;
  const holdings = useMemo(
    () => holdingQuantities(productsState.data, operationsState.data, editing?.id),
    [productsState.data, operationsState.data, editing?.id],
  );
  const products = productsState.data.filter((product) =>
    baseKind === "contribution"
      ? product.assetType === "pension"
      : baseKind === "sell"
        ? (holdings.get(product.id) ?? 0n) > 0n
        : true,
  );
  const [productId, setProductId] = useState<string | null>(params.productId ?? null);
  const [date, setDate] = useState(todayISO());
  const [quantity, setQuantity] = useState("");
  const [unitRaw, setUnitRaw] = useState("");
  const [unitMinor, setUnitMinor] = useState<number | null>(null);
  const [totalRaw, setTotalRaw] = useState("");
  const [totalMinor, setTotalMinor] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [contributionMode, setContributionMode] = useState<ContributionMode>("units");
  const [busy, setBusy] = useState(false);
  const hydratedEdit = useRef<string | null>(null);
  const quantityPlaceholder = useRotatingPlaceholder(placeholderPools.investmentQuantity, { prefix: false });
  const unitPlaceholder = useRotatingPlaceholder(placeholderPools.investmentUnitPrice, { prefix: false });
  const notePlaceholder = useRotatingPlaceholder(placeholderPools.investmentNote);

  useEffect(() => {
    if (!editing || hydratedEdit.current === editing.id) return;
    hydratedEdit.current = editing.id;
    setProductId(editing.productId);
    setDate(editing.operationDate);
    setQuantity(editing.quantity ?? "");
    setUnitMinor(editing.unitPriceMinor);
    setUnitRaw(editing.unitPriceMinor == null ? "" : moneyInputValue(editing.unitPriceMinor));
    setTotalMinor(editing.totalMinor);
    setTotalRaw(moneyInputValue(editing.totalMinor));
    setContributionMode(editing.kind === "contribution" && editing.quantity == null ? "amount" : "units");
    setNote(editing.note ?? "");
  }, [editing]);
  useEffect(() => {
    if (productId && products.some((product) => product.id === productId)) return;
    setProductId(products.length === 1 ? products[0]!.id : null);
  }, [productId, products]);

  const selected = products.find((product) => product.id === productId);
  const kind: InvestmentOperationKind = !editing && baseKind === "buy" && selected?.assetType === "pension"
    ? "contribution"
    : baseKind;
  const amountOnlyContribution = kind === "contribution" && contributionMode === "amount";
  const parsedQuantity = useMemo(() => {
    if (!quantity.trim()) return { atoms: null, error: null };
    try {
      return { atoms: parseInvestmentQuantity(quantity).atoms, error: null };
    } catch {
      return { atoms: null, error: tr.investments.invalidQuantity };
    }
  }, [quantity]);
  const heldAtoms = productId ? holdings.get(productId) ?? null : null;
  const oversellError = kind === "sell" && parsedQuantity.atoms != null && heldAtoms != null && parsedQuantity.atoms > heldAtoms
    ? tr.investments.oversoldWithHolding(formatInvestmentQuantityAtoms(heldAtoms))
    : null;
  const calculatedQuote = useMemo(() => {
    if (amountOnlyContribution || !quantity.trim() || unitMinor == null) return null;
    try {
      return resolveInvestmentQuote({ quantity, unitPriceMinor: unitMinor });
    } catch {
      return null;
    }
  }, [amountOnlyContribution, quantity, unitMinor]);
  const quoteResult = useMemo(() => {
    if (amountOnlyContribution) return { quote: null, error: null };
    if (!quantity.trim() || unitMinor == null) return { quote: null, error: null };
    try {
      return {
        quote: resolveInvestmentQuote({ quantity, unitPriceMinor: unitMinor, totalMinor }),
        error: null,
      };
    } catch (error) {
      return { quote: null, error: errorText(error) };
    }
  }, [amountOnlyContribution, quantity, unitMinor, totalMinor]);
  const quote = quoteResult.quote;
  const totalError = totalMinor != null ? quoteResult.error : null;
  const calculationTotal = amountOnlyContribution ? totalMinor : quote?.totalMinor ?? calculatedQuote?.totalMinor ?? null;
  const canSave = productId != null
    && !busy
    && !oversellError
    && !parsedQuantity.error
    && (amountOnlyContribution
      ? totalMinor != null
      : quantity.trim() !== "" && unitMinor != null && quote != null);

  const save = async () => {
    if (!productId || !canSave) return;
    setBusy(true);
    try {
      const input = {
        productId,
        kind,
        operationDate: date,
        quantity: amountOnlyContribution ? null : quote!.quantity,
        unitPriceMinor: amountOnlyContribution ? null : quote!.unitPriceMinor,
        totalMinor: amountOnlyContribution ? totalMinor! : quote!.totalMinor,
        note,
      };
      if (editing) await updateInvestmentOperation(userId, editing.id, input);
      else await addInvestmentOperation(userId, input);
      scheduleSync(userId);
      navigateBack(router, "/(tabs)/investments");
    } catch (error) {
      void appAlert(errorText(error), tr.errors.title);
    } finally {
      setBusy(false);
    }
  };

  if (profilesState.updatedAt == null) {
    return <Screen><DataStateNotice status={profilesState.status} retry={profilesState.retry} /></Screen>;
  }
  if (profilesState.data.length === 0) return <Redirect href="/investments/setup" />;

  const pageTitle = editing ? tr.investments.editOperation : tr.investments.operationTitle[kind];
  const impactColor = kind === "sell" ? palette.positiveText : kind === "existing" ? palette.secondaryText : palette.primaryText;
  const ImpactIcon = kind === "sell" ? ArrowUpFromLine : kind === "existing" ? Landmark : ArrowDownToLine;

  return (
    <Screen maxWidth={820}>
      <Stack.Screen options={{ title: pageTitle }} />
      <FadeIn style={{ marginBottom: spacing.lg }}>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={`${pageTitle}. ${tr.investments.operationHint[kind]}`}
          style={{
            borderLeftWidth: 4,
            borderLeftColor: impactColor,
            padding: spacing.md,
            borderRadius: radius.lg,
            backgroundColor: palette.surfaceAlt,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <View style={{ width: 36, height: 36, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: palette.surface }}>
              <ImpactIcon accessible={false} size={18} color={impactColor} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.label, { color: palette.textStrong, fontFamily: font.semibold }]}>{tr.investments.calculationSummary}</Text>
              <Text style={[type.small, { color: impactColor, marginTop: 2 }]}>{tr.investments.operationImpact[kind]}</Text>
            </View>
          </View>
          {!amountOnlyContribution ? (
            <View style={{ flexDirection: "row", alignItems: "stretch", gap: spacing.sm, marginTop: spacing.md }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.small, { color: palette.textSecondary }]}>{tr.investments.quantity}</Text>
                <Text style={[type.amountSm, { color: palette.textStrong, marginTop: 2 }]}>{quantity || "—"}</Text>
              </View>
              <View accessible={false} style={{ justifyContent: "center" }}>
                <Text style={[type.heading, { color: palette.textSecondary }]}>×</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0, alignItems: "flex-end" }}>
                <Text style={[type.small, { color: palette.textSecondary, textAlign: "right" }]}>{tr.investments.unitPrice}</Text>
                <Text style={[type.amountSm, { color: palette.textStrong, marginTop: 2, textAlign: "right" }]}>{unitMinor == null ? "—" : formatMinor(unitMinor)}</Text>
              </View>
            </View>
          ) : null}
          <View style={{ height: 1, backgroundColor: palette.border, marginVertical: spacing.md }} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
            <Text style={[type.label, { color: palette.textSecondary }]}>{tr.investments.calculatedTotal}</Text>
            <Text style={[type.amount, { color: calculationTotal == null ? palette.textSecondary : impactColor, textAlign: "right" }]}>
              {calculationTotal == null ? "—" : formatMinor(calculationTotal)}
            </Text>
          </View>
        </View>
      </FadeIn>

      <Card style={{ marginBottom: spacing.lg }}>
        <PanelHeader
          icon={kind === "sell" ? ArrowUpFromLine : kind === "existing" ? Landmark : ArrowDownToLine}
          title={pageTitle}
        />
        <Select
          label={tr.investments.product}
          options={products.map((product) => ({ value: product.id, label: `${product.name} · ${tr.investments.types[product.assetType]}` }))}
          value={productId}
          onChange={setProductId}
          placeholder={tr.investments.product}
          onCreate={baseKind === "sell" ? undefined : {
            label: tr.investments.addProduct,
            run: () => router.push({ pathname: "/investments/product", params: { next: baseKind } }),
          }}
        />
        {products.length === 0 && baseKind !== "sell" ? (
          <Button
            icon={Plus}
            variant="secondary"
            label={tr.investments.addProduct}
            onPress={() => router.push({ pathname: "/investments/product", params: { next: baseKind } })}
          />
        ) : null}
        <DateField label={tr.investments.operationDate} value={date} onChange={setDate} max={todayISO()} />
        {kind === "contribution" ? (
          <Segmented
            value={contributionMode}
            onChange={setContributionMode}
            options={[
              { value: "units", label: tr.investments.contributionWithUnits },
              { value: "amount", label: tr.investments.contributionAmountOnly },
            ]}
          />
        ) : null}
        {amountOnlyContribution ? (
          <MoneyField
            label={tr.investments.requiredTotal}
            value={totalRaw}
            placeholder={unitPlaceholder}
            onChangeMinor={(raw, minor) => {
              setTotalRaw(raw);
              setTotalMinor(minor);
            }}
          />
        ) : (
          <>
            <View style={{ marginBottom: spacing.md }}>
              <Label>{tr.investments.requiredQuantity}</Label>
              <View style={{ flexDirection: "row", alignItems: "stretch", gap: spacing.xs }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Field
                    accessibilityLabel={tr.investments.requiredQuantity}
                    noMargin
                    value={quantity}
                    error={parsedQuantity.error ?? oversellError}
                    onChangeText={(raw) => setQuantity(raw.replace(/[^\d.,]/g, "").slice(0, 30))}
                    keyboardType="decimal-pad"
                    inputMode="decimal"
                    placeholder={quantityPlaceholder}
                  />
                </View>
                {kind === "sell" && selected && heldAtoms != null ? (
                  <View
                    accessible
                    accessibilityLabel={tr.investments.availableQuantityShort(formatInvestmentQuantityAtoms(heldAtoms))}
                    style={{
                      width: "34%",
                      maxWidth: 148,
                      minWidth: 96,
                      minHeight: controlSize.regular,
                      justifyContent: "center",
                      paddingHorizontal: spacing.sm,
                      paddingVertical: spacing.xs,
                      borderRadius: radius.sm,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: palette.primary + "80",
                      backgroundColor: palette.primarySoft,
                    }}
                  >
                    <Text style={[type.small, { color: palette.textSecondary }]}>{tr.investments.availableQuantity}</Text>
                    <Text style={[type.amountSm, { color: palette.primaryText, fontFamily: font.semibold, marginTop: 1 }]}>
                      {formatInvestmentQuantityAtoms(heldAtoms)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
            <MoneyField
              label={tr.investments.requiredUnitPrice}
              value={unitRaw}
              placeholder={unitPlaceholder}
              onChangeMinor={(raw, minor) => {
                setUnitRaw(raw);
                setUnitMinor(minor);
              }}
            />
            <MoneyField
              label={tr.investments.optionalTotal}
              value={totalRaw}
              error={totalError}
              placeholder={calculatedQuote ? moneyInputValue(calculatedQuote.totalMinor) : tr.common.optionalHint}
              onChangeMinor={(raw, minor) => {
                setTotalRaw(raw);
                setTotalMinor(minor);
              }}
            />
          </>
        )}
        <Field label={tr.common.note} value={note} onChangeText={setNote} multiline placeholder={notePlaceholder} />
      </Card>

      <Button label={pageTitle} loading={busy} disabled={!canSave} onPress={() => void save()} />
    </Screen>
  );
}
