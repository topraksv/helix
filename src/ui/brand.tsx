/** Helix brand mark: two intertwined strands drawn as opposing sine curves. */

import React from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient as SvgGradient, Path, Stop } from "react-native-svg";
import { useTheme } from "./theme";

export function BrandMark({ size = 56, onGradient = false }: { size?: number; onGradient?: boolean }) {
  const { palette } = useTheme();
  const strandA = onGradient ? "#FFFFFF" : undefined;
  const strandB = onGradient ? "rgba(255,255,255,0.55)" : palette.textMuted + "88";
  // Two strands crossing twice over a 24x24 grid + connecting rungs.
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Defs>
          <SvgGradient id="strand" x1="0" y1="0" x2="24" y2="24">
            <Stop offset="0" stopColor={palette.gradientFrom} />
            <Stop offset="1" stopColor={palette.gradientTo} />
          </SvgGradient>
        </Defs>
        <Path
          d="M7 2c0 5 10 7 10 10s-10 5-10 10"
          stroke={strandA ?? "url(#strand)"}
          strokeWidth={2.4}
          strokeLinecap="round"
        />
        <Path
          d="M17 2c0 5-10 7-10 10s10 5 10 10"
          stroke={strandB}
          strokeWidth={2.4}
          strokeLinecap="round"
        />
        <Path d="M8.6 5h6.8M8.6 19h6.8" stroke={strandA ?? "url(#strand)"} strokeWidth={1.6} strokeLinecap="round" opacity={0.7} />
      </Svg>
    </View>
  );
}
