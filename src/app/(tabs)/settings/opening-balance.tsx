/**
 * Edit the opening balance and start month after onboarding. Closes the gap
 * where a wrong value entered during setup silently skewed the current balance
 * with no way to correct it (it isn't a transaction, so it never showed in the
 * cash-flow matrix and couldn't be deleted there).
 */

import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { writeSetting } from "../../../db/mutations";
import { settingValue, useSettingsMap, useUserId } from "../../../data/hooks";
import { scheduleSync } from "../../../sync/engine";
import { addMonthsToKey, monthKeyOf, todayISO } from "../../../domain/dates";
import { formatMinor } from "../../../domain/money";
import { monthLabel, tr } from "../../../i18n/tr";
import { Body, Button, Card, Heading, IconButton, MoneyField, Screen, Spread } from "../../../ui/components";
import { appAlert } from "../../../ui/dialog";
import { spacing } from "../../../ui/theme";

export default function OpeningBalanceScreen() {
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

  const save = async () => {
    if (openingMinor == null) return;
    setBusy(true);
    try {
      await writeSetting(userId, "start_month", startMonth);
      await writeSetting(userId, "opening_balance_minor", openingMinor);
      scheduleSync(userId);
      router.back();
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
