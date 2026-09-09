/** Helix brand mark — the botanical DNA-helix symbol, theme-aware. Uses the
 *  charcoal artwork on light surfaces and the cream artwork on dark / gradient. */

import { View } from "react-native";
import { Image } from "expo-image";
import { useTheme } from "./theme";

const SYMBOL_LIGHT = require("../../assets/brand/symbol-light-t.png");
const SYMBOL_DARK = require("../../assets/brand/symbol-dark-t.png");

/**
 * The artwork's own proportions, and why `size` is a HEIGHT.
 *
 * The mark is taller than it is wide. It used to be delivered on a 1024x1024
 * canvas with the ink centred inside it — measured, 606x789 of ink with 210px
 * of transparency down each side and 118 across the top — and `contentFit`
 * honoured that transparency as though it were part of the drawing. A caller
 * asking for 40 got a mark 30.8pt tall sitting in a 40pt box, so it read small
 * against the heading it leads and carried 9pt of invisible margin into the
 * gap beside it.
 *
 * The canvas is now the mark: the padding is cropped, losslessly — every ink
 * pixel is byte-identical and the resolution is untouched at 606x789, which is
 * still five times what a 48pt mark needs on a 3x display. So the box can hold
 * the real ratio, `size` can mean the height it always looked like it meant,
 * and the width follows instead of being guessed at.
 */
const MARK_ASPECT = 606 / 789;

export function BrandMark({ size = 56, onGradient = false }: { size?: number; onGradient?: boolean }) {
  const { scheme } = useTheme();
  const source = onGradient || scheme === "dark" ? SYMBOL_DARK : SYMBOL_LIGHT;
  const width = Math.round(size * MARK_ASPECT);
  return (
    // The hiding lives on a wrapper because it cannot live on the image.
    // `expo-image` renders its own web `<img>` and forwards only `alt`, `src`
    // and `style` — every accessibility prop passed to it is dropped, so the
    // mark's `accessible={false}` never reached the DOM and the art sat in the
    // accessibility tree as an unnamed node. `aria-hidden` on an ancestor
    // removes its subtree per ARIA, and the two native props do the same on
    // iOS and Android.
    <View
      aria-hidden
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width, height: size }}
    >
      <Image
        alt=""
        source={source}
        style={{ width, height: size }}
        contentFit="contain"
      />
    </View>
  );
}
