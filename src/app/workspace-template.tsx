/**
 * Starter template screen: shows the same category set a new account is offered
 * during onboarding, and lets ANY user add the ones they don't have yet. It's
 * additive — matched by name, existing categories are never touched — so it's
 * safe to open anytime (and lets the first-run template be reviewed/tested
 * without creating a fresh account).
 */

import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import CheckCircle2 from "lucide-react-native/icons/circle-check";
import LayoutGrid from "lucide-react-native/icons/layout-grid";
import { addTemplateCategories, TEMPLATE_CATEGORIES, TEMPLATE_EXTRA_CATEGORIES } from "../data/repo";
import { useCategoriesState, useUserId } from "../data/hooks";
import { combineLiveStates } from "../data/live-state";
import { tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { categoryIconComponent } from "../ui/category-icon";
import { Button, DataGateScreen, DataStateNotice, EmptyState, Screen, SectionHeader, SelectionGrid } from "../ui/components";
import { navigateBack } from "../ui/navigation";
import { useOperationGuard } from "../ui/operation-guard";
import { appAlert } from "../ui/dialog";
import { WorkspaceSplit } from "../ui/workspace-layout";

const ALL_TEMPLATES = [...TEMPLATE_CATEGORIES, ...TEMPLATE_EXTRA_CATEGORIES];

const norm = (s: string) => s.toLocaleLowerCase("tr-TR");
/**
 * One tile per template category. The mark is passed separately rather than
 * packed into the label, so the names line up in their own column instead of
 * starting wherever the previous mark's advance width happened to end.
 */
const tile = (c: (typeof TEMPLATE_CATEGORIES)[number]) => ({
  value: c.name,
  label: `${c.name} · ${c.kind === "income" ? tr.settings.kindIncome : tr.settings.kindExpense}`,
  icon: categoryIconComponent(c),
});

export default function WorkspaceTemplateModal() {
  const userId = useUserId();
  const categoriesState = useCategoriesState();
  const categories = categoriesState.data;
  const router = useRouter();
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const operationGuard = useOperationGuard();
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([categoriesState]);

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

  if (!dataReady) return <DataGateScreen status={dataStatus} retry={retryData} />;

  return (
    <Screen width="workspace">
      <DataStateNotice status={dataStatus} retry={retryData} />
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
