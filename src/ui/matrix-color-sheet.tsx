import React, { useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import Check from "lucide-react-native/icons/check";
import Pencil from "lucide-react-native/icons/pencil";
import { Body, Button, FadeIn, Field, FieldNote, IconButton } from "./components";
import { useModalAccessibility } from "./accessibility";
import { modalAnimationType } from "./modal-motion";
import { useReducedMotion } from "./motion";
import { interactionSurface } from "./interaction";
import { tr } from "../i18n/tr";
import {
  MATRIX_COLOR_LABEL_MAX,
  MATRIX_COLOR_TOKENS,
  matrixColorLabel,
  withMatrixColorLabel,
  type MatrixColorLabels,
  type MatrixColorScope,
  type MatrixColorToken,
} from "../domain/matrix-colors";
import { matrixColorStyle, radius, spacing, themeShadow, type, useTheme } from "./theme";

/**
 * Choosing a contextual colour for a row, a column or one cell.
 *
 * Opened by holding the thing being marked, not by a button in the middle of
 * the screen: the target IS the gesture's context, so the sheet never has to
 * ask "which cell did you mean" and there is no generic dialog sitting in a
 * financial surface offering to colour something.
 *
 * Four theme-owned hues and a reset — deliberately not a colour wheel. Each
 * carries its NAME beside the swatch and an accessible label, so the choice is
 * legible to someone who cannot separate the hues, and the mark it produces is
 * one the theme has already measured in both schemes.
 *
 * The names are the owner's. Renaming one is a rename of the COLOUR, not of
 * this cell: it is stored once for the account and every mark already made in
 * that colour is called the new name from then on. That is said on the rename
 * form rather than being left for someone to discover.
 */
export function MatrixColorSheet({
  scope,
  targetLabel,
  current,
  labels,
  onCancel,
  onSelect,
  onRename,
}: {
  scope: MatrixColorScope;
  /** What is being marked, in the owner's own words (a month, an item). */
  targetLabel: string;
  current: MatrixColorToken | null;
  /** The account's own names for the four hues; absent slots use the default. */
  labels: MatrixColorLabels | null;
  onCancel: () => void;
  onSelect: (token: MatrixColorToken | null) => void | Promise<void>;
  /** Rename one hue for the whole account. */
  onRename: (labels: MatrixColorLabels) => void | Promise<void>;
}) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  const titleRef = useModalAccessibility(true);
  const sheetRef = useRef<View>(null);
  const [saving, setSaving] = useState(false);
  /** Which hue is being renamed, and the draft name. Only ever one at a time. */
  const [renaming, setRenaming] = useState<MatrixColorToken | null>(null);
  const [draft, setDraft] = useState("");

  const nameOf = (token: MatrixColorToken) => matrixColorLabel(token, labels, tr.matrixColor.token);

  const choose = async (token: MatrixColorToken | null) => {
    if (saving || renaming) return;
    setSaving(true);
    try {
      await onSelect(token);
    } finally {
      setSaving(false);
    }
  };

  const startRename = (token: MatrixColorToken) => {
    setRenaming(token);
    setDraft(nameOf(token));
  };

  const commitRename = async (token: MatrixColorToken, name: string) => {
    if (saving) return;
    setSaving(true);
    try {
      await onRename(withMatrixColorLabel(labels, token, name));
      setRenaming(null);
      setDraft("");
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
                const name = nameOf(token);
                if (renaming === token) {
                  return (
                    <View
                      key={token}
                      testID={`matrix-color-rename-${token}`}
                      style={{
                        paddingVertical: spacing.sm,
                        paddingHorizontal: spacing.md,
                        borderRadius: radius.sm,
                        backgroundColor: style.fill,
                        borderLeftWidth: 4,
                        borderLeftColor: style.edge,
                      }}
                    >
                      <FieldNote note={tr.matrixColor.renameHint}>
                        <Field
                          label={tr.matrixColor.renameTitle}
                          value={draft}
                          onChangeText={setDraft}
                          maxLength={MATRIX_COLOR_LABEL_MAX}
                          placeholder={tr.matrixColor.renamePlaceholder}
                          autoFocus
                          error={draft.trim() === "" ? tr.matrixColor.renameEmpty : null}
                        />
                      </FieldNote>
                      <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
                        <Button
                          size="sm"
                          testID={`matrix-color-rename-save-${token}`}
                          label={tr.matrixColor.renameSave}
                          disabled={saving || draft.trim() === ""}
                          onPress={() => void commitRename(token, draft)}
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          label={tr.matrixColor.renameReset}
                          disabled={saving || labels?.[token] == null}
                          onPress={() => void commitRename(token, "")}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          label={tr.common.cancel}
                          disabled={saving}
                          onPress={() => { setRenaming(null); setDraft(""); }}
                        />
                      </View>
                    </View>
                  );
                }
                return (
                  /* The row IS the choice, and the rename control lives inside
                     its box rather than beside it: two sibling pressables in
                     one visual row light two separate regions and read as a
                     fault. See `docs/UI.md` §3. */
                  <Pressable
                    key={token}
                    testID={`matrix-color-${token}`}
                    accessibilityRole="radio"
                    aria-checked={selected}
                    accessibilityState={{ checked: selected, selected, disabled: saving }}
                    accessibilityLabel={tr.matrixColor.option(name)}
                    disabled={saving}
                    onPress={() => void choose(token)}
                    style={(state) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.sm,
                      paddingVertical: spacing.sm,
                      paddingLeft: spacing.md,
                      paddingRight: spacing.xs,
                      borderRadius: radius.sm,
                      backgroundColor: style.fill,
                      borderLeftWidth: 4,
                      borderLeftColor: style.edge,
                      ...interactionSurface(palette, state, { base: style.fill }),
                    })}
                  >
                    <Text style={[type.body, { flex: 1, minWidth: 0, color: palette.text }]}>
                      {name}
                    </Text>
                    {/* The tick, not the tint, is what says "this one is on":
                        a selected state carried only by colour is unreadable
                        on a row whose whole purpose is being coloured. */}
                    {selected ? <Check accessible={false} size={18} color={style.ink} strokeWidth={2.4} /> : null}
                    <IconButton
                      icon={Pencil}
                      label={tr.matrixColor.rename(name)}
                      disabled={saving}
                      onPress={() => startRename(token)}
                    />
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
                  disabled={saving || renaming != null || current == null}
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
