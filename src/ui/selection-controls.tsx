/**
 * Every control that answers "pick one" or "pick several": the dropdown, the
 * segmented view switcher, the multi-select grid, the tile and the chip row.
 *
 * They share more than a shape — they share the two rules that were learned the
 * hard way. Choosing something must not resize it (a border that thickens or a
 * label that gains weight re-wraps the row it sits in), and refusal is said in
 * colour rather than by fading the control, because a control the user cannot
 * use still has to be readable enough to explain itself.
 *
 * `ChipPicker` is a value you will SAVE. `Segmented` is which view of the same
 * data you are looking at. The two are not interchangeable.
 */

import React, { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Modal,
  Platform,
  useWindowDimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Check from "lucide-react-native/icons/check";
import Minus from "lucide-react-native/icons/minus";
import Plus from "lucide-react-native/icons/plus";
import type { LucideIcon } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tr } from "../i18n/tr";
import { filterSelectionOptions, type SelectionOption } from "./selection";
import { selectionTap, selectionTapIfChanged } from "./haptics";
import { useModalAccessibility } from "./accessibility";
import { useReducedMotion } from "./motion";
import { modalAnimationType } from "./modal-motion";
import { DelayedLoadingIndicator } from "./loading-indicator";
import { interactionSurface } from "./interaction";
import { SlideUp } from "./motion-primitives";
import { Body, DisclosureChevron, FadeIn, Label, Row, controlStateStyle } from "./primitives";
import { Field } from "./fields";
import { shouldBoundIntrinsicControls, shouldPresentOptionsAsSheet, shouldUseTripleTileGrid } from "./responsive";
import { useContentWidth } from "./viewport";
import { borderWidth, controlSize, font, iconSize, motion, radius, segmentedMaxWidth, spacing, themeShadow, type, useTheme, type Palette } from "./theme";

const SELECT_ICON_W = 22;
type SelectOptionIcon = string | LucideIcon | React.ReactElement;

function SelectOptionMark({ icon, color }: { icon: SelectOptionIcon; color: string }) {
  if (typeof icon === "string") {
    return (
      <Text accessible={false} aria-hidden style={[type.body, { width: SELECT_ICON_W, textAlign: "center" }]}>
        {icon}
      </Text>
    );
  }
  if (React.isValidElement(icon)) {
    return <View accessible={false} style={{ width: SELECT_ICON_W, alignItems: "center" }}>{icon}</View>;
  }
  const Icon = icon;
  return (
    <View accessible={false} style={{ width: SELECT_ICON_W, alignItems: "center" }}>
      <Icon size={iconSize.control} color={color} strokeWidth={2} />
    </View>
  );
}

/** Dropdown select: field-styled trigger opening a modal option list. */

