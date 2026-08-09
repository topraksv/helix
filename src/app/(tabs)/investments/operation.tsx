import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import ArrowDownToLine from "lucide-react-native/icons/arrow-down-to-line";
import ArrowUpFromLine from "lucide-react-native/icons/arrow-up-from-line";
import Landmark from "lucide-react-native/icons/landmark";
import Plus from "lucide-react-native/icons/plus";
import Trash2 from "lucide-react-native/icons/trash-2";
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
import { formatMinorCompact, formatMinorInput } from "../../../domain/money";
import { userMessage } from "../../../domain/user-error";
import { tr } from "../../../i18n/tr";
import { scheduleSync } from "../../../sync/engine";
import { DateField } from "../../../ui/calendar";
import {
  Amount,
  Button,
  Card,
  DataStateNotice,
  FadeIn,
  Field,
  IconButton,
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
import { useContentWidth } from "../../../ui/viewport";

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

export default function InvestmentOperationScreen() {
  const params = useLocalSearchParams<{ kind?: string; productId?: string; id?: string }>();
  const requestedKind: InvestmentOperationKind = VALID_KINDS.has(params.kind as InvestmentOperationKind)
    ? params.kind as InvestmentOperationKind
    : "buy";
  const router = useRouter();
  const userId = useUserId();
  const { palette } = useTheme();
  // The impact chip only shares the heading row where a chip-sized column can
  // still hold the sentence; below that it takes its own row.
  const wideSummary = useContentWidth() >= 560;
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
    setUnitRaw(editing.unitPriceMinor == null ? "" : formatMinorInput(editing.unitPriceMinor));
    setTotalMinor(editing.totalMinor);
    setTotalRaw(formatMinorInput(editing.totalMinor));
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
    <Screen width="form">
      <Stack.Screen options={{ title: pageTitle }} />
      <FadeIn style={{ marginBottom: spacing.lg }}>
        <View
          testID="investment-operation-summary"
          accessible
          accessibilityRole="image"
          accessibilityLabel={`${pageTitle}. ${selected?.name ?? tr.investments.product}. ${date}. ${calculationTotal == null ? "—" : formatMinorCompact(calculationTotal)}. ${tr.investments.operationImpact[kind]}`}
          // The app paints a card as `surface` under a hairline; this one was
          // `surfaceAlt` under a 4px bar with `surface` tiles inside it — the
          // surface order inverted, so the one screen that explains a money
          // movement looked like it came from another product. It carries the
          // operation's colour as the same top accent a hero card uses.
          style={{
            borderTopWidth: 3,
            borderTopColor: impactColor,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.border,
            padding: spacing.lg,
            borderRadius: radius.lg,
            backgroundColor: palette.surface,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <View style={{ width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: impactColor + "16", borderWidth: StyleSheet.hairlineWidth, borderColor: impactColor + "70" }}>
              <ImpactIcon accessible={false} size={21} color={impactColor} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.small, { color: palette.textSecondary, textTransform: "uppercase", letterSpacing: 0.7 }]}>{tr.investments.calculationSummary}</Text>
              <Text style={[type.heading, { color: palette.textStrong, marginTop: 2 }]}>{pageTitle}</Text>
              <Text style={[type.small, { color: palette.textSecondary, marginTop: 2 }]}>
                {selected ? `${selected.name} · ${tr.investments.types[selected.assetType]}` : tr.investments.product}
              </Text>
            </View>
            {/* "Serbest bakiyeye eklenir" is the sentence that tells the user
                where their money goes, and a 34%-wide column beside a heading
                broke it across three lines on a phone. It gets the full width
                below instead, and only shares the row when there is room. */}
            {wideSummary ? (
              <View style={{ maxWidth: "38%", paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 1, borderRadius: radius.full, backgroundColor: impactColor + "18", borderWidth: StyleSheet.hairlineWidth, borderColor: impactColor + "70" }}>
                <Text style={[type.small, { color: impactColor, fontFamily: font.semibold, textAlign: "center" }]}>{tr.investments.operationImpact[kind]}</Text>
              </View>
            ) : null}
          </View>
          {!wideSummary ? (
            <View style={{ marginTop: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: impactColor + "14", borderWidth: StyleSheet.hairlineWidth, borderColor: impactColor + "60" }}>
              <ImpactIcon accessible={false} size={15} color={impactColor} strokeWidth={2.2} />
              <Text style={[type.small, { color: impactColor, fontFamily: font.semibold, flex: 1, minWidth: 0 }]}>{tr.investments.operationImpact[kind]}</Text>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg }}>
            <View style={{ flex: 1, minWidth: 110, padding: spacing.sm, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border }}>
              <Text style={[type.small, { color: palette.textSecondary }]}>{tr.investments.operationDate}</Text>
              <Text style={[type.label, { color: palette.textStrong, marginTop: 2 }]}>{date}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 110, padding: spacing.sm, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border }}>
              <Text style={[type.small, { color: palette.textSecondary }]}>{tr.investments.operationImpactLabel}</Text>
              <Text style={[type.label, { color: impactColor, marginTop: 2 }]}>{tr.investments.operationImpact[kind]}</Text>
            </View>
          </View>
          {!amountOnlyContribution ? (
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={{ flex: 1, minWidth: 0, padding: spacing.sm, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border }}>
                <Text style={[type.small, { color: palette.textSecondary }]}>{tr.investments.quantity}</Text>
                <Text style={[type.amountSm, { color: palette.textStrong, marginTop: 2 }]}>{quantity || "—"}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0, padding: spacing.sm, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border }}>
                <Text style={[type.small, { color: palette.textSecondary }]}>{tr.investments.unitPrice}</Text>
                {unitMinor == null ? (
                  <Text style={[type.amountSm, { color: palette.textStrong, marginTop: 2 }]}>—</Text>
                ) : (
                  <Amount
                    minor={unitMinor}
                    colorized={false}
                    accessibilityLabel={formatMinorCompact(unitMinor)}
                    style={[type.amountSm, { color: palette.textStrong, marginTop: 2, textAlign: "left" }]}
                  />
                )}
              </View>
            </View>
          ) : null}
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginVertical: spacing.lg }} />
          <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: spacing.md }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.small, { color: palette.textSecondary }]}>{tr.investments.calculatedTotal}</Text>
              <Text style={[type.small, { color: palette.textSecondary, marginTop: 2 }]}>{tr.investments.operationHint[kind]}</Text>
            </View>
            {calculationTotal == null ? (
              <Text style={[type.amount, { color: palette.textSecondary, textAlign: "right" }]}>—</Text>
            ) : (
              <Amount
                minor={calculationTotal}
                colorized={false}
                color={impactColor}
                accessibilityLabel={formatMinorCompact(calculationTotal)}
                style={{ textAlign: "right" }}
              />
            )}
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
                    testID="investment-quantity"
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
              testID="investment-unit-price"
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
              placeholder={calculatedQuote ? formatMinorInput(calculatedQuote.totalMinor) : tr.common.optionalHint}
              onChangeMinor={(raw, minor) => {
                setTotalRaw(raw);
                setTotalMinor(minor);
              }}
            />
          </>
        )}
        <Field label={tr.common.note} value={note} onChangeText={setNote} multiline placeholder={notePlaceholder} />
      </Card>

      <Button
        testID="investment-operation-save"
        label={pageTitle}
        loading={busy}
        disabled={!canSave}
        onPress={() => void save()}
      />
      {editing ? (
        <View
          testID="investment-history-removal-row"
          style={{
            width: "100%",
            alignSelf: "stretch",
            marginTop: spacing.xl,
            paddingTop: spacing.md,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: palette.border,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: spacing.md,
          }}
        >
          <Text style={[type.small, { color: palette.textSecondary, flex: 1, minWidth: 0, flexShrink: 1 }]}>
            {tr.investments.removeProductHistoryHint}
          </Text>
          <IconButton
            icon={Trash2}
            tone="danger"
            label={tr.investments.removeProductHistory}
            onPress={() => router.push({ pathname: "/investments/correction", params: { productId: editing.productId } })}
          />
        </View>
      ) : null}
    </Screen>
  );
}
