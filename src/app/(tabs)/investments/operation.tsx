import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import ArrowDownToLine from "lucide-react-native/icons/arrow-down-to-line";
import ArrowUpFromLine from "lucide-react-native/icons/arrow-up-from-line";
import Landmark from "lucide-react-native/icons/landmark";
import Plus from "lucide-react-native/icons/plus";
import Trash from "lucide-react-native/icons/trash";
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
import { Amount, Button, Card, DataStateNotice, Eyebrow, FadeIn, Field, IconButton, Label, MoneyField, PanelHeader, Screen, Segmented, Select } from "../../../ui/components";
import { appAlert } from "../../../ui/dialog";
import { navigateBack } from "../../../ui/navigation";
import { useDirtyExitGuard, useDraftDirty } from "../../../ui/dirty-exit";
import { placeholderPools, useRotatingPlaceholder } from "../../../ui/placeholders";
import { controlSize, font, radius, spacing, type, useTheme } from "../../../ui/theme";
import { shouldPairOperationSummary } from "../../../ui/responsive";
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
    // Not the ceiling: nothing throws this code for an amount over the limit
    // (that check throws a plain Error), so the limit sentence was wrong in
    // every case it could appear. What it does mean is a figure that is
    // negative or zero where the record needs a positive one.
    invalid_money: tr.investments.invalidAmount,
    invalid_date: tr.investments.invalidDate,
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

/** Where an operation moves money, drawn in one colour and one icon wherever it is shown. */
function impactOf(kind: InvestmentOperationKind, palette: ReturnType<typeof useTheme>["palette"]) {
  if (kind === "sell") return { color: palette.positiveText, Icon: ArrowUpFromLine };
  return kind === "existing" ? { color: palette.secondaryText, Icon: Landmark } : { color: palette.primaryText, Icon: ArrowDownToLine };
}

/**
 * The quantity, unit price and total as typed, and the quote they settle on.
 * `calculated` ignores the typed total, so the total field can suggest what the
 * other two make; `quote` holds all three to agreeing.
 */
function draftQuote(quantity: string, unitMinor: number | null, totalMinor: number | null, amountOnly: boolean) {
  const typed = quantity.trim() !== "";
  let quantityError: string | null = null;
  let atoms: bigint | null = null;
  try {
    atoms = typed ? parseInvestmentQuantity(quantity).atoms : null;
  } catch {
    quantityError = tr.investments.invalidQuantity;
  }
  if (amountOnly || !typed || unitMinor == null) return { atoms, quantityError, calculated: null, quote: null, totalError: null };
  const attempt = (withTotal: boolean) => {
    try {
      return { quote: resolveInvestmentQuote({ quantity, unitPriceMinor: unitMinor, ...(withTotal ? { totalMinor } : {}) }), error: null };
    } catch (error) {
      return { quote: null, error: errorText(error) };
    }
  };
  const full = attempt(true);
  return { atoms, quantityError, calculated: attempt(false).quote, quote: full.quote, totalError: totalMinor != null ? full.error : null };
}