export function Select<T extends string>({
  label,
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  onCreate,
  selectedOption,
  trigger,
  testID,
}: {
  label?: string;
  /**
   * `icon` is separate from `label` on purpose. Packing an emoji into the
   * label string left every name starting at a different x — emoji advance
   * widths differ — so a list of categories read as a ragged left edge. Its
   * own fixed column makes the names line up.
   */
  options: { value: T; label: string; icon?: SelectOptionIcon }[];
  value: T | null;
  onChange: (v: T) => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * A create action pinned under the options.
   *
   * An empty list used to be handled by standing a "manage payment sources"
   * button beside the field, which said the right thing in the wrong place —
   * you learn you have nothing to pick only after opening the picker. Living
   * here it is also there when the list is NOT empty, which is when "none of
   * these" actually happens.
   */
  onCreate?: { label: string; run: () => void };
  /** A value chosen through the pinned create action can remain visible in the
   * trigger without becoming a duplicate ordinary option in the list. */
  selectedOption?: { value: T; label: string; icon?: SelectOptionIcon };
  testID?: string;
  /**
   * Render the control that opens the list. A caller whose control already
   * exists in another shape — a chip in a row of chips — uses this instead of
   * standing a second field next to it, and the modal, its focus trap and its
   * keyboard behaviour stay here rather than being written again.
   */
  trigger?: (open: () => void, selected: string | null) => ReactNode;
}) {
  const { palette, scheme } = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<View>(null);
  const modalTitleRef = useModalAccessibility(open, triggerRef);
  const current = options.find((o) => o.value === value)
    ?? (selectedOption?.value === value ? selectedOption : undefined);
  const sheet = shouldPresentOptionsAsSheet(width);
  const modalVerticalInset = sheet ? spacing.lg : spacing.lg * 2;
  const modalMaxHeight = Math.max(0, Math.min(sheet ? 560 : 460, height - modalVerticalInset));
  // On a phone this is a sheet pulled up off the bottom edge; on a pointer
  // viewport it is a dialog in the middle of the window. The scrim fades either
  // way — sliding the scrim with the sheet would drag the whole screen.
  // A function, not a value. Built eagerly, this element tree — one `Pressable`
  // per option — was constructed on every render of every closed picker on the
  // screen, and a category picker carries hundreds of options.
  const optionsModal = () => (
          <Modal transparent animationType={modalAnimationType(reducedMotion)} visible onRequestClose={() => setOpen(false)}>
            <Pressable
              accessible={false}
              tabIndex={-1}
              style={{
                flex: 1,
                backgroundColor: palette.scrim,
                justifyContent: sheet ? "flex-end" : "center",
                paddingHorizontal: sheet ? spacing.sm : spacing.lg,
                paddingTop: spacing.lg,
                paddingBottom: sheet ? 0 : spacing.lg,
              }}
              onPress={() => setOpen(false)}
            >
              <Pressable
                accessible={false}
                tabIndex={-1}
                accessibilityViewIsModal
                aria-label={label}
                onPress={() => {}}
                style={{ alignSelf: "center", width: "100%", maxWidth: sheet ? 520 : 400 }}
              >
                <SheetSurface
                  sheet={sheet}
                  style={[
                    {
                      backgroundColor: palette.surface,
                      borderTopLeftRadius: radius.xl,
                      borderTopRightRadius: radius.xl,
                      borderBottomLeftRadius: sheet ? 0 : radius.xl,
                      borderBottomRightRadius: sheet ? 0 : radius.xl,
                      maxHeight: modalMaxHeight,
                      overflow: "hidden",
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: palette.border + "90",
                    },
                    scheme === "light" && themeShadow.overlay(palette),
                  ]}
                >
                  {sheet ? (
                    <View accessible={false} style={{ alignItems: "center", paddingTop: spacing.sm }}>
                      <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: palette.surfaceStrong }} />
                    </View>
                  ) : null}
                  <View ref={modalTitleRef} accessible accessibilityRole="header" tabIndex={-1}>
                    <Text style={[type.heading, { color: palette.textStrong, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }]}>
                      {label ?? tr.a11y.selectOption}
                    </Text>
                  </View>
                  <ScrollView
                    role="radiogroup"
                    accessibilityLabel={label ?? tr.a11y.selectOption}
                    style={{ flexShrink: 1 }}
                  >
                    {options.map((option, index) => {
                      const selected = option.value === value;
                      return (
                        <Pressable
                          key={option.value}
                          accessibilityRole="radio"
                          aria-checked={selected}
                          accessibilityState={{ checked: selected, selected }}
                          onPress={() => {
                            selectionTapIfChanged(value, option.value);
                            onChange(option.value);
                            setOpen(false);
                          }}
                          style={(state) => [
                            {
                              paddingHorizontal: spacing.lg,
                              paddingVertical: spacing.md,
                              borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                              borderTopColor: palette.border + "70",
                              ...interactionSurface(palette, state, {
                                base: selected ? palette.primarySoft : "transparent",
                              }),
                            },
                          ]}
                        >
                          <Row gap={spacing.sm}>
                            {option.icon ? (
                              // Decorative: the mark repeats the adjacent name,
                              // so it stays out of the accessible option label.
                              <SelectOptionMark
                                icon={option.icon}
                                color={selected ? palette.primaryText : palette.textSecondary}
                              />
                            ) : null}
                            <Text
                              style={[
                                type.body,
                                {
                                  flex: 1,
                                  color: selected ? palette.primaryText : palette.text,
                                  fontFamily: selected ? font.semibold : font.regular,
                                },
                              ]}
                            >
                              {option.label}
                            </Text>
                          </Row>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  {onCreate ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={onCreate.label}
                      onPress={() => {
                        setOpen(false);
                        onCreate.run();
                      }}
                      style={(state) => ({
                        paddingHorizontal: spacing.lg,
                        paddingVertical: spacing.md,
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: palette.border,
                        ...interactionSurface(palette, state, { base: palette.surface }),
                      })}
                    >
                      <Row gap={spacing.sm}>
                        <Plus accessible={false} size={iconSize.control} color={palette.primary} style={{ width: SELECT_ICON_W }} />
                        <Text style={[type.body, { flex: 1, color: palette.primaryText, fontFamily: font.medium }]}>
                          {onCreate.label}
                        </Text>
                      </Row>
                    </Pressable>
                  ) : null}
                  {sheet && insets.bottom > 0 ? (
                    <View accessible={false} style={{ height: insets.bottom, backgroundColor: palette.surface }} />
                  ) : null}
                </SheetSurface>
              </Pressable>
            </Pressable>
          </Modal>
  );

  if (trigger) {
    return (
      <>
        <View ref={triggerRef}>{trigger(() => setOpen(true), current?.label ?? null)}</View>
        {open ? optionsModal() : null}
      </>
    );
  }
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? (
        <Label
          accessible={Platform.OS === "web" ? undefined : false}
          accessibilityElementsHidden={Platform.OS === "web" ? undefined : true}
          importantForAccessibility={Platform.OS === "web" ? undefined : "no-hide-descendants"}
        >
          {label}
        </Label>
      ) : null}
      <Pressable
        testID={testID}
        ref={triggerRef}
        accessibilityRole="button"
        accessibilityLabel={label ?? placeholder ?? current?.label}
        aria-expanded={open}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={(state) => [
          {
            ...controlStateStyle(palette, open),
            borderRadius: radius.sm,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            minHeight: controlSize.regular,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            ...(disabled ? { borderColor: palette.border } : null),
            ...interactionSurface(palette, state, { enabled: !disabled }),
          },
        ]}
      >
        {current?.icon ? (
          <View style={{ marginRight: spacing.sm }}>
            <SelectOptionMark icon={current.icon} color={disabled ? palette.textSecondary : palette.text} />
          </View>
        ) : null}
        <Text
          style={[type.body, { color: disabled || !current ? palette.textSecondary : palette.text, flex: 1 }]}
        >
          {current?.label ?? placeholder ?? ""}
        </Text>
        <DisclosureChevron open={open} />
      </Pressable>
      {open ? optionsModal() : null}
    </View>
  );
}

