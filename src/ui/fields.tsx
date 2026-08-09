/**
 * Everything the user types a value into: the text field, the money field with
 * its calculator, the month stepper, the switch, and the one live-region
 * contract every validation error goes through.
 *
 * Sits above `primitives` and below `selection` and `components`, so it can use
 * a `Label` and a `Button` and nothing above it can be reached from here. That
 * ordering is the whole point of the split — `components.tsx` held 2,274 lines
 * in one layer, which is why the calculator had to be loaded through a
 * deferred `require()` to avoid a cycle.
 */

import React, { useEffect, useId, useRef, useState } from "react";
import {
  Animated,
  StyleSheet,
  Pressable,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
  type TextInputProps,
  } from "react-native";
import AlertCircle from "lucide-react-native/icons/circle-alert";
import CalculatorIcon from "lucide-react-native/icons/calculator";
import Check from "lucide-react-native/icons/check";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Eye from "lucide-react-native/icons/eye";
import EyeOff from "lucide-react-native/icons/eye-off";
import Minus from "lucide-react-native/icons/minus";
import { CalculatorModal } from "./calculator";
import { formatMinorInput, formatMoneyInputLive, majorToMinor, parseAmountExpression } from "../domain/money";
import { INPUT_LIMITS } from "../domain/input";
import { addMonthsToKey, type MonthKey } from "../domain/dates";
import { monthLabel, tr } from "../i18n/tr";
import { selectionTap } from "./haptics";
import { interactionSurface } from "./interaction";
import { useReducedMotion } from "./motion";
import { useShake } from "./motion-primitives";
import { examplePlaceholder, numericPlaceholderColor } from "./input-placeholder";
import { Heading, IconButton, Label, Spread, controlStateStyle } from "./primitives";
import { borderWidth, controlSize, iconSize, motion, radius, spacing, stateOpacity, themeShadow, toggleSize, type, useTheme, type Palette } from "./theme";

const fieldAccessoryStyle = {
  position: "absolute",
  right: 0,
  top: 0,
  bottom: 0,
  width: controlSize.inputAccessoryWidth,
  alignItems: "center",
  justifyContent: "center",
} as const;

/**
 * The accessory sitting inside a field's reserved right padding — the password
 * eye, the calculator. `hitSlop` is a no-op on react-native-web, so the box is
 * the target; the press has to light that same box or the only feedback the
 * user gets is that nothing happened.
 */

function fieldAccessoryPressStyle(palette: Palette) {
  return (state: PressableStateCallbackType) => [
    fieldAccessoryStyle,
    interactionSurface(palette, state),
    { borderTopRightRadius: radius.md, borderBottomRightRadius: radius.md },
  ];
}

/** One live-region contract for validation errors across shared fields. */

function FieldError({ message }: { message?: string | null }) {
  const { palette } = useTheme();
  const { style: shakeStyle, shake } = useShake();
  // A refusal that only fades in is easy to miss on a long form: the message
  // appears below the fold of the eye's attention while the caret is still in
  // the field. Two oscillations point at the row. Nothing overshoots — an
  // overshoot reads as playful, and a rejected amount is not.
  useEffect(() => {
    if (message) shake();
  }, [message, shake]);
  if (!message) return null;
  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[
        { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs, marginTop: spacing.xs },
        shakeStyle,
      ]}
    >
      <AlertCircle accessible={false} size={14} color={palette.error} style={{ marginTop: 1 }} />
      <Text style={[type.small, { color: palette.errorText, flex: 1 }]}>{message}</Text>
    </Animated.View>
  );
}