function useOperationDraft() {
  const params = useLocalSearchParams<{ kind?: string; productId?: string; id?: string }>();
  const requestedKind: InvestmentOperationKind = VALID_KINDS.has(params.kind as InvestmentOperationKind) ? params.kind as InvestmentOperationKind : "buy";
  const router = useRouter();
  const userId = useUserId();
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
    baseKind === "contribution" ? product.assetType === "pension" : baseKind !== "sell" || (holdings.get(product.id) ?? 0n) > 0n,
  );
  const [productId, setProductId] = useState<string | null>(params.productId ?? null);
  const [date, setDate] = useState(todayISO());
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<{ raw: string; minor: number | null }>({ raw: "", minor: null });
  const [total, setTotal] = useState<{ raw: string; minor: number | null }>({ raw: "", minor: null });
  const [note, setNote] = useState("");
  const [contributionMode, setContributionMode] = useState<ContributionMode>("units");
  const [busy, setBusy] = useState(false);
  const hydratedEdit = useRef<string | null>(null);
  // `useDraftDirty` reads this only until it captures a baseline, so it has to
  // be false for exactly the renders between the row arriving and the effect
  // below hydrating the form — otherwise the baseline is the empty form and
  // the hydration itself reads as an edit the owner never made. An edit is
  // opened with `{ id, kind }` and no `productId`, so the form showing this
  // row's product is what proves the effect has run. A later change flips it
  // back to false harmlessly: by then the baseline is already taken.
  const settled = !params.id || (editing != null && productId === editing.productId);
  const { allowExit } = useDirtyExitGuard(
    useDraftDirty(JSON.stringify({ productId, date, quantity, unit: unit.raw, total: total.raw, note, contributionMode }), settled) && !busy,
  );

  useEffect(() => {
    if (!editing || hydratedEdit.current === editing.id) return;
    hydratedEdit.current = editing.id;
    setProductId(editing.productId);
    setDate(editing.operationDate);
    setQuantity(editing.quantity ?? "");
    setUnit({ minor: editing.unitPriceMinor, raw: editing.unitPriceMinor == null ? "" : formatMinorInput(editing.unitPriceMinor) });
    setTotal({ minor: editing.totalMinor, raw: formatMinorInput(editing.totalMinor) });
    setContributionMode(editing.kind === "contribution" && editing.quantity == null ? "amount" : "units");
    setNote(editing.note ?? "");
  }, [editing]);
  useEffect(() => {
    if (productId && products.some((product) => product.id === productId)) return;
    setProductId(products.length === 1 ? products[0]!.id : null);
  }, [productId, products]);

  const selected = products.find((product) => product.id === productId);
  // A new purchase of a pension product is a contribution.
  const kind: InvestmentOperationKind = !editing && baseKind === "buy" && selected?.assetType === "pension" ? "contribution" : baseKind;
  const amountOnly = kind === "contribution" && contributionMode === "amount";
  const quoted = useMemo(() => draftQuote(quantity, unit.minor, total.minor, amountOnly), [quantity, unit.minor, total.minor, amountOnly]);
  const heldAtoms = productId ? holdings.get(productId) ?? null : null;
  const oversellError = kind === "sell" && quoted.atoms != null && heldAtoms != null && quoted.atoms > heldAtoms
    ? tr.investments.oversoldWithHolding(formatInvestmentQuantityAtoms(heldAtoms))
    : null;
  const canSave = productId != null && !busy && !oversellError && !quoted.quantityError && (amountOnly ? total.minor != null : quoted.quote != null);

  const save = async () => {
    if (!productId || !canSave) return;
    setBusy(true);
    try {
      const input = {
        productId,
        kind,
        operationDate: date,
        quantity: amountOnly ? null : quoted.quote!.quantity,
        unitPriceMinor: amountOnly ? null : quoted.quote!.unitPriceMinor,
        totalMinor: amountOnly ? total.minor! : quoted.quote!.totalMinor,
        note,
      };
      if (editing) await updateInvestmentOperation(userId, editing.id, input);
      else await addInvestmentOperation(userId, input);
      scheduleSync(userId);
      allowExit(() => navigateBack(router, "/(tabs)/investments"));
    } catch (error) {
      void appAlert(errorText(error), tr.errors.title);
    } finally {
      setBusy(false);
    }
  };

  return {
    profilesState, editing, baseKind, kind, products, selected, productId, setProductId, date, setDate, quantity, setQuantity, unit, setUnit, total, setTotal,
    note, setNote, contributionMode, setContributionMode, amountOnly, quoted, heldAtoms, oversellError, canSave, busy, save,
    title: editing ? tr.investments.editOperation : tr.investments.operationTitle[kind],
    calculationTotal: amountOnly ? total.minor : quoted.quote?.totalMinor ?? quoted.calculated?.totalMinor ?? null,
  };
}

type OperationDraft = ReturnType<typeof useOperationDraft>;

/** One labelled figure in the summary. */
function SummaryTile({ label, minWidth, children }: { label: string; minWidth: number; children: React.ReactNode }) {
  const { palette } = useTheme();
  return (
    <View style={{ flex: 1, minWidth, padding: spacing.sm, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border }}>
      <Text style={[type.small, { color: palette.textSecondary }]}>{label}</Text>
      {children}
    </View>
  );
}

