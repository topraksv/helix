import { useState } from "react";
import { View } from "react-native";
import Banknote from "lucide-react-native/icons/banknote";
import Check from "lucide-react-native/icons/check";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import { Redirect, Stack, useRouter } from "expo-router";
import { setupInvestments } from "../../../data/repo";
import { useInvestmentProfilesState, useUserId } from "../../../data/hooks";
import { todayISO } from "../../../domain/dates";
import { userMessage } from "../../../domain/user-error";
import { tr } from "../../../i18n/tr";
import { scheduleSync } from "../../../sync/engine";
import { DateField } from "../../../ui/calendar";
import { Body, Button, Card, DataStateNotice, FieldNote, MoneyField, PanelHeader, Screen } from "../../../ui/components";
import { appAlert } from "../../../ui/dialog";
import { navigateBack } from "../../../ui/navigation";
import { useDirtyExitGuard, useDraftDirty } from "../../../ui/dirty-exit";
import { radius, spacing, useTheme } from "../../../ui/theme";

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
  const { allowExit } = useDirtyExitGuard(useDraftDirty(JSON.stringify({ date, cashRaw }), true) && !busy);

  // Empty is the common answer — nothing set aside yet — and means zero, not "not filled in".
  const openingCashMinor = cashRaw.trim() === "" ? 0 : cashMinor;
  const save = async () => {
    if (busy || openingCashMinor == null || openingCashMinor < 0) return;
    setBusy(true);
    try {
      await setupInvestments(userId, { startedOn: date, openingCashMinor });
      scheduleSync(userId);
      // One way out, to the wallet, whose first action is defining a product.
      allowExit(() => navigateBack(router, "/(tabs)/investments"));
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
          placeholder="0"
          onChangeMinor={(raw, minor) => {
            setCashRaw(raw);
            setCashMinor(minor);
          }}
        />
        <FieldNote note={tr.investments.startedOnHint}>
          <DateField label={tr.investments.startedOn} value={date} onChange={setDate} max={todayISO()} />
        </FieldNote>
      </Card>

      <View style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: palette.surfaceAlt, flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg }}>
        <ShieldCheck accessible={false} size={20} color={palette.positiveText} />
        <Body style={{ flex: 1 }}>{tr.investments.setupWithExistingHint}</Body>
      </View>
      <Button
        icon={Check}
        label={tr.investments.setupAction}
        loading={busy}
        onPress={() => void save()}
      />
    </Screen>
  );
}
