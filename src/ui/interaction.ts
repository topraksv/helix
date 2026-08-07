/**
 * The app's one hover and pressed fill.
 *
 * It lives in its own leaf module rather than in `primitives.tsx` because the
 * controls that need it are everywhere — the table, the calendar, the calculator,
 * a dozen screens — and most of them have no other reason to pull the primitive
 * library in.
 */

import { Platform, type PressableStateCallbackType, type ViewStyle } from "react-native";
import { isReducedMotion } from "./motion";
import { motion, type Palette } from "./theme";

/**
 * Whether a pointer is resting on this control.
 *
 * react-native-web's `Pressable` already tracks hover and hands it to the style
 * callback — it re-renders on enter and leave whether or not anyone reads it —
 * so taking the flag from there costs nothing, while adding
 * `onHoverIn`/`onHoverOut` state of our own would have paid for the same render
 * twice. React Native's types only declare `pressed` (iOS and Android have no
 * pointer to hover with), which is why the read is written once here instead of
 * being cast at every control.
 */
export function isHovered(state: PressableStateCallbackType): boolean {
  return (state as { hovered?: boolean }).hovered === true;
}

/**
 * Alpha of the palette's own ink, laid over whatever the control already sits
 * on.
 *
 * Measured, not chosen by eye. The six shipped palettes used to step
 * 1.253:1 – 1.556:1 from `surface` to their `surfaceHover` token, so the same
 * gesture was almost twice as loud in Amber Light as in Petrol Dark, and every
 * one of them was far past what a hover should say — that is a selected-state
 * amount of contrast spent on a pointer passing by. One alpha over the surface
 * underneath lands all six inside 1.12:1 – 1.16:1, and lands on the same step
 * again over `surfaceAlt`, a card, or a highlighted row. That is what
 * "consistent" has to mean when the thing under the pointer is a different
 * colour on every screen.
 */
const INTERACTION_ALPHA = { hover: 0.06, pressed: 0.11 } as const;

/** `alpha` of `tint` composited over an opaque `base`. */
function composite(base: string, tint: string, alpha: number): string {
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16);
  return `#${[1, 3, 5]
    .map((at) => Math.round(channel(base, at) * (1 - alpha) + channel(tint, at) * alpha))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function alphaHex(alpha: number): string {
  return Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, "0");
}

/** The translucent form, for a control with no fill of its own. */
function translucent(tint: string, alpha: number): string {
  return `${tint}${alphaHex(alpha)}`;
}

/**
 * A tint that is already translucent, made denser by the interaction's alpha.
 *
 * One `backgroundColor` cannot hold two layers, and the colour BEHIND a
 * translucent fill is unknown at this point, so the ink cannot be composited
 * into it. Raising the fill's own alpha by the same amount is the closest
 * single-colour equivalent and reads the same way: the tile the pointer is on
 * gets denser. It is also what the hand-written fills this replaced were doing
 * — `primarySoft + "55"` became `primarySoft` under a press.
 */
function denser(base: string, alpha: number): string {
  const current = parseInt(base.slice(7, 9), 16) / 255;
  return `${base.slice(0, 7)}${alphaHex(current + alpha)}`;
}

export interface InteractionOptions {
  /** The control's own resting background, if it paints one. */
  base?: string;
  /** False for a disabled control: it keeps its resting fill and never reacts. */
  enabled?: boolean;
}

/**
 * Return this from a `Pressable`'s style callback, on the PRESSABLE itself —
 * not on a child, and not on a box narrower than the control.
 *
 * Painted on an inner box the fill stops short of the control's own padding,
 * which is what made a hovered row light a band narrower than the row it
 * belonged to. Where the pressable is deliberately larger than the painted
 * chip — an icon button's 44pt target around a 36pt chip — paint the chip and
 * accept that, but never the reverse.
 *
 * Given `base` the overlay is composited into an opaque colour; without one the
 * translucent ink is returned and composites against whatever is behind at
 * paint time. Both paths produce the same step, which is the point: a settings
 * row over a card, a matrix cell over the table, and a filled button all had
 * their own hand-picked fill before, and no two of them moved by the same
 * amount.
 */
export function interactionSurface(
  palette: Palette,
  state: PressableStateCallbackType,
  { base = "transparent", enabled = true }: InteractionOptions = {},
): ViewStyle {
  const opaqueBase = /^#[0-9a-f]{6}$/i.test(base) ? base : null;
  const translucentBase = /^#[0-9a-f]{8}$/i.test(base) ? base : null;
  const level = !enabled ? null : state.pressed ? "pressed" : isHovered(state) ? "hover" : null;
  // With NO base at all — the default — this declares no background rather than
  // a transparent one, so a caller that paints its own fill somewhere else in
  // the style array keeps it: a toned card, a highlighted matrix cell. This
  // style is applied last on purpose, and returning `transparent` here would
  // have quietly erased every one of them.
  //
  // A base that WAS given is this control's resting fill and must be returned
  // at rest, opaque or not. Losing that is what turned the selected palette
  // tile transparent: its `accent + "14"` lived in exactly the expression this
  // helper replaced.
  const restingFill: ViewStyle = opaqueBase || translucentBase ? { backgroundColor: base } : {};
  const fill: ViewStyle = level == null
    ? restingFill
    : {
        backgroundColor: opaqueBase
          ? composite(opaqueBase, palette.textStrong, INTERACTION_ALPHA[level])
          : translucentBase
            ? denser(translucentBase, INTERACTION_ALPHA[level])
            : translucent(palette.textStrong, INTERACTION_ALPHA[level]),
      };
  // Native has no pointer, so there is nothing to ease: the fill only ever
  // appears under a finger already on the control, where a fade reads as lag.
  if (Platform.OS !== "web") return fill;
  return {
    ...fill,
    transitionProperty: "background-color",
    transitionDuration: `${isReducedMotion() ? 0 : motion.hover}ms`,
    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
  } as unknown as ViewStyle;
}