export function Field({
  label,
  error,
  secure,
  style,
  noMargin = false,
  ...props
}: TextInputProps & { label?: string; error?: string | null; secure?: boolean; noMargin?: boolean }) {
  const { palette } = useTheme();
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(secure === true);
  const numericPlaceholder = props.keyboardType === "number-pad"
    || props.keyboardType === "numeric"
    || props.keyboardType === "decimal-pad"
    || props.inputMode === "numeric"
    || props.inputMode === "decimal";
  const maxLength = props.maxLength ?? (
    props.multiline
      ? INPUT_LIMITS.note
      : secure || props.secureTextEntry
        ? INPUT_LIMITS.password
        : props.keyboardType === "email-address" || props.inputMode === "email"
          ? INPUT_LIMITS.email
          : props.keyboardType === "number-pad" || props.keyboardType === "numeric"
            ? INPUT_LIMITS.numeric
            : INPUT_LIMITS.text
  );
  return (
    <View style={{ marginBottom: noMargin ? 0 : spacing.md }}>
      {label ? <Label nativeID={labelId}>{label}</Label> : null}
      <View>
        <TextInput
          {...props}
          placeholder={examplePlaceholder(props.placeholder)}
          placeholderTextColor={numericPlaceholder ? numericPlaceholderColor(palette.textSecondary) : palette.textSecondary}
          accessibilityLabel={props.accessibilityLabel ?? label}
          accessibilityLabelledBy={label ? labelId : props.accessibilityLabelledBy}
          accessibilityHint={error ? [props.accessibilityHint, tr.a11y.fieldError(error)].filter(Boolean).join(". ") : props.accessibilityHint}
          accessibilityState={{ ...props.accessibilityState, disabled: props.editable === false }}
          maxLength={maxLength}
          secureTextEntry={secure ? hidden : props.secureTextEntry}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          style={[
            {
              ...controlStateStyle(palette, focused, Boolean(error)),
              color: props.editable === false ? palette.textSecondary : palette.text,
              ...(props.editable === false ? { borderColor: palette.border } : null),
              borderRadius: radius.sm,
              paddingHorizontal: spacing.md,
              paddingRight: secure ? controlSize.inputAccessoryInset : spacing.md,
              minHeight: controlSize.regular,
              ...type.field,
            },
            // Multiline reads as an intentional text area: taller, top-aligned.
            props.multiline
              ? { minHeight: 88, paddingTop: spacing.md, paddingBottom: spacing.md, textAlignVertical: "top" as const }
              : null,
            style,
          ]}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? tr.a11y.showPassword : tr.a11y.hidePassword}
            accessibilityHint={label}
            onPress={() => setHidden(!hidden)}
            // The icon is 18px and `hitSlop` does not enlarge the DOM box on
            // web, which left an 18px-wide target (WCAG 2.2 SC 2.5.8 asks for
            // 24). The box now fills the input's reserved 44px right padding
            // with the icon centred, so the mark does not visibly move.
            style={fieldAccessoryPressStyle(palette)}
          >
            {hidden ? <Eye accessible={false} size={iconSize.accessory} color={palette.textSecondary} /> : <EyeOff accessible={false} size={iconSize.accessory} color={palette.textSecondary} />}
          </Pressable>
        ) : null}
      </View>
      <FieldError message={error} />
    </View>
  );
}

/** TR money input ("1.234,56") with a popup calculator; reports minor units.
 *  Parses sum expressions too ("400+500" → 900); pass `expression` to surface a
 *  keyboard with +/- operators (otherwise a clean decimal pad). */

