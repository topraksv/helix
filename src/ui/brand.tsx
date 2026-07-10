/** Helix brand mark: a botanical double helix — two intertwined strands with
 *  three rungs and sage/terracotta leaves. Matches the app icon / favicon. */

import React from "react";
import { View } from "react-native";
import Svg, { G, Path } from "react-native-svg";
import { useTheme } from "./theme";

const LEAF = "M0 0 C 4 -4.6 10 -4.6 14 0 C 10 4.6 4 4.6 0 0 Z";
const LEAF_S = "M0 0 C 2.6 -3 6.6 -3 9 0 C 6.6 3 2.6 3 0 0 Z";
const SAGE = "#7D8370";
const TERRA = "#C9623F";

export function BrandMark({ size = 56, onGradient = false }: { size?: number; onGradient?: boolean }) {
  const { palette } = useTheme();
  const strand = onGradient ? "#FFFFFF" : palette.text;
  const sw = 8.5;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
        {/* botanical leaves */}
        <G>
          <Path d={LEAF} fill={SAGE} transform="translate(30 44) rotate(-30)" />
          <Path d={LEAF} fill={TERRA} transform="translate(70 58) rotate(18)" />
          <Path d={LEAF_S} fill={SAGE} transform="translate(69 37) rotate(38)" />
          <Path d={LEAF_S} fill={TERRA} transform="translate(31 64) rotate(200)" />
        </G>
        {/* helix strands + rungs */}
        <G stroke={strand} strokeLinecap="round" fill="none">
          <Path d="M33 15 C 33 39, 67 47, 67 50 C 67 53, 33 61, 33 85" strokeWidth={sw} />
          <Path d="M67 15 C 67 39, 33 47, 33 50 C 33 53, 67 61, 67 85" strokeWidth={sw} strokeOpacity={0.5} />
          <Path d="M40 22 H60" strokeWidth={5} strokeOpacity={0.9} />
          <Path d="M45 50 H55" strokeWidth={5} strokeOpacity={0.9} />
          <Path d="M40 78 H60" strokeWidth={5} strokeOpacity={0.9} />
        </G>
      </Svg>
    </View>
  );
}
