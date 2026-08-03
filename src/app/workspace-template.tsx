/**
 * Starter template screen: shows the same category set a new account is offered
 * during onboarding, and lets ANY user add the ones they don't have yet. It's
 * additive — matched by name, existing categories are never touched — so it's
 * safe to open anytime (and lets the first-run template be reviewed/tested
 * without creating a fresh account).
 */

import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { CheckCircle2, LayoutGrid } from "lucide-react-native";
import { addTemplateCategories, TEMPLATE_CATEGORIES, TEMPLATE_EXTRA_CATEGORIES } from "../data/repo";
import { useCategoriesState, useUserId } from "../data/hooks";
import { combineLiveQueryStatus } from "../data/live-state";
import { tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { Button, DataStateNotice, EmptyState, Screen, SectionHeader, SelectionGrid } from "../ui/components";
import { navigateBack } from "../ui/navigation";
import { useOperationGuard } from "../ui/operation-guard";
import { appAlert } from "../ui/dialog";
import { WorkspaceSplit } from "../ui/workspace-layout";

const ALL_TEMPLATES = [...TEMPLATE_CATEGORIES, ...TEMPLATE_EXTRA_CATEGORIES];

const norm = (s: string) => s.toLocaleLowerCase("tr-TR");
/**
 * One tile per template category. The icon is passed separately rather than
 * packed into the label: `ToggleGrid` gives it a fixed column, so the names
 * line up instead of starting wherever the previous emoji's advance width
 * happened to end.
 */
const tile = (c: (typeof TEMPLATE_CATEGORIES)[number]) => ({
  value: c.name,
  label: `${c.name} · ${c.kind === "income" ? tr.settings.kindIncome : tr.settings.kindExpense}`,
  icon: c.icon,
});

export default function WorkspaceTemplateModal() {
  const userId = useUserId();
  const categoriesState = useCategoriesState();
  const categories = categoriesState.data;
  const router = useRouter();
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const operationGuard = useOperationGuard();
  const dataReady = categoriesState.updatedAt != null;

  const existing = new Set(categories.map((c) => norm(c.name)));
  const missing = ALL_TEMPLATES.filter((c) => !existing.has(norm(c.name)));
  const have = ALL_TEMPLATES.filter((c) => existing.has(norm(c.name)));
  const selected = missing.filter((c) => !excluded.includes(c.name));

  const add = async () => {
    if (selected.length === 0) return;
    await operationGuard.run(async () => {
      setBusy(true);
      try {
        await addTemplateCategories(userId, selected, categories.length);
        scheduleSync(userId);
        navigateBack(router, "/(tabs)/settings");
      } catch {
        void appAlert(tr.errors.saveFailed, tr.errors.title);
      } finally {
        setBusy(false);
      }
    });
  };

  if (!dataReady) {
    return (
      <Screen>
        <DataStateNotice status={combineLiveQueryStatus([categoriesState])} retry={categoriesState.retry} />
      </Screen>
    );
  }

  return (
    <Screen width="workspace">
      <DataStateNotice status={combineLiveQueryStatus([categoriesState])} retry={categoriesState.retry} />
      <WorkspaceSplit
        testID="workspace-template-layout"
        primary={(
          <View>
            <SectionHeader description={tr.template.toAddHint}>{tr.template.toAddTitle}</SectionHeader>
            {missing.length === 0 ? (
              <EmptyState icon={CheckCircle2} title={tr.template.allPresent} />
            ) : (
              <>
                <SelectionGrid
                  options={missing.map(tile)}
                  values={selected.map((c) => c.name)}
                  onToggle={(name) => setExcluded((xs) => (xs.includes(name) ? xs.filter((x) => x !== name) : [...xs, name]))}
                  searchable
                  countLabel={tr.computed.selectedCount(selected.length)}
                />
                <Button label={tr.template.addSelected(selected.length)} onPress={() => void add()} loading={busy} disabled={selected.length === 0} />
              </>
            )}
          </View>
        )}
        secondary={(
          <View>
            {/* No container opacity here: fading the subtree also fades its
                text below AA. Position and read-only controls carry state. */}
            <SectionHeader description={tr.template.haveHint}>{tr.template.haveTitle}</SectionHeader>
            {have.length > 0 ? (
              <SelectionGrid options={have.map(tile)} values={[]} onToggle={() => {}} searchable readOnly />
            ) : (
              <EmptyState icon={LayoutGrid} title={tr.template.nonePresent} />
            )}
          </View>
        )}
      />
    </Screen>
  );
}
