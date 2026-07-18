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
import { CheckCircle2 } from "lucide-react-native";
import { deterministicId, naturalKeys } from "../db/ids";
import { writeRows, type RowWrite } from "../db/mutations";
import { TEMPLATE_CATEGORIES, TEMPLATE_EXTRA_CATEGORIES } from "../data/repo";
import { useCategories, useUserId } from "../data/hooks";
import { tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { Body, Button, ChipPicker, EmptyState, Screen, SectionHeader } from "../ui/components";
import { spacing } from "../ui/theme";
import { navigateBack } from "../ui/navigation";
import { useOperationGuard } from "../ui/operation-guard";

const ALL_TEMPLATES = [...TEMPLATE_CATEGORIES, ...TEMPLATE_EXTRA_CATEGORIES];

const norm = (s: string) => s.toLocaleLowerCase("tr-TR");
const chip = (c: (typeof TEMPLATE_CATEGORIES)[number]) =>
  `${c.icon ?? ""} ${c.name} · ${c.kind === "income" ? tr.settings.kindIncome : tr.settings.kindExpense}`.trim();

export default function WorkspaceTemplateModal() {
  const userId = useUserId();
  const categories = useCategories();
  const router = useRouter();
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const operationGuard = useOperationGuard();

  const existing = new Set(categories.map((c) => norm(c.name)));
  const missing = ALL_TEMPLATES.filter((c) => !existing.has(norm(c.name)));
  const have = ALL_TEMPLATES.filter((c) => existing.has(norm(c.name)));
  const selected = missing.filter((c) => !excluded.includes(c.name));

  const add = async () => {
    if (selected.length === 0) return;
    await operationGuard.run(async () => {
      setBusy(true);
      try {
        const base = categories.length;
        const writes: RowWrite[] = await Promise.all(
          selected.map(async (category, index) => ({
            table: "categories" as const,
            row: {
              id: await deterministicId(naturalKeys.seedCategory(userId, category.name)),
              name: category.name,
              kind: category.kind,
              icon: category.icon ?? null,
              color: null,
              sortOrder: base + index,
              isColumn: true,
              deletedAt: null,
            },
          })),
        );
        await writeRows(userId, writes);
        scheduleSync(userId);
        navigateBack(router, "/(tabs)/settings");
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <Screen>
      <Body muted style={{ marginBottom: spacing.md }}>{tr.template.intro}</Body>

      {missing.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={tr.template.allPresent} />
      ) : (
        <>
          <SectionHeader>{tr.template.toAddTitle}</SectionHeader>
          <ChipPicker
            multi
            options={missing.map((c) => ({ value: c.name, label: chip(c) }))}
            values={selected.map((c) => c.name)}
            onToggle={(name) => setExcluded((xs) => (xs.includes(name) ? xs.filter((x) => x !== name) : [...xs, name]))}
          />
          <Button label={tr.template.addSelected(selected.length)} onPress={() => void add()} loading={busy} disabled={selected.length === 0} />
        </>
      )}

      {have.length > 0 ? (
        <View style={{ marginTop: spacing.lg, opacity: 0.6 }}>
          <SectionHeader>{tr.template.haveTitle}</SectionHeader>
          <ChipPicker multi options={have.map((c) => ({ value: c.name, label: chip(c) }))} values={[]} onToggle={() => {}} />
        </View>
      ) : null}
    </Screen>
  );
}
