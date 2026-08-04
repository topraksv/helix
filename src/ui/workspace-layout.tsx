import React, { type ReactNode } from "react";
import { View } from "react-native";
import { spacing } from "./theme";
import { useContentWidth } from "./viewport";
import { shouldPairByMass } from "./responsive";

/**
 * Task pages use the same reading order on every device: the active editor
 * first, the records it manages second. Wide screens place those two jobs side
 * by side without changing their semantic order or introducing another card.
 */
export function WorkspaceSplit({
  primary,
  secondary,
  breakpoint = 900,
  primaryWeight = 0.9,
  secondaryWeight = 1.1,
  wideLayout = "split",
  testID,
}: {
  primary: ReactNode;
  secondary: ReactNode;
  breakpoint?: number;
  primaryWeight?: number;
  secondaryWeight?: number;
  /** Empty context panes can return their width to the active editor. */
  wideLayout?: "split" | "stack";
  testID?: string;
}) {
  const width = useContentWidth();
  const wide = width >= breakpoint && wideLayout === "split";
  return (
    <View
      testID={testID}
      style={{
        flexDirection: wide ? "row" : "column",
        alignItems: wide ? "flex-start" : "stretch",
        gap: wide ? spacing.xl : 0,
      }}
    >
      <View
        testID={testID ? `${testID}-primary` : undefined}
        style={wide ? { flex: primaryWeight, minWidth: 0 } : { width: "100%" }}
      >
        {primary}
      </View>
      <View
        testID={testID ? `${testID}-secondary` : undefined}
        style={wide ? { flex: secondaryWeight, minWidth: 0 } : { width: "100%" }}
      >
        {secondary}
      </View>
    </View>
  );
}

/**
 * Independent peer tasks may share a row on desktop, but remain one readable
 * stream on phones. The child itself owns its surface and semantics.
 */
export function WorkspaceGrid({
  children,
  breakpoint = 900,
  layout = "grid",
  masses,
  testID,
}: {
  children: ReactNode;
  breakpoint?: number;
  /** Independent peers may share a desktop row; sequential work stays one stream. */
  layout?: "grid" | "stack";
  /** Relative content weight per child (row counts, usually). Extreme
   *  imbalance keeps the stream rather than pairing. */
  masses?: number[];
  testID?: string;
}) {
  const width = useContentWidth();
  const balanced = masses == null || shouldPairByMass(masses);
  const wide = layout === "grid" && balanced && width >= breakpoint;
  return (
    <View
      testID={testID}
      style={{
        flexDirection: wide ? "row" : "column",
        flexWrap: "wrap",
        alignItems: "stretch",
        columnGap: wide ? spacing.lg : 0,
      }}
    >
      {React.Children.map(children, (child, index) => (
        <View
          testID={testID ? `${testID}-item-${index}` : undefined}
          style={wide ? { flexBasis: "47%", flexGrow: 1, minWidth: 0 } : { width: "100%" }}
        >
          {child}
        </View>
      ))}
    </View>
  );
}
