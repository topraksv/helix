import React, { useState } from "react";
import { Text, View } from "react-native";
import {
  Bitcoin,
  ChartNoAxesCombined,
  Coins,
  Landmark,
  PackagePlus,
  Umbrella,
  Shapes,
  WalletCards,
  type LucideIcon,
} from "lucide-react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { saveInvestmentProduct } from "../../../data/repo";
import { useInvestmentProfilesState, useUserId } from "../../../data/hooks";
import { INVESTMENT_MARKET_TITLES } from "../../../domain/investment-catalog";
import type { InvestmentAssetType, InvestmentOperationKind } from "../../../domain/investments";
import { userMessage } from "../../../domain/user-error";
import { tr } from "../../../i18n/tr";
import { scheduleSync } from "../../../sync/engine";
import { Body, Button, Card, ChoiceTile, DataStateNotice, Field, PanelHeader, Screen, Select } from "../../../ui/components";
import { appAlert } from "../../../ui/dialog";
import { navigateBack } from "../../../ui/navigation";
import { placeholderPools, useRotatingPlaceholder } from "../../../ui/placeholders";
import { font, radius, spacing, type, useTheme, type Palette } from "../../../ui/theme";

function metalMark(
  mark: string,
  tone: "gold" | "silver" | "copper",
  palette: Palette,
) {
  const colors = tone === "gold"
    ? { backgroundColor: palette.tertiarySoft, color: palette.tertiaryText }
    : tone === "silver"
      ? { backgroundColor: palette.surfaceStrong, color: palette.textStrong }
      : { backgroundColor: palette.warning + "24", color: palette.warningText };
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: radius.full,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.backgroundColor,
      }}
    >
      <Text style={[type.small, { color: colors.color, fontFamily: font.bold, fontSize: type.micro.fontSize, lineHeight: 12 }]}>{mark}</Text>
    </View>
  );
}

const TYPES: InvestmentAssetType[] = ["metal", "currency", "equity", "fund", "crypto", "pension"];
const TYPE_ICONS: Record<InvestmentAssetType, LucideIcon> = {
  metal: Coins,
  currency: WalletCards,
  equity: ChartNoAxesCombined,
  fund: Landmark,
  crypto: Bitcoin,
  pension: Umbrella,
};

export default function InvestmentProductScreen() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const nextOperation: InvestmentOperationKind | null =
    next === "existing" || next === "buy" || next === "sell" || next === "contribution"
      ? next
      : null;
  const userId = useUserId();
  const profilesState = useInvestmentProfilesState();
  const { palette } = useTheme();
  const [assetType, setAssetType] = useState<InvestmentAssetType>(
    nextOperation === "contribution" ? "pension" : "metal",
  );
  const [marketCode, setMarketCode] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const productPlaceholder = useRotatingPlaceholder(placeholderPools.investmentProduct);
  const notePlaceholder = useRotatingPlaceholder(placeholderPools.investmentNote);
  const catalog = INVESTMENT_MARKET_TITLES.filter((item) => item.assetType === assetType);
  const catalogMode = assetType === "metal" || assetType === "currency";
  const selectedCatalog = catalog.find((item) => item.code === marketCode);
  const customCode = assetType === "metal" ? "OTHER_METAL" : "OTHER_CURRENCY";
  const customCatalog = catalogMode && marketCode === customCode;
  const ProductIcon = TYPE_ICONS[assetType];
  const effectiveName = catalogMode
    ? customCatalog ? name.trim() : selectedCatalog?.label ?? ""
    : name.trim();

  if (profilesState.updatedAt == null) {
    return <Screen><DataStateNotice status={profilesState.status} retry={profilesState.retry} /></Screen>;
  }
  if (profilesState.data.length === 0) return <Redirect href="/investments/setup" />;

  const save = async () => {
    if (!effectiveName || busy) return;
    setBusy(true);
    try {
      const id = await saveInvestmentProduct(userId, {
        assetType,
        name: effectiveName,
        marketCode: catalogMode && !customCatalog ? marketCode : null,
        note,
      });
      scheduleSync(userId);
      if (nextOperation) {
        router.replace({ pathname: "/investments/operation", params: { kind: nextOperation, productId: id } });
      } else {
        navigateBack(router, "/(tabs)/investments");
      }
    } catch (error) {
      void appAlert(userMessage(error, tr.errors.saveFailed), tr.errors.title);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen width="form">
      <Card style={{ marginBottom: spacing.lg }}>
        <PanelHeader icon={Shapes} title={tr.investments.productType} />
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={tr.investments.productType}
          style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md }}
        >
          {TYPES.map((typeKey) => {
            const selected = typeKey === assetType;
            const Icon = TYPE_ICONS[typeKey];
            return (
              <ChoiceTile
                key={typeKey}
                label={tr.investments.types[typeKey]}
                selected={selected}
                basis={102}
                minHeight={76}
                onPress={() => {
                  setAssetType(typeKey);
                  setMarketCode(null);
                  setName("");
                }}
              >
                <Icon accessible={false} size={22} color={selected ? palette.primaryText : palette.textSecondary} />
              </ChoiceTile>
            );
          })}
        </View>
        {catalogMode ? (
          <Select
            label={tr.investments.marketProduct}
            options={catalog.map((item) => ({
              value: item.code,
              label: item.label,
              icon: item.assetType === "currency"
                ? item.icon
                : metalMark(item.mark ?? "•", item.metalTone ?? "gold", palette),
            }))}
            value={marketCode}
            onChange={setMarketCode}
            placeholder={tr.investments.marketProduct}
            selectedOption={customCatalog ? {
              value: customCode,
              label: assetType === "metal" ? tr.markets.otherMetal : tr.markets.otherCurrency,
            } : undefined}
            onCreate={{
              label: assetType === "metal" ? tr.markets.addOtherMetal : tr.markets.addOtherCurrency,
              run: () => {
                setMarketCode(customCode);
                setName("");
              },
            }}
          />
        ) : null}
        {!catalogMode || customCatalog ? (
          <Field
            label={tr.investments.productName}
            value={name}
            onChangeText={setName}
            placeholder={productPlaceholder}
          />
        ) : null}
        <Field label={tr.investments.productNote} value={note} onChangeText={setNote} multiline placeholder={notePlaceholder} />
      </Card>

      {effectiveName ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: palette.surfaceAlt, marginBottom: spacing.lg }}>
          <ProductIcon accessible={false} size={20} color={palette.primaryText} />
          <Body style={{ flex: 1 }}>{effectiveName} · {tr.investments.types[assetType]}</Body>
        </View>
      ) : null}
      <Button icon={PackagePlus} label={tr.investments.saveProduct} loading={busy} disabled={!effectiveName || busy} onPress={() => void save()} />
    </Screen>
  );
}
