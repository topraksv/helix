/**
 * Helix's mark, the botanical helix, drawn as vectors so it is sharp at any
 * size and can draw itself on the brand kit's timeline (2026-09-28): the two
 * strands trace down under widening masks, the rungs cross them in turn, the
 * vines reach out, then the leaves open from their stems one by one. Once the
 * intro ends every mask is dropped, so the resting mark is the kit's exact
 * drawing. The ink follows the theme and the clay leaves the palette's
 * accent, as the kit's dark, petrol and servi marks do; `onGradient` inks it
 * for a dark ground whatever the scheme. Reduced motion draws it at rest.
 *
 * The drawing, 18 KB of path data, is its own chunk on the web: the entry had
 * 14 KB of room left under its ceiling (measured 2026-09-28), and a mark that
 * draws itself in anyway loses nothing by arriving a frame later.
 */

import { useEffect, useId, useState } from "react";
import { Easing, View } from "react-native";
import Svg, { Defs, G, Mask, Path, Rect } from "react-native-svg";

import type { Stroke } from "./brand-art";
import { useReducedMotion } from "./motion";
import { PALETTES, useTheme } from "./theme";

/** The drawing's width over its height, known before its chunk arrives. */
export const MARK_ASPECT = 468.6 / 611.38;

type Art = typeof import("./brand-art");
let art: Art | undefined;
let pending: Promise<Art> | undefined;

function useArt(): Art | undefined {
  const [, setArrived] = useState(art !== undefined);
  useEffect(() => {
    if (art) return;
    let live = true;
    void (pending ??= import("./brand-art").then((module) => (art = module))).then(() => live && setArrived(true));
    return () => {
      live = false;
    };
  }, []);
  return art;
}

const easeOut = Easing.bezier(0, 0, 0.58, 1);
const SAGE = "#8B9583";
/** What a mask shows through, and what it hides. */
const REVEAL = "#FFFFFF";
const HIDE = "#000000";

/** Milliseconds from the first frame, as the kit's timing table gives them. */
const TIMELINE = {
  strands: { at: 0, for: 900 },
  rungs: { at: 180, every: 60, for: 300 },
  vines: { at: 420, for: 360 },
  leaves: { at: 900, every: 70, for: 220, turn: 8 },
} as const;

/**
 * Milliseconds into the intro, or null once it is over. React state rather
 * than an animated value: a mask's stroke is not a prop the native driver can
 * reach, and under two seconds of re-renders on one small tree costs nothing.
 */
function useIntro(duration: number, ready: boolean): number | null {
  const reducedMotion = useReducedMotion();
  const [elapsed, setElapsed] = useState<number | null>(0);
  useEffect(() => {
    if (reducedMotion || !ready) return;
    const start = Date.now();
    let frame = 0;
    const tick = () => {
      const now = Date.now() - start;
      if (now >= duration) return setElapsed(null);
      setElapsed(now);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion, duration, ready]);
  return reducedMotion ? null : elapsed;
}

function DrawMask({ id, stroke, drawn, gaps }: { id: string; stroke: Stroke; drawn: number; gaps?: Art["RUNG_GAPS"] }) {
  return (
    <Mask id={id}>
      <Path
        d={stroke.d}
        fill="none"
        stroke={REVEAL}
        strokeWidth={stroke.width}
        strokeLinejoin="round"
        strokeDasharray={[stroke.length, stroke.length]}
        strokeDashoffset={stroke.length * (1 - drawn)}
      />
      {gaps?.map(([x, y, width, height]) => <Rect key={y} x={x} y={y} width={width} height={height} fill={HIDE} />)}
    </Mask>
  );
}

export function BrandMark({ size = 56, onGradient = false }: { size?: number; onGradient?: boolean }) {
  const { palette, paletteId } = useTheme();
  const drawing = useArt();
  const { leaves } = TIMELINE;
  const elapsed = useIntro(leaves.at + leaves.every * ((drawing?.LEAVES.length ?? 1) - 1) + leaves.for, drawing !== undefined);
  // `useId` answers with colons, which a `url(#…)` reference cannot hold.
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const progress = (start: number, duration: number) => (elapsed === null ? 1 : easeOut(Math.min(1, Math.max(0, (elapsed - start) / duration))));
  const ink = onGradient ? PALETTES[paletteId].dark.textStrong : palette.textStrong;
  const clay = PALETTES[paletteId].light.primary;
  const width = Math.round(size * MARK_ASPECT);
  const box = { width, height: size };
  const hidden = { "aria-hidden": true, accessible: false, accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants", pointerEvents: "none" } as const;
  if (!drawing) return <View {...hidden} style={box} />;
  const { LEAVES, RUNG_DRAW, RUNG_GAPS, RUNGS_SOLO, STRAND_A, STRAND_B, STRAND_DRAW, VIEW_BOX, VINE_DRAW } = drawing;
  const { strands, rungs, vines } = TIMELINE;
  const tracing = elapsed !== null;
  return (
    <View {...hidden} style={box}>
      <Svg width={width} height={size} viewBox={VIEW_BOX}>
        {tracing && (
          <Defs>
            {STRAND_DRAW.map((stroke, i) => <DrawMask key={i} id={`${id}s${i}`} stroke={stroke} drawn={progress(strands.at, strands.for)} gaps={RUNG_GAPS} />)}
            {RUNG_DRAW.map((stroke, i) => <DrawMask key={i} id={`${id}r${i}`} stroke={stroke} drawn={progress(rungs.at + rungs.every * i, rungs.for)} />)}
            {VINE_DRAW.map((stroke, i) => <DrawMask key={i} id={`${id}v${i}`} stroke={stroke} drawn={progress(vines.at, vines.for)} />)}
          </Defs>
        )}
        {tracing ? (
          <>
            <Path d={STRAND_A} fill={ink} mask={`url(#${id}s0)`} />
            <Path d={STRAND_B} fill={ink} mask={`url(#${id}s1)`} />
            {RUNG_DRAW.map((_, i) => (
              <G key={i} mask={`url(#${id}r${i})`}>
                <Path d={STRAND_A} fill={ink} />
                <Path d={STRAND_B} fill={ink} />
                <Path d={RUNGS_SOLO} fill={ink} />
              </G>
            ))}
            <Path d={STRAND_B} fill={ink} mask={`url(#${id}v0)`} />
            <Path d={STRAND_A} fill={ink} mask={`url(#${id}v1)`} />
          </>
        ) : (
          <>
            <Path d={STRAND_A} fill={ink} />
            <Path d={STRAND_B} fill={ink} />
            <Path d={RUNGS_SOLO} fill={ink} />
          </>
        )}
        {LEAVES.map((leaf, i) => {
          const open = progress(leaves.at + leaves.every * i, leaves.for);
          if (open === 0) return null;
          const [x, y] = leaf.pivot;
          return (
            <Path
              key={i}
              d={leaf.d}
              fill={leaf.fill === "clay" ? clay : SAGE}
              fillRule="evenodd"
              transform={open === 1 ? undefined : `translate(${x} ${y}) rotate(${leaf.turn * leaves.turn * (1 - open)}) scale(${open}) translate(${-x} ${-y})`}
            />
          );
        })}
      </Svg>
    </View>
  );
}
