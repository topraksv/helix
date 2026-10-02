/**
 * Helix's mark, the botanical helix, drawn as vectors so it is sharp at any
 * size and can draw itself on the brand kit's timeline (2026-09-28): the two
 * strands trace down under widening masks, the rungs cross them in turn, the
 * vines reach out, then the leaves open from their stems one by one. Once the
 * intro ends every mask is dropped, so the resting mark is the kit's exact
 * drawing. The ink follows the theme and the clay leaves the palette's
 * accent, as the kit's dark, petrol and servi marks do; `onGradient` inks it
 * for a dark ground whatever the scheme. Only a cold start draws it; every
 * other screen shows it at rest. `named` writes the name under it,
 * left to right, as a cold start shows it. Reduced motion draws it at rest.
 *
 * The drawing, 18 KB of path data, is its own chunk on the web: the entry had
 * 14 KB of room left under its ceiling (measured 2026-09-28), and a mark that
 * draws itself in anyway loses nothing by arriving a frame later.
 */

import { useEffect, useId, useState } from "react";
import { Easing, View } from "react-native";
import Svg, { Defs, G, LinearGradient, Mask, Path, Rect, Stop } from "react-native-svg";

import type { Stroke } from "./brand-art";
import { useReducedMotion } from "./motion";
import { PALETTES, useTheme } from "./theme";

/** The drawing's width over its height, known before its chunk arrives. */
export const MARK_ASPECT = 468.6 / 611.38;

type Art = typeof import("./brand-art");
let art: Art | undefined;
let pending: Promise<Art> | undefined;

/** Settles once the drawing can be drawn. The launch screen waits on it, so
 *  its first frame after the native splash is the mark and never a blank box. */
export function preloadBrandMark(): Promise<Art> {
  return (pending ??= import("./brand-art").then((module) => (art = module)));
}

function useArt(): Art | undefined {
  const [, setArrived] = useState(art !== undefined);
  useEffect(() => {
    if (art) return;
    let live = true;
    void preloadBrandMark().then(() => live && setArrived(true));
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
  /** The name under the mark on a cold start (owner, 2026-10-02): it starts
   *  writing as the strands are half drawn and finishes with the last leaf. */
  name: { at: 450 },
} as const;

/**
 * The name as the kit's wordmark files set it, turned from beside the mark to
 * under it with the lockup's gap: half the mark's width at the name's size.
 * Its cap height is those files' own, not the lockup's 1.6 scaled to the
 * splash mark, which would make the name nearly three times the mark's width.
 * It writes itself under a mask whose soft edge, half a cap high, travels
 * with the pen; at rest there is no mask.
 */
const NAME_CAP = 44;
const NAME_GAP = (1.6 * NAME_CAP * MARK_ASPECT) / 2;

function Name({ id, art, ink, written }: { id: string; art: Art; ink: string; written: number | null }) {
  const [x, y, inkWidth, inkHeight] = art.WORDMARK_BOX;
  const scale = NAME_CAP / art.WORDMARK_CAP;
  const edge = art.WORDMARK_CAP / 2;
  const pen = x + (inkWidth + edge) * (written ?? 1);
  return (
    <Svg width={inkWidth * scale} height={inkHeight * scale} viewBox={`${x} ${y} ${inkWidth} ${inkHeight}`}>
      {written !== null && (
        <Defs>
          <LinearGradient id={`${id}p`} gradientUnits="userSpaceOnUse" x1={pen - edge} y1={0} x2={pen} y2={0}>
            <Stop offset={0} stopColor={REVEAL} />
            <Stop offset={1} stopColor={HIDE} />
          </LinearGradient>
          <Mask id={`${id}w`}>
            <Rect x={x} y={y} width={pen - x} height={inkHeight} fill={`url(#${id}p)`} />
          </Mask>
        </Defs>
      )}
      <Path d={art.WORDMARK} fill={ink} mask={written === null ? undefined : `url(#${id}w)`} />
    </Svg>
  );
}

/**
 * Milliseconds into the intro, or null once it is over. React state rather
 * than an animated value: a mask's stroke is not a prop the native driver can
 * reach, and under two seconds of re-renders on one small tree costs nothing.
 */
function useIntro(duration: number | undefined, ready: boolean): number | null {
  const reducedMotion = useReducedMotion();
  const [elapsed, setElapsed] = useState<number | null>(0);
  useEffect(() => {
    if (reducedMotion || !ready || duration === undefined) return;
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
  return reducedMotion || duration === undefined ? null : elapsed;
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

export function BrandMark({
  size = 56,
  onGradient = false,
  duration,
  named = false,
}: {
  size?: number;
  onGradient?: boolean;
  named?: boolean;
  /** The whole intro in milliseconds, the kit's timeline scaled evenly to fit.
   *  Omitted, the mark is drawn at rest: the owner wants it to draw itself on
   *  a cold start and nowhere else (2026-10-02). */
  duration?: number;
}) {
  const { palette, paletteId } = useTheme();
  const drawing = useArt();
  const { leaves } = TIMELINE;
  const natural = leaves.at + leaves.every * ((drawing?.LEAVES.length ?? 1) - 1) + leaves.for;
  const pace = (duration ?? natural) / natural;
  const elapsed = useIntro(duration, drawing !== undefined);
  // `useId` answers with colons, which a `url(#…)` reference cannot hold.
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const progress = (start: number, length: number) => (elapsed === null ? 1 : easeOut(Math.min(1, Math.max(0, (elapsed - start * pace) / (length * pace)))));
  const ink = onGradient ? PALETTES[paletteId].dark.textStrong : palette.textStrong;
  const clay = PALETTES[paletteId].light.primary;
  const width = Math.round(size * MARK_ASPECT);
  const box = { width, height: size };
  const hidden = { "aria-hidden": true, accessible: false, accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants", pointerEvents: "none" } as const;
  if (!drawing) return <View {...hidden} style={box} />;
  const { LEAVES, RUNG_DRAW, RUNG_GAPS, RUNGS_SOLO, STRAND_A, STRAND_B, STRAND_DRAW, VIEW_BOX, VINE_DRAW } = drawing;
  const { strands, rungs, vines, name } = TIMELINE;
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
      {/* Hung below the mark's box, so the mark keeps the place the native splash gave it. */}
      {named && (
        <View style={{ position: "absolute", top: size + NAME_GAP, left: (width - (drawing.WORDMARK_BOX[2] * NAME_CAP) / drawing.WORDMARK_CAP) / 2 }}>
          <Name id={id} art={drawing} ink={ink} written={tracing ? progress(name.at, natural - name.at) : null} />
        </View>
      )}
    </View>
  );
}