export function MoneyField({
  label,
  value,
  onChangeMinor,
  placeholder = "0,00",
  expression = false,
  disabled = false,
  accessibilityLabel,
  testID,
  inline = false,
  error,
}: {
  label?: string;
  value: string;
  onChangeMinor: (raw: string, minor: number | null) => void;
  placeholder?: string;
  expression?: boolean;
  disabled?: boolean;
  /** Screen-reader label when a nearby visible section heading labels the field. */
  accessibilityLabel?: string;
  testID?: string;
  /** Keeps repeated amount rows compact without reducing the input target. */
  inline?: boolean;
  /** Domain validation message shown in addition to the input parser's own error. */
  error?: string | null;
}) {
  const { palette } = useTheme();
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const [focused, setFocused] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const calculatorTriggerRef = useRef<View>(null);
  const display = formatMoneyInputLive(value);
  const minor = value.trim() === "" ? null : parseAmountExpression(display);
  const invalid = value.trim() !== "" && minor === null;
  const resolvedError = invalid ? tr.common.amountLimit : error;
  return (
    <View style={{ marginBottom: inline ? spacing.sm : spacing.md }}>
      <View style={inline ? { flexDirection: "row", alignItems: "center", gap: spacing.sm } : undefined}>
        {label ? (
          <View style={inline ? { flex: 1, minWidth: 0 } : undefined}>
            <Label nativeID={labelId} style={inline ? { marginBottom: 0 } : undefined}>{label}</Label>
          </View>
        ) : null}
        <View
          style={inline
            ? {
                // Repeated amount rows need their descriptive label more than
                // a half-width amount box. TRY entry is bounded and the
                // native TextInput scrolls its value, so keep that control
                // predictable while returning the remaining width to context.
                width: "42%",
                maxWidth: 156,
                minWidth: 120,
                flexShrink: 1,
              }
            : undefined}
        >
          <TextInput
            testID={testID}
            value={display}
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityLabelledBy={label ? labelId : undefined}
            accessibilityHint={resolvedError ? tr.a11y.fieldError(resolvedError) : undefined}
            accessibilityState={{ disabled }}
            maxLength={INPUT_LIMITS.money}
            editable={!disabled}
            onChangeText={(raw) => {
              const formatted = formatMoneyInputLive(raw);
              onChangeMinor(formatted, formatted.trim() === "" ? null : parseAmountExpression(formatted));
            }}
            keyboardType={expression ? "numbers-and-punctuation" : "decimal-pad"}
            inputMode={expression ? "text" : "decimal"}
            placeholder={examplePlaceholder(placeholder)}
            placeholderTextColor={numericPlaceholderColor(palette.textSecondary)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{
              ...controlStateStyle(palette, focused, Boolean(resolvedError)),
              color: resolvedError ? palette.errorText : disabled ? palette.textSecondary : palette.text,
              borderRadius: radius.sm,
              paddingHorizontal: spacing.md,
              paddingRight: controlSize.inputAccessoryInset,
              minHeight: controlSize.regular,
              ...type.moneyInput,
              ...(disabled ? { borderColor: palette.border } : null),
            }}
          />
          {disabled ? null : (
            <Pressable
              ref={calculatorTriggerRef}
              accessibilityRole="button"
              accessibilityLabel={tr.a11y.openCalculator}
              accessibilityHint={accessibilityLabel ?? label}
              onPress={() => setCalcOpen(true)}
              // The icon is 18px and `hitSlop` does not enlarge the DOM box on
              // web, which left an 18px-wide target (WCAG 2.2 SC 2.5.8 asks for
              // 24). The box now fills the input's reserved 44px right padding
              // with the icon centred, so the mark does not visibly move.
              style={fieldAccessoryPressStyle(palette)}
            >
              <CalculatorIcon accessible={false} size={iconSize.accessory} color={palette.textSecondary} />
            </Pressable>
          )}
        </View>
      </View>
      <FieldError message={resolvedError} />
      {calcOpen ? (
        <CalculatorModal
          returnFocusRef={calculatorTriggerRef}
          onClose={() => setCalcOpen(false)}
          onResult={(major) => {
            const resultMinor = majorToMinor(major);
            if (resultMinor == null) return;
            const raw = formatMinorInput(resultMinor);
            onChangeMinor(raw, resultMinor);
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * The calculator modal, imported like anything else.
 *
 * This used to be a deferred `require()` because `calculator.tsx` reached back
 * into this module for `Button` and `FadeIn`, and the comment here said the
 * cycle would only go away if those two moved into a leaf module. They have:
 * both now live in `./primitives`, the calculator imports them from there, and
 * `madge --circular` has nothing left to report.
 */
/** Width of a select row's icon column, so every label starts at one x. */

export function MonthStepper({
  value,
  onChange,
  min,
  max,
}: {
  value: MonthKey;
  onChange: (m: MonthKey) => void;
  min?: MonthKey;
  max?: MonthKey;
}) {
  const canPrev = !min || value > min;
  const canNext = !max || value < max;
  return (
    <Spread style={{ marginBottom: spacing.md }}>
      <IconButton icon={ChevronLeft} label={tr.common.previous} haptic="selection" disabled={!canPrev} onPress={() => onChange(addMonthsToKey(value, -1))} />
      <Heading style={{ marginVertical: 0 }}>{monthLabel(value)}</Heading>
      <IconButton icon={ChevronRight} label={tr.common.next} haptic="selection" disabled={!canNext} onPress={() => onChange(addMonthsToKey(value, 1))} />
    </Spread>
  );
}

const TOGGLE_W = toggleSize.width;
const TOGGLE_H = toggleSize.height;
const TOGGLE_PAD = toggleSize.padding;
const TOGGLE_THUMB = TOGGLE_H - TOGGLE_PAD * 2;
export function Toggle({
  value,
  onValueChange,
  label,
  disabled,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(value ? 1 : 0);
      return;
    }
    const animation = Animated.spring(progress, { toValue: value ? 1 : 0, useNativeDriver: false, ...motion.spring.toggle });
    animation.start();
    return () => animation.stop();
  }, [value, progress, reducedMotion]);
  // On is the filled state. It used to be the pale one while off was the
  // darker `surfaceStrong`, so a settings list read back inverted: the switches
  // that were OFF looked heavier than the ones that were ON. The brand fill is
  // 5.3–7.2:1 against every surface it sits on, so the on state carries itself;
  // the off state stays a quiet neutral and keeps the hairline that gives it a
  // shape at all.
  const trackColor = disabled
    ? palette.surfaceAlt
    : progress.interpolate({ inputRange: [0, 1], outputRange: [palette.surfaceAlt, palette.primary] });
  const thumbX = progress.interpolate({ inputRange: [0, 1], outputRange: [TOGGLE_PAD, TOGGLE_W - TOGGLE_THUMB - TOGGLE_PAD] });
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      aria-checked={value}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => {
        selectionTap();
        onValueChange(!value);
      }}
      // The track is 28pt tall by design. Padding — not `hitSlop`, which the
      // web ignores — gives the control the platform's minimum height without
      // moving the track a pixel.
      style={({ pressed }) => ({
        minHeight: controlSize.minimumTarget,
        justifyContent: "center",
        paddingHorizontal: (controlSize.minimumTarget - TOGGLE_W) / 2 > 0 ? (controlSize.minimumTarget - TOGGLE_W) / 2 : 0,
        opacity: pressed && !disabled ? stateOpacity.pressed : 1,
      })}
    >
      {/* The off fill is a low-contrast warm neutral (1.1–1.3:1 against the
          app's surfaces), so the boundary is what gives it a shape at all —
          on the refund row, whose background was the same token, the switch
          once disappeared outright. The on fill needs no such help, and a
          hairline in `controlBorder` would sit at 1.2:1 on it, so the on state
          edges itself. */}
      <Animated.View
        style={{
          width: TOGGLE_W,
          height: TOGGLE_H,
          borderRadius: TOGGLE_H / 2,
          backgroundColor: trackColor,
          borderWidth: borderWidth.toggle,
          borderColor: value && !disabled ? palette.primaryStrong : palette.controlBorder,
          justifyContent: "center",
        }}
      >
        <View
          pointerEvents="none"
          accessible={false}
          style={{
            position: "absolute",
            left: 7,
            right: 7,
            top: 0,
            bottom: 0,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Check size={11} color={value && !disabled ? palette.onPrimary : "transparent"} strokeWidth={3} />
          <Minus size={11} color={!value && !disabled ? palette.textSecondary : "transparent"} strokeWidth={3} />
        </View>
        {/* The thumb carries the tab bar's material language — a crisp hairline
            edge over the shadow, so it reads as a lens sitting on the track
            rather than a flat dot. The TRACK deliberately stays opaque: its two
            fills are what `theme-contrast.test.ts` measures, and letting the
            row behind show through is how this control once vanished
            completely on the refund row. */}
        <Animated.View
          style={{
            width: TOGGLE_THUMB,
            height: TOGGLE_THUMB,
            borderRadius: TOGGLE_THUMB / 2,
            backgroundColor: disabled ? palette.textSecondary : value ? palette.onPrimary : palette.textSecondary,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.surfaceTranslucent,
            transform: [{ translateX: thumbX }],
            ...themeShadow.toggleThumb(palette),
          }}
        />
      </Animated.View>
    </Pressable>
  );
}

/** Initials avatar with a deterministic hue from the name (logo fallback). */
