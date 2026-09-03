/** Helix brand mark — the botanical DNA-helix symbol, theme-aware. Uses the
 *  charcoal artwork on light surfaces and the cream artwork on dark / gradient. */

import { View } from "react-native";
import { Image } from "expo-image";
import { useTheme } from "./theme";

const SYMBOL_LIGHT = require("../../assets/brand/symbol-light-t.png");
const SYMBOL_DARK = require("../../assets/brand/symbol-dark-t.png");

export function BrandMark({ size = 56, onGradient = false }: { size?: number; onGradient?: boolean }) {
  const { scheme } = useTheme();
  const source = onGradient || scheme === "dark" ? SYMBOL_DARK : SYMBOL_LIGHT;
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
      style={{ width: size, height: size }}
    >
      <Image
        alt=""
        source={source}
        style={{ width: size, height: size }}
        contentFit="contain"
      />
    </View>
  );
}