function OperationSummary({ draft }: { draft: OperationDraft }) {
  const { palette } = useTheme();
  // The impact chip only shares the heading row where a chip-sized column can
  // still hold the sentence; below that it takes its own row.
  const wideSummary = shouldPairOperationSummary(useContentWidth());
  const { kind, selected, date, title, calculationTotal: totalMinor, unit } = draft;
  const { color, Icon } = impactOf(kind, palette);
  const impact = tr.investments.operationImpact[kind];
  const dash = (style: object) => <Text style={[style, { color: palette.textStrong, marginTop: 2 }]}>—</Text>;
  return (
    <FadeIn style={{ marginBottom: spacing.lg }}>
      <View
        testID="investment-operation-summary"
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${title}. ${selected?.name ?? tr.investments.product}. ${date}. ${totalMinor == null ? "—" : formatMinorCompact(totalMinor)}. ${impact}`}
        // A card as the app paints one — `surface` under a hairline — with the
        // operation's colour as the same top accent a hero card uses.
        style={{
          borderTopWidth: 3,
          borderTopColor: color,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.border,
          padding: spacing.lg,
          borderRadius: radius.lg,
          backgroundColor: palette.surface,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <View style={{ width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: color + "16", borderWidth: StyleSheet.hairlineWidth, borderColor: color + "70" }}>
            <Icon accessible={false} size={21} color={color} strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Eyebrow>{tr.investments.calculationSummary}</Eyebrow>
            <Text style={[type.heading, { color: palette.textStrong, marginTop: 2 }]}>{title}</Text>
            <Text style={[type.small, { color: palette.textSecondary, marginTop: 2 }]}>
              {selected ? `${selected.name} · ${tr.investments.types[selected.assetType]}` : tr.investments.product}
            </Text>
          </View>
          {/* "Serbest bakiyeye eklenir" tells the user where their money goes; a
              34%-wide column broke it across three lines on a phone, so it
              shares the row only when there is room. */}
          {wideSummary ? (
            <View style={{ maxWidth: "38%", paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 1, borderRadius: radius.full, backgroundColor: color + "18", borderWidth: StyleSheet.hairlineWidth, borderColor: color + "70" }}>
              <Text style={[type.small, { color, fontFamily: font.semibold, textAlign: "center" }]}>{impact}</Text>
            </View>
          ) : null}
        </View>
        {!wideSummary ? (
          <View style={{ marginTop: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: color + "14", borderWidth: StyleSheet.hairlineWidth, borderColor: color + "60" }}>
            <Icon accessible={false} size={15} color={color} strokeWidth={2.2} />
            <Text style={[type.small, { color, fontFamily: font.semibold, flex: 1, minWidth: 0 }]}>{impact}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg }}>
          <SummaryTile label={tr.investments.operationDate} minWidth={110}>
            <Text style={[type.label, { color: palette.textStrong, marginTop: 2 }]}>{date}</Text>
          </SummaryTile>
          <SummaryTile label={tr.investments.operationImpactLabel} minWidth={110}>
            <Text style={[type.label, { color, marginTop: 2 }]}>{impact}</Text>
          </SummaryTile>
        </View>
        {!draft.amountOnly ? (
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
            <SummaryTile label={tr.investments.quantity} minWidth={0}>
              <Text style={[type.amountSm, { color: palette.textStrong, marginTop: 2 }]}>{draft.quantity || "—"}</Text>
            </SummaryTile>
            <SummaryTile label={tr.investments.unitPrice} minWidth={0}>
              {unit.minor == null
                ? dash(type.amountSm)
                : <Amount minor={unit.minor} colorized={false} accessibilityLabel={formatMinorCompact(unit.minor)} style={[type.amountSm, { color: palette.textStrong, marginTop: 2, textAlign: "left" }]} />}
            </SummaryTile>
          </View>
        ) : null}
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginVertical: spacing.lg }} />
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: spacing.md }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.small, { color: palette.textSecondary }]}>{tr.investments.calculatedTotal}</Text>
            <Text style={[type.small, { color: palette.textSecondary, marginTop: 2 }]}>{tr.investments.operationHint[kind]}</Text>
          </View>
          {totalMinor == null
            ? <Text style={[type.amount, { color: palette.textSecondary, textAlign: "right" }]}>—</Text>
            : <Amount minor={totalMinor} colorized={false} color={color} accessibilityLabel={formatMinorCompact(totalMinor)} style={{ textAlign: "right" }} />}
        </View>
      </View>
    </FadeIn>
  );
}

/** Beside the quantity of a sale, how much of the product is held. */
function HeldQuantity({ atoms }: { atoms: bigint }) {
  const { palette } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={tr.investments.availableQuantityShort(formatInvestmentQuantityAtoms(atoms))}
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
      <Text style={[type.amountSm, { color: palette.primaryText, fontFamily: font.semibold, marginTop: 1 }]}>{formatInvestmentQuantityAtoms(atoms)}</Text>
    </View>
  );
}

function QuoteFields({ draft }: { draft: OperationDraft }) {
  const { quantity, unit, total, quoted } = draft;
  const quantityPlaceholder = useRotatingPlaceholder(placeholderPools.investmentQuantity, { prefix: false, active: quantity.length === 0 });
  const unitPlaceholder = useRotatingPlaceholder(placeholderPools.investmentUnitPrice, { prefix: false, active: unit.raw.length === 0 || total.raw.length === 0 });
  const onTotal = (raw: string, minor: number | null) => draft.setTotal({ raw, minor });
  if (draft.amountOnly) return <MoneyField label={tr.investments.requiredTotal} value={total.raw} placeholder={unitPlaceholder} onChangeMinor={onTotal} />;
  return (
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
              error={quoted.quantityError ?? draft.oversellError}
              onChangeText={(raw) => draft.setQuantity(raw.replace(/[^\d.,]/g, "").slice(0, 30))}
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder={quantityPlaceholder}
            />
          </View>
          {draft.kind === "sell" && draft.selected && draft.heldAtoms != null ? <HeldQuantity atoms={draft.heldAtoms} /> : null}
        </View>
      </View>
      <MoneyField
        testID="investment-unit-price"
        label={tr.investments.requiredUnitPrice}
        value={unit.raw}
        placeholder={unitPlaceholder}
        onChangeMinor={(raw, minor) => draft.setUnit({ raw, minor })}
      />
      <MoneyField
        label={tr.investments.optionalTotal}
        value={total.raw}
        error={quoted.totalError}
        placeholder={quoted.calculated ? formatMinorInput(quoted.calculated.totalMinor) : tr.common.optionalHint}
        onChangeMinor={onTotal}
      />
    </>
  );
}

function OperationFields({ draft }: { draft: OperationDraft }) {
  const router = useRouter();
  const { palette } = useTheme();
  const { baseKind, products } = draft;
  const notePlaceholder = useRotatingPlaceholder(placeholderPools.investmentNote, { active: draft.note.length === 0 });
  const addProduct = () => router.push({ pathname: "/investments/product", params: { next: baseKind } });
  return (
    <Card style={{ marginBottom: spacing.lg }}>
      <PanelHeader icon={impactOf(draft.kind, palette).Icon} title={draft.title} />
      <Select
        label={tr.investments.product}
        options={products.map((product) => ({ value: product.id, label: `${product.name} · ${tr.investments.types[product.assetType]}` }))}
        value={draft.productId}
        onChange={draft.setProductId}
        placeholder={tr.investments.product}
        onCreate={baseKind === "sell" ? undefined : { label: tr.investments.addProduct, run: addProduct }}
      />
      {products.length === 0 && baseKind !== "sell" ? (
        <View style={{ marginBottom: spacing.md }}>
          <Button icon={Plus} label={tr.investments.addProduct} onPress={addProduct} />
        </View>
      ) : null}
      <DateField label={tr.investments.operationDate} value={draft.date} onChange={draft.setDate} max={todayISO()} />
      {draft.kind === "contribution" ? (
        <Segmented
          value={draft.contributionMode}
          onChange={draft.setContributionMode}
          options={[{ value: "units", label: tr.investments.contributionWithUnits }, { value: "amount", label: tr.investments.contributionAmountOnly }]}
        />
      ) : null}
      <QuoteFields draft={draft} />
      <Field label={tr.common.note} value={draft.note} onChangeText={draft.setNote} multiline placeholder={notePlaceholder} />
    </Card>
  );
}

export default function InvestmentOperationScreen() {
  const router = useRouter();
  const { palette } = useTheme();
  const draft = useOperationDraft();
  const { profilesState, editing } = draft;
  if (profilesState.updatedAt == null) {
    return <Screen><DataStateNotice status={profilesState.status} retry={profilesState.retry} /></Screen>;
  }
  if (profilesState.data.length === 0) return <Redirect href="/investments/setup" />;
  return (
    <Screen width="form">
      <Stack.Screen options={{ title: draft.title }} />
      <OperationSummary draft={draft} />
      <OperationFields draft={draft} />
      <Button testID="investment-operation-save" label={draft.title} loading={draft.busy} disabled={!draft.canSave} onPress={() => void draft.save()} />
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
          <Text style={[type.small, { color: palette.textSecondary, flex: 1, minWidth: 0, flexShrink: 1 }]}>{tr.investments.removeProductHistoryHint}</Text>
          <IconButton
            icon={Trash}
            tone="danger"
            label={tr.investments.removeProductHistory}
            onPress={() => router.push({ pathname: "/investments/correction", params: { productId: editing.productId } })}
          />
        </View>
      ) : null}
    </Screen>
  );
}
