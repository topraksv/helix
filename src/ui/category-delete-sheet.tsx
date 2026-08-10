import React, { useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { Body, Button, FadeIn, Row } from "./components";
import { useModalAccessibility } from "./accessibility";
import { modalAnimationType } from "./modal-motion";
import { useReducedMotion } from "./motion";
import { KeyboardSafeScrollView } from "./keyboard-safe";
import { interactionSurface } from "./interaction";
import { tr } from "../i18n/tr";
import { controlSize, radius, spacing, themeShadow, type, useTheme } from "./theme";
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

/**
 * Where a deleted column's records go, asked as a sheet rather than a panel.
 *
 * This used to render as a Card at the top of the settings screen. The trash
 * icon that opens it sits in a long list, so on a phone the panel appeared
 * roughly 2000px above the viewport and the delete button read as dead — the
 * action had happened and nothing about it was on screen. A modal cannot be
 * scrolled away from.
 *
 * The options are laid out inline instead of behind a `Select`: that control
 * opens a modal of its own, and a modal inside a modal is exactly the case
 * React Native handles least reliably on iOS.
 */
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
  const reducedMotion = useReducedMotion();
  const titleRef = useModalAccessibility(true);
  const sheetRef = useRef<View>(null);
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
    <Modal transparent animationType={modalAnimationType(reducedMotion)} visible onRequestClose={onCancel}>
      <Pressable
        accessible={false}
        tabIndex={-1}
        style={{ flex: 1, backgroundColor: palette.scrim, alignItems: "center", justifyContent: "center", padding: spacing.lg }}
        onPress={onCancel}
      >
        <Pressable
          ref={sheetRef}
          accessible={false}
          tabIndex={-1}
          accessibilityViewIsModal
          onPress={() => {}}
          style={{ width: "100%", maxWidth: 460, maxHeight: "90%" }}
        >
          <KeyboardSafeScrollView
            bottomOffset={spacing.lg}
            extraKeyboardSpace={spacing.xl}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: spacing.lg }}
          >
            <FadeIn
              testID="category-delete-resolution"
              style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: spacing.lg, ...themeShadow.card(palette) }}
            >
              <View ref={titleRef} accessible accessibilityRole="header" tabIndex={-1}>
                <Text style={[type.heading, { color: palette.text }]}>{tr.settings.deleteCategorySheetTitle(categoryName)}</Text>
              </View>
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
            </FadeIn>
          </KeyboardSafeScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
