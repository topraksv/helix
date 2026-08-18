import React, { useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import Check from "lucide-react-native/icons/check";
import { Body, Button, FadeIn } from "./components";
import { useModalAccessibility } from "./accessibility";
import { modalAnimationType } from "./modal-motion";
import { useReducedMotion } from "./motion";
import { interactionSurface } from "./interaction";
import { tr } from "../i18n/tr";
import { MATRIX_COLOR_TOKENS, type MatrixColorScope, type MatrixColorToken } from "../domain/matrix-colors";
import { matrixColorStyle, radius, spacing, themeShadow, type, useTheme } from "./theme";

/**
 * Choosing a contextual colour for a row, a column or one cell.
 *
 * Opened by holding the thing being marked, not by a button in the middle of
 * the screen: the target IS the gesture's context, so the sheet never has to
 * ask "which cell did you mean" and there is no generic dialog sitting in a
 * financial surface offering to colour something.
 *
 * Five theme-owned tokens and a reset — deliberately not a colour wheel. Each
 * carries its NAME beside the swatch and an accessible label, so the choice is
 * legible to someone who cannot separate the hues, and the mark it produces is
 * one the theme has already measured in both schemes.
 */
export function MatrixColorSheet({
  scope,
  targetLabel,
  current,
  onCancel,
  onSelect,
}: {
  scope: MatrixColorScope;
  /** What is being marked, in the owner's own words (a month, an item). */
  targetLabel: string;
  current: MatrixColorToken | null;
  onCancel: () => void;
  onSelect: (token: MatrixColorToken | null) => void | Promise<void>;
}) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  const titleRef = useModalAccessibility(true);
  const sheetRef = useRef<View>(null);
  const [saving, setSaving] = useState(false);

  const choose = async (token: MatrixColorToken | null) => {
    if (saving) return;
    setSaving(true);
    try {
      await onSelect(token);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal transparent animationType={modalAnimationType(reducedMotion)} visible onRequestClose={onCancel}>
      <Pressable
        accessible={false}
        tabIndex={-1}
        style={{ flex: 1, backgroundColor: palette.scrim, alignItems: "center", justifyContent: "flex-end" }}
        onPress={onCancel}
      >
        <Pressable
          ref={sheetRef}
          accessible={false}
          tabIndex={-1}
          accessibilityViewIsModal
          onPress={() => {}}
          style={{ width: "100%", maxWidth: 520, padding: spacing.lg }}
        >
          <FadeIn
            testID="matrix-color-sheet"
            style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: spacing.lg, ...themeShadow.card(palette) }}
          >
            <View ref={titleRef} accessible accessibilityRole="header" tabIndex={-1}>
              <Text style={[type.heading, { color: palette.text }]}>{tr.matrixColor.title(tr.matrixColor.scope[scope])}</Text>
            </View>
            <Body muted style={{ marginTop: spacing.xs }}>{tr.matrixColor.hint(targetLabel)}</Body>

            <View accessibilityRole="radiogroup" style={{ marginTop: spacing.md, gap: spacing.xs }}>
              {MATRIX_COLOR_TOKENS.map((token) => {
                const style = matrixColorStyle(palette, token);
                const selected = current === token;
                return (
                  <Pressable
                    key={token}
                    testID={`matrix-color-${token}`}
                    accessibilityRole="radio"
                    aria-checked={selected}
                    accessibilityState={{ checked: selected, selected, disabled: saving }}
                    accessibilityLabel={tr.matrixColor.option(tr.matrixColor.token[token])}
                    disabled={saving}
                    onPress={() => void choose(token)}
                    style={(state) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.md,
                      paddingVertical: spacing.sm,
                      paddingHorizontal: spacing.md,
                      borderRadius: radius.sm,
                      backgroundColor: style.fill,
                      borderLeftWidth: 4,
                      borderLeftColor: style.edge,
                      ...interactionSurface(palette, state),
                    })}
                  >
                    <Text style={[type.body, { flex: 1, minWidth: 0, color: palette.text }]}>
                      {tr.matrixColor.token[token]}
                    </Text>
                    {/* The tick, not the tint, is what says "this one is on":
                        a selected state carried only by colour is unreadable
                        on a row whose whole purpose is being coloured. */}
                    {selected ? <Check accessible={false} size={18} color={style.ink} strokeWidth={2.4} /> : null}
                  </Pressable>
                );
              })}
            </View>

            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg }}>
              <View style={{ flex: 1 }}>
                <Button
                  testID="matrix-color-clear"
                  variant="ghost"
                  label={tr.matrixColor.clear}
                  disabled={saving || current == null}
                  onPress={() => void choose(null)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button variant="ghost" label={tr.common.cancel} onPress={onCancel} />
              </View>
            </View>
          </FadeIn>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
