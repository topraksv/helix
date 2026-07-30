/** Bulk history entry (approved feature): fill a whole past month like an
 *  Excel row — one total per category, saved as aggregate transactions. */

import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { bulkMonthEntry } from "../data/repo";
import { useCategoriesState, usePersonsState, useUserId } from "../data/hooks";
import { combineLiveQueryStatus } from "../data/live-state";
import { categoryIcon } from "../data/category-icons";
import { addMonthsToKey, isCurrentOrFutureMonth, monthKeyOf, todayISO } from "../domain/dates";
import { categoryTableEntryType } from "../domain/transactions";
import { monthLabel, tr } from "../i18n/tr";
import { CalendarRange, ChevronLeft, ChevronRight, ListPlus } from "lucide-react-native";
import { Badge, Body, Button, Card, DataStateNotice, EmptyState, Heading, IconButton, MoneyField, OperationStatusNotice, PanelHeader, Screen, Spread } from "../ui/components";
import { appAlert } from "../ui/dialog";
import { scheduleSync } from "../sync/engine";
import { userMessage } from "../domain/user-error";
import { devError } from "../services/logger";
import { spacing } from "../ui/theme";
import { navigateBack } from "../ui/navigation";
import { OperationCancelledError, useTrackedOperation } from "../ui/operation-guard";
import { useDirtyExitGuard } from "../ui/dirty-exit";
import { WorkspaceGrid } from "../ui/workspace-layout";

export default function BulkEntryModal() {
  const userId = useUserId();
  const categoriesState = useCategoriesState();
  const personsState = usePersonsState();
  const categories = categoriesState.data;
  const persons = personsState.data;
  const router = useRouter();
  const [month, setMonth] = useState(addMonthsToKey(monthKeyOf(todayISO()), -1));
  const [values, setValues] = useState<Record<string, { raw: string; minor: number | null }>>({});
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const operation = useTrackedOperation();
  const busy = operation.state.active;
  const { confirmDiscard } = useDirtyExitGuard(Object.values(values).some((value) => value.raw.trim() !== "") && !busy);
  const liveStates = [categoriesState, personsState];
  const dataStatus = combineLiveQueryStatus(liveStates);
  const dataReady = liveStates.every((state) => state.updatedAt != null);
  const retryData = () => {
    categoriesState.retry();
    personsState.retry();
  };

  const selfId = persons.find((p) => p.isSelf)?.id;
  const rows = [...categories].sort((a, b) => (a.kind === b.kind ? a.sortOrder - b.sortOrder : a.kind === "expense" ? -1 : 1));

  const entries = rows
    .map((c) => ({ category: c, minor: values[c.id]?.minor ?? null }))
    .filter((e) => e.minor != null && e.minor > 0);
  const invalid = rows.some((c) => {
    const v = values[c.id];
    return v && v.raw.trim() !== "" && v.minor === null;
  });
  const changeMonth = (next: string) => {
    confirmDiscard(() => {
      setValues({});
      setSavedMsg(null);
      setMonth(next);
    });
  };

  const save = async () => {
    if (!selfId || entries.length === 0) return;
    await operation.run(async ({ signal }) => {
      try {
        if (signal.aborted) throw signal.reason;
        setCommitting(true);
        await bulkMonthEntry(
          userId,
          month,
          selfId,
          entries.map((e) => ({
            categoryId: e.category.id,
            type: categoryTableEntryType(e.category),
            amountMinor: e.minor!,
          })),
        );
        scheduleSync(userId);
        setSavedMsg(tr.bulk.saved(monthLabel(month)));
        setValues({});
        setMonth(addMonthsToKey(month, -1)); // convenient: walk backwards month by month
      } catch (e) {
        if (e instanceof OperationCancelledError) return;
        devError("bulk-entry.save", e);
        void appAlert(userMessage(e, tr.errors.saveFailed), tr.errors.title);
      } finally {
        setCommitting(false);
      }
    });
  };

  if (!dataReady) {
    return (
      <Screen>
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

  return (
    <Screen maxWidth={1100}>
      <DataStateNotice status={dataStatus} retry={retryData} />
      <Card>
        <PanelHeader
          icon={ListPlus}
          title={tr.bulk.amountsTitle}
          description={tr.bulk.amountsHint}
          right={<Badge text={tr.bulk.filledCount(entries.length)} tone="muted" />}
        />
        <Spread style={{ marginBottom: spacing.md }}>
          <IconButton icon={ChevronLeft} label={tr.bulk.month} onPress={() => changeMonth(addMonthsToKey(month, -1))} />
          <Heading style={{ marginVertical: 0 }}>{monthLabel(month)}</Heading>
          <IconButton
            icon={ChevronRight}
            label={tr.bulk.month}
            onPress={() => changeMonth(addMonthsToKey(month, 1))}
            disabled={isCurrentOrFutureMonth(addMonthsToKey(month, 1))}
          />
        </Spread>
        {rows.length === 0 ? (
          <>
            <EmptyState
              icon={CalendarRange}
              title={tr.bulk.emptyCategoriesTitle}
              hint={tr.bulk.emptyCategoriesHint}
            />
            <Button
              label={tr.settings.categories}
              variant="secondary"
              onPress={() => router.push("/columns-editor")}
            />
          </>
        ) : (
          <>
            <WorkspaceGrid
        testID="bulk-entry-workspace"
            >
              {rows.map((c) => (
                <View key={c.id}>
                  <MoneyField
                    label={`${categoryIcon(c)} ${c.name} · ${c.kind === "income" ? tr.settings.kindIncome : tr.settings.kindExpense}`}
                    value={values[c.id]?.raw ?? ""}
                    onChangeMinor={(raw, minor) => setValues((v) => ({ ...v, [c.id]: { raw, minor } }))}
                    inline
                  />
                </View>
              ))}
            </WorkspaceGrid>
            <Body muted style={{ marginBottom: spacing.md }}>{tr.bulk.hint}</Body>
            {savedMsg ? <Body style={{ marginBottom: spacing.md }}>✅ {savedMsg}</Body> : null}
            <OperationStatusNotice
              state={operation.state}
              label={tr.operation.saving}
              onCancel={committing ? undefined : operation.cancel}
            />
            <View style={{ gap: spacing.sm }}>
              <Button label={tr.common.save} onPress={() => void save()} disabled={entries.length === 0 || invalid} loading={busy} />
              <Button label={tr.common.done} variant="secondary" onPress={() => confirmDiscard(() => navigateBack(router, "/(tabs)/cash-flow"))} />
            </View>
          </>
        )}
      </Card>
    </Screen>
  );
}
