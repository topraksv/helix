import React, { type ReactNode } from "react";
import { View } from "react-native";
import { spacing } from "./theme";
import { useContentWidth } from "./viewport";
import { shouldPairByMass } from "./responsive";

/**
 * The geometry of a wide task page, shared with anything that has to line up
 * with it — the column editor's tab strip breaks on the same vertical as the
 * boundary between its two panes, and a strip that guesses at 50/50 lands a
 * finger's width off the card below it.
 */
const WORKSPACE_SPLIT = { breakpoint: 900, primaryWeight: 0.9, secondaryWeight: 1.1, gap: spacing.xl } as const;

/**
 * The share of the full width the primary pane takes, gap included, or null
 * below the breakpoint — where the panes are stacked and nothing lines up with
 * anything.
 */
export function workspaceSplitShares(width: number): [number, number] | null {
  const { breakpoint, primaryWeight, secondaryWeight, gap } = WORKSPACE_SPLIT;
  if (width < breakpoint) return null;
  const primary = (primaryWeight / (primaryWeight + secondaryWeight)) * (width - gap);
  return [primary, width - primary];
}

/**
 * Task pages use the same reading order on every device: the active editor
 * first, the records it manages second. Wide screens place those two jobs side
 * by side without changing their semantic order or introducing another card.
 */
export function WorkspaceSplit({
  primary,
  secondary,
  primaryWeight = WORKSPACE_SPLIT.primaryWeight,
  secondaryWeight = WORKSPACE_SPLIT.secondaryWeight,
  wideLayout = "split",
  testID,
}: {
  primary: ReactNode;
  secondary: ReactNode;
  primaryWeight?: number;
  secondaryWeight?: number;
  /** Empty context panes can return their width to the active editor. */
  wideLayout?: "split" | "stack";
  testID?: string;
}) {
  const width = useContentWidth();
  const wide = width >= WORKSPACE_SPLIT.breakpoint && wideLayout === "split";
  return (
    <View
      testID={testID}
      style={{
        flexDirection: wide ? "row" : "column",
        alignItems: wide ? "flex-start" : "stretch",
        gap: wide ? WORKSPACE_SPLIT.gap : 0,
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
  layout = "grid",
  masses,
  grow = true,
  testID,
}: {
  children: ReactNode;
  /** Independent peers may share a desktop row; sequential work stays one stream. */
  layout?: "grid" | "stack";
  /** Relative content weight per child (row counts, usually). Extreme
   *  imbalance keeps the stream rather than pairing. */
  masses?: number[];
  /** False for grids of identical controls, so an odd last one keeps the column width. */
  grow?: boolean;
  testID?: string;
}) {
  const width = useContentWidth();
  const balanced = masses == null || shouldPairByMass(masses);
  const wide = layout === "grid" && balanced && width >= WORKSPACE_SPLIT.breakpoint;
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
          style={wide ? { flexBasis: "47%", flexGrow: grow ? 1 : 0, minWidth: 0 } : { width: "100%" }}
        >
          {child}
        </View>
      ))}
    </View>
  );
}
