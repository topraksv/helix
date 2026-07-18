/** Helix brand mark — the botanical DNA-helix symbol, theme-aware. Uses the
 *  charcoal artwork on light surfaces and the cream artwork on dark / gradient. */

import React from "react";
import { Image } from "expo-image";
import { useTheme } from "./theme";

const SYMBOL_LIGHT = require("../../assets/brand/symbol-light-t.png");
const SYMBOL_DARK = require("../../assets/brand/symbol-dark-t.png");

export function BrandMark({ size = 56, onGradient = false }: { size?: number; onGradient?: boolean }) {
  const { scheme } = useTheme();
  const source = onGradient || scheme === "dark" ? SYMBOL_DARK : SYMBOL_LIGHT;
  return (
    <Image
      accessible={false}
      accessibilityRole="none"
      accessibilityLabel=""
      alt=""
      source={source}
      style={{ width: size, height: size }}
      contentFit="contain"
    />
  );
}
