/**
 * Edit the start month + current (opening) balance. Shared body used by both
 * the Settings sub-screen and a top-level modal opened from Mali Tablo, so it
 * always has a working back/close regardless of where it was launched.
 */

import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { writeSetting } from "../db/mutations";
import { settingValue, useSettingsMap, useUserId } from "../data/hooks";
import { scheduleSync } from "../sync/engine";
import { addMonthsToKey, monthKeyOf, todayISO } from "../domain/dates";
import { formatMinor } from "../domain/money";
import { monthLabel, tr } from "../i18n/tr";
import { Body, Button, Card, Heading, IconButton, MoneyField, Screen, Spread } from "./components";
import { appAlert } from "./dialog";
import { spacing } from "./theme";

export function OpeningBalanceEditor() {
  const userId = useUserId();
  const settings = useSettingsMap();
  const router = useRouter();

  const currentStart = settingValue<string>(settings, "start_month", monthKeyOf(todayISO()));
  const currentOpening = settingValue<number>(settings, "opening_balance_minor", 0);

  const [startMonth, setStartMonth] = useState(currentStart);
  const [openingRaw, setOpeningRaw] = useState((currentOpening / 100).toFixed(2).replace(".", ","));
  const [openingMinor, setOpeningMinor] = useState<number | null>(currentOpening);
  const [busy, setBusy] = useState(false);

  const dirty = openingMinor !== currentOpening || startMonth !== currentStart;
  const close = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/cash-flow"));

  const save = async () => {
    if (openingMinor == null) return;
    setBusy(true);
    try {
      await writeSetting(userId, "start_month", startMonth);
      await writeSetting(userId, "opening_balance_minor", openingMinor);
      scheduleSync(userId);
      close();
    } catch (e) {
      void appAlert(e instanceof Error ? e.message : String(e), tr.errors.title);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Body muted style={{ marginBottom: spacing.md }}>{tr.settings.openingScreenHint}</Body>
      <Card>
        <Body muted style={{ marginBottom: spacing.sm }}>{tr.onboarding.startMonth}</Body>
        <Spread style={{ marginBottom: spacing.lg }}>
          <IconButton icon={ChevronLeft} label={tr.onboarding.startMonth} onPress={() => setStartMonth(addMonthsToKey(startMonth, -1))} />
          <Heading style={{ marginVertical: 0 }}>{monthLabel(startMonth)}</Heading>
          <IconButton icon={ChevronRight} label={tr.onboarding.startMonth} onPress={() => setStartMonth(addMonthsToKey(startMonth, 1))} />
        </Spread>
        <MoneyField
          label={tr.onboarding.openingBalance}
          value={openingRaw}
          onChangeMinor={(raw, minor) => {
            setOpeningRaw(raw);
            setOpeningMinor(minor);
          }}
        />
        <Body muted style={{ marginBottom: spacing.md, fontSize: 12 }}>
          {tr.settings.opening}: {formatMinor(currentOpening)}
        </Body>
        <Button label={tr.common.save} onPress={() => void save()} disabled={!dirty || openingMinor == null} loading={busy} />
      </Card>
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}
