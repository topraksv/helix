import React, { useState } from "react";
import { Text, View } from "react-native";
import ArrowRight from "lucide-react-native/icons/arrow-right";
import Banknote from "lucide-react-native/icons/banknote";
import Check from "lucide-react-native/icons/check";
import PackagePlus from "lucide-react-native/icons/package-plus";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import { Redirect, Stack, useRouter } from "expo-router";
import { setupInvestments } from "../../../data/repo";
import { useInvestmentProfilesState, useUserId } from "../../../data/hooks";
import { todayISO } from "../../../domain/dates";
import { userMessage } from "../../../domain/user-error";
import { tr } from "../../../i18n/tr";
import { scheduleSync } from "../../../sync/engine";
import { DateField } from "../../../ui/calendar";
import { Body, Button, Card, DataStateNotice, MoneyField, PanelHeader, Screen } from "../../../ui/components";
import { appAlert } from "../../../ui/dialog";
import { navigateBack } from "../../../ui/navigation";
import { placeholderPools, useRotatingPlaceholder } from "../../../ui/placeholders";
import { circle, radius, spacing, type, useTheme } from "../../../ui/theme";

export default function InvestmentSetupScreen() {
  const router = useRouter();
  const userId = useUserId();
  const profilesState = useInvestmentProfilesState();
  const profile = profilesState.data[0];
  const { palette } = useTheme();
  const [date, setDate] = useState(todayISO());
  const [cashRaw, setCashRaw] = useState("");
  const [cashMinor, setCashMinor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const amountPlaceholder = useRotatingPlaceholder(placeholderPools.amount, { prefix: false });

  const save = async () => {
    if (busy || cashMinor == null || cashMinor < 0) return;
    setBusy(true);
    try {
      await setupInvestments(userId, { startedOn: date, openingCashMinor: cashMinor });
      scheduleSync(userId);
      // One way out, to the wallet, where "Yeni Ürün Tanımla" is the first
      // thing on the screen. A second button that only skipped that one tap
      // read as a second, different action and was not one.
      navigateBack(router, "/(tabs)/investments");
    } catch (error) {
      void appAlert(userMessage(error, tr.errors.saveFailed), tr.errors.title);
    } finally {
      setBusy(false);
    }
  };

  if (profilesState.updatedAt == null) {
    return <Screen><DataStateNotice status={profilesState.status} retry={profilesState.retry} /></Screen>;
  }
  if (profile) return <Redirect href="/(tabs)/investments" />;

  return (
    <Screen width="form">
      <Stack.Screen options={{ title: tr.investments.setupTitle }} />
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={tr.investments.setupBody}
        style={{ alignItems: "center", marginBottom: spacing.xl }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm }}>
          {[
            { icon: Banknote, label: tr.investments.openingCash, active: true },
            { icon: PackagePlus, label: tr.investments.addProduct, active: false },
            { icon: Check, label: tr.investments.movement, active: false },
          ].map((step, index) => {
            const Icon = step.icon;
            return (
              <React.Fragment key={step.label}>
                {index > 0 ? <ArrowRight accessible={false} size={18} color={palette.textSecondary} /> : null}
                <View style={{ width: 82, alignItems: "center", gap: spacing.xs }}>
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: circle(48),
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: step.active ? palette.primary : palette.surfaceAlt,
                    }}
                  >
                    <Icon size={21} color={step.active ? palette.onPrimary : palette.textSecondary} />
                  </View>
                  <Text style={[type.small, { color: step.active ? palette.primaryText : palette.textSecondary, textAlign: "center", fontSize: type.micro.fontSize }]}>
                    {step.label}
                  </Text>
                </View>
              </React.Fragment>
            );
          })}
        </View>
      </View>

      <Card style={{ marginBottom: spacing.lg }}>
        <PanelHeader
          icon={Banknote}
          title={tr.investments.setupDetails}
          description={tr.investments.setupDetailsHint}
        />
        <MoneyField
          testID="investment-opening-cash"
          label={tr.investments.openingCash}
          value={cashRaw}
          placeholder={amountPlaceholder}
          onChangeMinor={(raw, minor) => {
            setCashRaw(raw);
            setCashMinor(minor);
          }}
        />
        <DateField label={tr.investments.startedOn} value={date} onChange={setDate} max={todayISO()} />
      </Card>

      <View style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: palette.surfaceAlt, flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg }}>
        <ShieldCheck accessible={false} size={20} color={palette.positiveText} />
        <Body style={{ flex: 1 }}>{tr.investments.setupWithExistingHint}</Body>
      </View>
      <View style={{ gap: spacing.sm }}>
        <Button
          icon={cashMinor != null ? Check : Banknote}
          label={tr.investments.setupAction}
          loading={busy}
          disabled={cashMinor == null || cashMinor < 0 || busy}
          onPress={() => void save()}
        />
      </View>
    </Screen>
  );
}
