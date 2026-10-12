import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Trash from "lucide-react-native/icons/trash";
import { Body, Button, Card, ChipPicker, PanelHeader, Row, Spread } from "./components";
import { ModalCard } from "./dialog";
import { interactionSurface } from "./interaction";
import { tr } from "../i18n/tr";
import { controlSize, radius, spacing, type, useTheme } from "./theme";
import type { CategoryReferenceUsage } from "../data/repo";

/** Chosen when the user keeps the records but gives them no column. */
export const UNCATEGORIZED_CHOICE = "__uncategorized__";

export interface CategoryDeleteCandidate {
  id: string;
  name: string;
}

function usageBreakdown(usage: CategoryReferenceUsage): string {
  return [
    usage.transactions > 0 ? tr.settings.deleteCategoryUsageTransactions(usage.transactions) : null,
    usage.subscriptions > 0 ? tr.settings.deleteCategoryUsageSubscriptions(usage.subscriptions) : null,
    usage.recurringIncomes > 0 ? tr.settings.deleteCategoryUsageIncomes(usage.recurringIncomes) : null,
    usage.installmentPlans > 0 ? tr.settings.deleteCategoryUsagePlans(usage.installmentPlans) : null,
    usage.cellNotes > 0 ? tr.settings.deleteCategoryUsageNotes(usage.cellNotes) : null,
  ].filter(Boolean).join(", ");
}

/** A sheet, not an inline card: the trigger sits deep in a long list. Options are inline because a Select would open a modal inside a modal. */
export function CategoryDeleteSheet({
  categoryName,
  usage,
  candidates,
  onCancel,
  onConfirm,
}: {
  categoryName: string;
  usage: CategoryReferenceUsage;
  candidates: CategoryDeleteCandidate[];
  onCancel: () => void;
  onConfirm: (choice: string) => void | Promise<void>;
}) {
  const { palette } = useTheme();
  // A rule with no column cannot be confirmed later (`confirmExpected`
  // requires a live category), so those references have to be re-homed.
  // Transactions, plans and notes have safe answers without one.
  const rulesAttached = usage.subscriptions > 0 || usage.recurringIncomes > 0;
  const normalized = categoryName.trim().toLocaleLowerCase("tr-TR");
  // The Excel year-split ("2025 Market" and "2026 Market") is the common case
  // for a merge, so an identically named column is offered first.
  const sameName = candidates.find((candidate) => candidate.name.trim().toLocaleLowerCase("tr-TR") === normalized);
  const [choice, setChoice] = useState<string | null>(
    sameName?.id ?? (rulesAttached ? candidates[0]?.id ?? null : UNCATEGORIZED_CHOICE),
  );
  const [saving, setSaving] = useState(false);

  const options = [
    ...(rulesAttached ? [] : [{ value: UNCATEGORIZED_CHOICE, label: tr.settings.deleteCategoryUncategorized, hint: tr.settings.deleteCategoryUncategorizedHint }]),
    ...candidates.map((candidate) => ({ value: candidate.id, label: candidate.name, hint: tr.settings.deleteCategoryMergeHint })),
  ];

  const confirm = async () => {
    if (choice == null || saving) return;
    setSaving(true);
    try {
      await onConfirm(choice);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalCard title={tr.settings.deleteCategorySheetTitle(categoryName)} testID="category-delete-resolution" cardWidth={460} onClose={onCancel}>
      <Body muted style={{ marginTop: spacing.xs }}>
        {tr.settings.deleteCategoryUsageIntro(usage.total, usageBreakdown(usage))}
      </Body>

      {rulesAttached ? (
        <Body muted style={{ marginTop: spacing.sm, color: palette.warningText }}>{tr.settings.deleteCategoryRulesBlock}</Body>
      ) : null}

      {options.length === 0 ? (
        <Body muted style={{ marginTop: spacing.md }}>{tr.settings.deleteCategoryNoTarget}</Body>
      ) : (
        <View accessibilityRole="radiogroup" style={{ marginTop: spacing.md, gap: spacing.xs }}>
          <Text style={[type.small, { color: palette.textSecondary, marginBottom: spacing.xs }]}>{tr.settings.deleteCategoryTargetLabel}</Text>
          {options.map((option) => {
            const selected = choice === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                // Explicit, like every other radio here: this RN Web
                // version does not derive `aria-checked` from state.
                aria-checked={selected}
                accessibilityState={{ checked: selected, selected }}
                accessibilityLabel={option.label}
                onPress={() => setChoice(option.value)}
                style={(state) => ({
                  minHeight: controlSize.minimumTarget,
                  justifyContent: "center",
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.md,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: selected ? palette.primary : palette.border,
                  ...interactionSurface(palette, state, {
                    base: selected ? palette.primarySoft : palette.surface,
                  }),
                })}
              >
                <Text style={[type.label, { color: selected ? palette.primaryText : palette.text }]}>{option.label}</Text>
                <Text style={[type.small, { color: palette.textSecondary, marginTop: 2 }]}>{option.hint}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <Row style={{ marginTop: spacing.lg, alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Button
            label={tr.common.delete}
            variant="danger"
            disabled={choice == null}
            loading={saving}
            haptic="none"
            onPress={() => void confirm()}
          />
        </View>
        <Button label={tr.common.cancel} variant="ghost" disabled={saving} onPress={onCancel} />
      </Row>
    </ModalCard>
  );
}

/** The panel a person or payment source gets when records still use it: what uses it, then who inherits them. */
export function ReferenceInUseCard({ title, rows, chooseLabel, note, options, value, onChange, onConfirm, onCancel, busy, confirmDisabled }: {
  title: string;
  rows: readonly (readonly [string, number])[];
  chooseLabel: string;
  note?: string;
  options: { value: string; label: string }[];
  value: string | null;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  confirmDisabled: boolean;
}) {
  return (
    <Card>
      <PanelHeader icon={Trash} title={title} description={tr.references.resolveBeforeDelete} />
      {rows.map(([label, count]) => (
        <Spread key={label} style={{ marginBottom: spacing.xs }}>
          <Body muted>{label}</Body>
          <Body>{String(count)}</Body>
        </Spread>
      ))}
      <Body style={{ marginTop: spacing.sm, marginBottom: spacing.sm }}>{chooseLabel}</Body>
      {note ? <Body muted style={{ marginBottom: spacing.sm }}>{note}</Body> : null}
      <ChipPicker options={options} value={value} onChange={onChange} />
      <Row>
        <View style={{ flex: 1 }}>
          <Button label={tr.references.reassignAndDelete} onPress={onConfirm} disabled={busy || confirmDisabled} loading={busy} />
        </View>
        <Button label={tr.common.cancel} variant="ghost" onPress={onCancel} disabled={busy} />
      </Row>
    </Card>
  );
}
