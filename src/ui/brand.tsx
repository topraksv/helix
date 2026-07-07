/** Helix brand mark: a double helix — one solid strand, one behind it, with
 *  three connecting rungs. Matches the app icon / favicon exactly. */

import React from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient as SvgGradient, Path, Stop } from "react-native-svg";
import { useTheme } from "./theme";

export function BrandMark({ size = 56, onGradient = false }: { size?: number; onGradient?: boolean }) {
  const { palette } = useTheme();
  const front = onGradient ? "#FFFFFF" : "url(#helixGrad)";
  const back = onGradient ? "#FFFFFF" : palette.primary;
  const backOpacity = onGradient ? 0.5 : 0.32;
  const sw = 9;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
        <Defs>
          <SvgGradient id="helixGrad" x1="0" y1="0" x2="100" y2="100">
            <Stop offset="0" stopColor={palette.gradientFrom} />
            <Stop offset="1" stopColor={palette.gradientTo} />
          </SvgGradient>
        </Defs>
        {/* back strand */}
        <Path d="M67 15 C 67 39, 33 47, 33 50 C 33 53, 67 61, 67 85" stroke={back} strokeOpacity={backOpacity} strokeWidth={sw} strokeLinecap="round" />
        {/* rungs */}
        <Path d="M39 23 H61" stroke={front} strokeWidth={5.5} strokeLinecap="round" opacity={0.9} />
        <Path d="M45 50 H55" stroke={front} strokeWidth={5.5} strokeLinecap="round" opacity={0.9} />
        <Path d="M39 77 H61" stroke={front} strokeWidth={5.5} strokeLinecap="round" opacity={0.9} />
        {/* front strand */}
        <Path d="M33 15 C 33 39, 67 47, 67 50 C 67 53, 33 61, 33 85" stroke={front} strokeWidth={sw} strokeLinecap="round" />
      </Svg>
    </View>
  );
}