/**
 * The picker's own surface: a sheet off the bottom edge on a phone, a dialog in
 * the middle of the window on a pointer viewport. Written once here because the
 * two differ only in where they come from, and a component boundary is what
 * lets each keep its own animated value across a resize.
 */
function SheetSurface({
  sheet,
  style,
  children,
}: {
  sheet: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return sheet ? <SlideUp distance={40} style={style}>{children}</SlideUp> : <FadeIn style={style}>{children}</FadeIn>;
}

/**
 * Switches which view of the same data is shown — pie or bars, rows or
 * columns, this range or that one. It is NOT the control for a form value the
 * user will save; that is `ChipPicker`, and keeping the two apart is what
 * stops one screen from asking three identical questions three different ways.
 */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  noMargin = false,
  disabled = false,
  fill = false,
  action,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  noMargin?: boolean;
  disabled?: boolean;
  /**
   * Span the container instead of stopping at the control's own width.
   *
   * For a strip that is a page's primary view switcher — the ledger's pivot —
   * one fixed position beats an intrinsic width: bounded, the same control sat
   * somewhere different on a phone, a tablet and a zoomed desktop.
   */
  fill?: boolean;
  /**
   * A companion toggle that belongs to the same strip — the ledger's reading
   * guide beside its pivot.
   *
   * It used to be an `IconButton` parked next to the control: a bordered 52pt
   * square beside a 44pt underlined strip, which is two control languages and
   * two heights on one row. Rendered as part of the strip it cannot drift from
   * it, and it keeps its own button role rather than pretending to be a fourth
   * choice.
   */
  action?: { icon: LucideIcon; label: string; active: boolean; onPress: () => void };
}) {
  const { palette } = useTheme();
  const bounded = shouldBoundIntrinsicControls(useContentWidth());
  const reducedMotion = useReducedMotion();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const indicator = useRef(new Animated.Value(selectedIndex)).current;
  useEffect(() => {
    if (reducedMotion) {
      indicator.setValue(selectedIndex);
      return;
    }
    const animation = Animated.timing(indicator, {
      toValue: selectedIndex,
      duration: motion.standard,
      easing: Easing.out(Easing.cubic),
      // A left offset expressed as a percentage is layout, not transform.
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [selectedIndex, indicator, reducedMotion]);
  return (
    <View
      role="radiogroup"
      style={{
        position: "relative",
        flexDirection: "row",
        // Bounded by its own options once the container stops being a bound —
        // see `shouldBoundIntrinsicControls`. A phone keeps the full-width
        // control it expects; capping there only left a ragged edge beside it.
        maxWidth: bounded && !fill
          ? segmentedMaxWidth(options.length) + (action ? controlSize.minimumTarget : 0)
          : undefined,
        backgroundColor: palette.surface,
        borderRadius: radius.sm,
        padding: 0,
        marginBottom: noMargin ? 0 : spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: palette.border,
      }}
    >
      {/* The options own their own track.
          The indicator is a percentage, and the guide toggle beside it is a
          fixed 44pt — so measuring the indicator against the whole strip made
          it both too narrow and progressively too far left, which is why the
          underline sat off the third segment in the table view and looked
          correct in the two views that have no toggle. The track is what the
          flexing options actually share; the toggle is outside it. */}
      <View style={{ position: "relative", flexDirection: "row", flex: 1, minWidth: 0 }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            disabled={disabled}
            onPress={() => {
              selectionTapIfChanged(value, option.value);
              if (!disabled) onChange(option.value);
            }}
            accessibilityRole="radio"
            aria-checked={selected}
            accessibilityState={{ checked: selected, selected, disabled }}
            style={(state) => [
              {
                flex: 1,
                alignSelf: "stretch",
                minHeight: controlSize.minimumTarget,
                paddingVertical: spacing.sm,
                paddingHorizontal: 2,
                // The track is rounded and its underline is square, so the
                // segment takes the track's corner on top and none at the
                // bottom. Square all round, a hovered first or last tab put a
                // right-angled fill inside the track's own rounded corner.
                borderTopLeftRadius: radius.sm,
                borderTopRightRadius: radius.sm,
                alignItems: "center",
                justifyContent: "center",
                ...interactionSurface(palette, state, {
                  base: selected && disabled ? palette.surfaceAlt : "transparent",
                  enabled: !disabled,
                }),
              },
            ]}
          >
            <Text
              style={[
                type.label,
                {
                  color: disabled ? palette.textSecondary : selected ? palette.textStrong : palette.textSecondary,
                  fontFamily: font.semibold,
                  textAlign: "center",
                  width: "100%",
                },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
      <Animated.View
        accessible={false}
        pointerEvents="none"
        style={{
          position: "absolute",
          bottom: 0,
          height: 3,
          backgroundColor: disabled ? palette.controlBorder : palette.primary,
          width: `${100 / options.length}%`,
          left: indicator.interpolate({
            inputRange: [0, Math.max(1, options.length - 1)],
            outputRange: ["0%", `${(100 / options.length) * Math.max(1, options.length - 1)}%`],
          }),
        }}
      />
      </View>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          aria-expanded={action.active}
          accessibilityState={{ expanded: action.active }}
          onPress={action.onPress}
          style={(state) => ({
            width: controlSize.minimumTarget,
            minHeight: controlSize.minimumTarget,
            alignItems: "center",
            justifyContent: "center",
            ...interactionSurface(palette, state),
            borderBottomWidth: 3,
            borderBottomColor: action.active ? palette.primary : "transparent",
          })}
        >
          <action.icon
            accessible={false}
            size={iconSize.accessory}
            color={action.active ? palette.primaryText : palette.textSecondary}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Simple chip-row picker (categories, sources, persons); `multi` toggles a set. */
/**
 * A wrapping grid of multi-select tiles: icon column, label, check when picked.
 *
 * Built for the computed-column buckets, then reused for the suggested-items
 * template — the two screens ask the same question ("which of these do you
 * want?") of the same kind of thing, so they read as one control instead of a
 * grid on one screen and a chip row on the other. `tone` only chooses the accent
 * pair; the geometry is identical in every use, which is the point.
 */

export function SelectionGrid({
  options,
  values,
  onToggle,
  tone = "plus",
  countLabel,
  readOnly = false,
  disabled = false,
  searchable = false,
  status = "ready",
  errorMessage,
  emptyMessage,
}: {
  options: SelectionOption[];
  values: string[];
  onToggle: (value: string) => void;
  tone?: "plus" | "minus";
  /** Optional pill above the grid, e.g. "3 selected". */
  countLabel?: string;
  /** Render the same tiles as a non-interactive summary. */
  readOnly?: boolean;
  disabled?: boolean;
  searchable?: boolean;
  status?: "ready" | "loading" | "error";
  errorMessage?: string;
  emptyMessage?: string;
}) {
  const { palette } = useTheme();
  const contentWidth = useContentWidth();
  const [query, setQuery] = useState("");
  const selectedColor = tone === "plus" ? palette.primary : palette.negative;
  const selectedSoft = tone === "plus" ? palette.primarySoft : palette.negative + "18";
  const selectedInk = tone === "plus" ? palette.primaryText : palette.negativeText;
  const inactive = readOnly || disabled || status !== "ready";
  const filtered = filterSelectionOptions(options, query);

  if (status === "loading") {
    return (
      <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md }}>
        <DelayedLoadingIndicator size={6} label={tr.selection.loading} />
        <Body muted>{tr.selection.loading}</Body>
      </View>
    );
  }
  if (status === "error") {
    return (
      <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ backgroundColor: palette.error + "14", borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md }}>
        <Body style={{ color: palette.errorText }}>{errorMessage ?? tr.selection.error}</Body>
      </View>
    );
  }

  return (
    <View>
      {searchable && options.length > 0 ? (
        <Field
          label={tr.selection.searchLabel}
          value={query}
          onChangeText={setQuery}
          placeholder={tr.selection.searchPlaceholder}
          autoCapitalize="none"
          returnKeyType="search"
          editable={!inactive}
        />
      ) : null}
      {countLabel ? (
        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: spacing.xs }}>
          <View style={{ borderRadius: radius.full, backgroundColor: selectedSoft, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
            <Text style={[type.small, { color: selectedInk, fontFamily: font.semibold }]}>{countLabel}</Text>
          </View>
        </View>
      ) : null}
      {options.length === 0 || filtered.length === 0 ? (
        <View accessibilityLiveRegion="polite" style={{ backgroundColor: palette.surfaceAlt, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md }}>
          <Body muted>{options.length === 0 ? (emptyMessage ?? tr.selection.empty) : tr.selection.noResults}</Body>
        </View>
      ) : (
        <View
          role="group"
          style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md }}
        >
          {filtered.map((option) => {
            const selected = values.includes(option.value);
            return (
              <Pressable
                key={option.value}
                accessibilityRole="checkbox"
                aria-checked={selected}
                accessibilityState={{ checked: selected, selected, disabled: inactive }}
                disabled={inactive}
                onPress={() => {
                  selectionTap();
                  onToggle(option.value);
                }}
                style={(state) => ({
                  flexBasis: shouldUseTripleTileGrid(contentWidth) ? "31%" : "47%",
                  flexGrow: 1,
                  minWidth: 0,
                  minHeight: 48,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.sm,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: spacing.sm,
                  borderRadius: radius.md,
                  // Constant weight, like every other chosen surface: a ring
                  // that thickens moves the tiles that wrap after it.
                  borderWidth: borderWidth.control,
                  borderColor: selected ? selectedColor : palette.border,
                  ...interactionSurface(palette, state, { base: selected ? selectedSoft : palette.surfaceAlt }),
                })}
              >
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: radius.md,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: selected ? selectedColor : palette.surface,
                  }}
                >
                  {selected ? (
                    <Check accessible={false} size={15} color={tone === "plus" ? palette.onPrimary : palette.onDestructive} strokeWidth={2.4} />
                  ) : option.icon ? (
                    <option.icon accessible={false} size={iconSize.compact} color={palette.textSecondary} strokeWidth={2} />
                  ) : tone === "plus" ? (
                    <Plus accessible={false} size={14} color={palette.textSecondary} />
                  ) : (
                    <Minus accessible={false} size={14} color={palette.textSecondary} />
                  )}
                </View>
                <Text style={[type.small, { flex: 1, minWidth: 0, color: selected ? selectedInk : palette.text, fontFamily: font.semibold }]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

/**
 * The single-choice control for a value the user is about to SAVE.
 *
 * The app has exactly two of these and the split is by job, not by taste:
 * `ChipPicker` answers a form question (which cycle, which person, month or
 * day), `Segmented` switches which view of the same data you are looking at
 * (pie or bars, rows or columns). The transaction form used to show three
 * languages at once — icon tiles, chips and underlined tabs — for three
 * questions of the same kind.
 */
/**
 * One tile, one answer.
 *
 * Six screens drew their own: the theme and palette pickers, the entry-type
 * row, the instalment kind, the investment asset type and the payment-source
 * type. They agreed on what a tile is and on nothing else — 82 / 78 / 78 / 76
 * tall, pressed at 0.8 / 0.78 / 0.76, `selected ? 2 : 1` in five of them and
 * `selected ? 1.5 : hairline` in two more, some sinking a pixel on press and
 * some not. The user meets four of them in one session.
 *
 * The shell is here; what goes inside stays with the screen, because a colour
 * swatch, a theme preview and an icon are genuinely different content. Two
 * rules the shell will not let a caller break: the box does not change size
 * when it is chosen (a border that thickens re-wraps the row it sits in), and
 * the label does not change weight for the same reason. Colour, fill and the
 * accessible state carry the choice — three carriers, none of them geometry.
 */

export function ChoiceTile({
  label,
  description,
  selected,
  onPress,
  disabled = false,
  children,
  layout = "stack",
  minHeight = 78,
  basis,
  tone,
  surface,
  accessibilityRole = "radio",
  accessibilityLabel,
  accessibilityHint,
  testID,
}: {
  label: string;
  /** A second line under the label. A tile that explains itself is a bigger
   *  tile, so the label grows with it rather than being set twice. */
  description?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** Whatever the tile shows above (or beside) its label. */
  children?: ReactNode;
  /** `stack` puts the content over the label; `row` puts it beside. */
  layout?: "stack" | "row";
  minHeight?: number;
  /** `flexBasis` for a wrapping grid; omit to share the row evenly. */
  basis?: number | `${number}%`;
  /** Accent for the chosen ring and fill. Defaults to the brand colour. */
  tone?: string;
  /** Render against a palette other than the active one — the theme and
   *  palette pickers preview a scheme the app is not currently wearing. */
  surface?: Palette;
  accessibilityRole?: "radio" | "button";
  accessibilityLabel?: string;
  /** Why a refused tile is refused. The NAME must stay stable — it is what the
   *  tile is, not what it is currently allowed to do. */
  accessibilityHint?: string;
  testID?: string;
}) {
  const { palette } = useTheme();
  const p = surface ?? palette;
  const accent = tone ?? p.primary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      aria-checked={accessibilityRole === "radio" ? selected : undefined}
      accessibilityState={{ checked: selected, selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={(state) => ({
        flexGrow: 1,
        flexBasis: basis ?? 0,
        minWidth: 0,
        minHeight,
        padding: spacing.sm,
        gap: layout === "row" ? spacing.md : spacing.xs,
        flexDirection: layout === "row" ? "row" : "column",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.md,
        // Constant weight: a ring that thickens on selection moves everything
        // after it in a wrapping row.
        borderWidth: borderWidth.selected,
        borderColor: disabled ? p.controlBorder : selected ? accent : p.border + "80",
        // Disabled is said in colour, never by fading the tile: a control the
        // user cannot use still has to be readable enough to explain itself.
        ...interactionSurface(p, state, {
          base: disabled ? p.surfaceAlt : selected ? accent + "14" : p.surface,
          enabled: !disabled,
        }),
        transform: [{ translateY: state.pressed && !disabled ? 1 : 0 }],
      })}
    >
      {children}
      <View style={layout === "row" ? { flex: 1, minWidth: 0, justifyContent: "center" } : { minWidth: 0 }}>
        <Text
          style={[
            description ? type.body : type.small,
            {
              color: selected ? p.textStrong : p.text,
              fontFamily: font.semibold,
              textAlign: layout === "row" ? "left" : "center",
              flexShrink: 1,
              minWidth: 0,
            },
          ]}
        >
          {label}
        </Text>
        {description ? (
          <Text
            style={[
              type.small,
              {
                color: p.textSecondary,
                marginTop: 3,
                textAlign: layout === "row" ? "left" : "center",
                flexShrink: 1,
              },
            ]}
          >
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function ChipPicker<T extends string>({
  options,
  value,
  onChange,
  multi,
  values,
  onToggle,
  compact = false,
}: {
  options: { value: T; label: string; disabled?: boolean; hint?: string }[];
  value?: T | null;
  onChange?: (v: T) => void;
  multi?: boolean;
  values?: T[];
  onToggle?: (v: T) => void;
  /**
   * Tighter side padding, for a row whose labels are one or two characters.
   * A month-day row is six numbers and the words "Ayın sonu": at the default
   * padding the six numbers cost more in padding than in text and pushed the
   * words onto a second line. The touch target keeps its full height and gains
   * hit slop to make up the width.
   */
  compact?: boolean;
}) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: compact ? spacing.xs + 2 : spacing.sm, marginBottom: spacing.md }}>
      {options.map((option) => {
        const selected = multi ? (values ?? []).includes(option.value) : option.value === value;
        const unavailable = option.disabled === true;
        // Selecting a chip must not resize it. The border used to thicken and
        // the label used to gain weight on selection, so every chip after it in
        // this wrapping row moved — and a row that wraps could re-wrap, which is
        // how choosing "Ayın sonu" shifted the field underneath it. One border
        // weight and one font weight for both states; colour carries the choice,
        // three times over. Paying for the thicker border out of the padding was
        // tried first and measured 84px against 85: browsers snap a 1.5px border
        // to a whole device pixel and the padding it was traded against is not.
        return (
          <Pressable
            key={option.value}
            disabled={unavailable}
            onPress={() => {
              if (multi) {
                selectionTap();
                onToggle?.(option.value);
              } else {
                selectionTapIfChanged(value, option.value);
                onChange?.(option.value);
              }
            }}
            accessibilityRole={multi ? "checkbox" : "radio"}
            accessibilityHint={unavailable ? option.hint : undefined}
            aria-checked={selected}
            accessibilityState={{ checked: selected, selected, disabled: unavailable }}
            // One selection language. This row used to be fully rounded pills
            // while the same question asked as a grid — pick your columns, pick
            // your categories — was answered with bordered tiles, so two
            // controls doing the same job on adjacent screens looked unrelated.
            // The tile's shape, border and selected treatment win because they
            // survive a long label and read as chosen without relying on fill
            // alone; the pill's geometry and touch target are unchanged.
            style={(state) => ({
              paddingVertical: spacing.sm + 2,
              paddingHorizontal: compact ? spacing.sm + 2 : spacing.md + 2,
              borderRadius: radius.md,
              borderWidth: borderWidth.control,
              borderColor: selected ? palette.primary : palette.border,
              ...interactionSurface(palette, state, {
                base: selected ? palette.primarySoft : palette.surfaceAlt,
              }),
              opacity: unavailable ? 0.45 : 1,
              minHeight: controlSize.minimumTarget,
              justifyContent: "center",
            })}
          >
            <Text
              style={[
                type.label,
                {
                  color: unavailable ? palette.textSecondary : selected ? palette.primaryText : palette.text,
                  fontFamily: font.semibold,
                },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
