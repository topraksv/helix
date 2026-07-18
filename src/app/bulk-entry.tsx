/** Bulk history entry (approved feature): fill a whole past month like an
 *  Excel row — one total per category, saved as aggregate transactions. */

import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { bulkMonthEntry } from "../data/repo";
import { useCategories, usePersons, useUserId } from "../data/hooks";
import { categoryIcon } from "../data/category-icons";
import { addMonthsToKey, isCurrentOrFutureMonth, monthKeyOf, todayISO } from "../domain/dates";
import { monthLabel, tr } from "../i18n/tr";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { Body, Button, Heading, IconButton, MoneyField, Screen, Spread } from "../ui/components";
import { appAlert } from "../ui/dialog";
import { scheduleSync } from "../sync/engine";
import { spacing } from "../ui/theme";
import { navigateBack } from "../ui/navigation";
import { newId } from "../db/ids";
import { useOperationGuard } from "../ui/operation-guard";

export default function BulkEntryModal() {
  const userId = useUserId();
  const categories = useCategories();
  const persons = usePersons();
  const router = useRouter();
  const [month, setMonth] = useState(addMonthsToKey(monthKeyOf(todayISO()), -1));
  const [values, setValues] = useState<Record<string, { raw: string; minor: number | null }>>({});
  const [busy, setBusy] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const operationGuard = useOperationGuard();

  const selfId = persons.find((p) => p.isSelf)?.id;
  const rows = [...categories].sort((a, b) => (a.kind === b.kind ? a.sortOrder - b.sortOrder : a.kind === "expense" ? -1 : 1));

  const entries = rows
    .map((c) => ({ category: c, minor: values[c.id]?.minor ?? null }))
    .filter((e) => e.minor != null && e.minor > 0);
  const invalid = rows.some((c) => {
    const v = values[c.id];
    return v && v.raw.trim() !== "" && v.minor === null;
  });

  const save = async () => {
    if (!selfId || entries.length === 0) return;
    await operationGuard.run(async () => {
      setBusy(true);
      try {
        await bulkMonthEntry(
          userId,
          month,
          selfId,
          entries.map((e) => ({
            categoryId: e.category.id,
            kind: e.category.kind,
            amountMinor: e.minor!,
            isInvestment: e.category.name.toLocaleLowerCase("tr-TR").includes("yatırım"),
          })),
          newId(),
        );
        scheduleSync(userId);
        setSavedMsg(tr.bulk.saved(monthLabel(month)));
        setValues({});
        setMonth(addMonthsToKey(month, -1)); // convenient: walk backwards month by month
      } catch (e) {
        void appAlert(e instanceof Error ? e.message : String(e), tr.errors.title);
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <Screen>
      <Body muted style={{ marginBottom: spacing.md }}>{tr.bulk.subtitle}</Body>
      <Spread style={{ marginBottom: spacing.lg }}>
        <IconButton icon={ChevronLeft} label={tr.bulk.month} onPress={() => setMonth(addMonthsToKey(month, -1))} />
        <Heading>{monthLabel(month)}</Heading>
        <IconButton
          icon={ChevronRight}
          label={tr.bulk.month}
          onPress={() => setMonth(addMonthsToKey(month, 1))}
          disabled={isCurrentOrFutureMonth(addMonthsToKey(month, 1))}
        />
      </Spread>

      {rows.map((c) => (
        <MoneyField
          key={c.id}
          label={`${categoryIcon(c)} ${c.name} · ${c.kind === "income" ? tr.settings.kindIncome : tr.settings.kindExpense}`}
          value={values[c.id]?.raw ?? ""}
          onChangeMinor={(raw, minor) => setValues((v) => ({ ...v, [c.id]: { raw, minor } }))}
        />
      ))}

      <Body muted style={{ marginBottom: spacing.md }}>{tr.bulk.hint}</Body>
      {savedMsg ? <Body style={{ marginBottom: spacing.md }}>✅ {savedMsg}</Body> : null}
      <View style={{ gap: spacing.sm }}>
        <Button label={tr.common.save} onPress={() => void save()} disabled={entries.length === 0 || invalid} loading={busy} />
        <Button label={tr.common.done} variant="secondary" onPress={() => navigateBack(router, "/(tabs)/cash-flow")} />
      </View>
    </Screen>
  );
}
