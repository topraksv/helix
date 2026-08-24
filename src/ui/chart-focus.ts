/**
 * Which element of a chart the reader is asking about — and whether they said
 * so deliberately.
 *
 * Two signals, one answer, kept outside React so the rules are a test rather
 * than a device. A pointer HOVERING a slice or a column asks a passing
 * question, so it clears when the pointer leaves. A tap or a click is a
 * decision, so it survives the pointer leaving and the finger lifting.
 *
 * Before this they shared one piece of state: clicking a legend row selected
 * it and moving the mouse one pixel away threw the selection straight back, so
 * on the web a lock could not be held at all — and there was no way out of a
 * selection except finding and re-pressing the exact element that made it,
 * which on a three-percent arc is a target a few pixels wide.
 */
export interface ChartFocusState {
  /** Set deliberately, and therefore held. */
  locked: number | null;
  /** A pointer passing over something. */
  hovered: number | null;
}

export type ChartFocusAction =
  | { type: "toggle"; index: number }
  | { type: "preview"; index: number }
  | { type: "endPreview"; index: number }
  | { type: "clear" };

export const EMPTY_CHART_FOCUS: ChartFocusState = { locked: null, hovered: null };

/** What is highlighted right now: the lock if there is one, else the hover. */
export function chartFocusActive(state: ChartFocusState): number | null {
  return state.locked ?? state.hovered;
}

export function chartFocusReducer(state: ChartFocusState, action: ChartFocusAction): ChartFocusState {
  switch (action.type) {
    case "toggle":
      // Taking or releasing a lock also drops any hover, so releasing the lock
      // leaves nothing highlighted rather than falling back to whatever the
      // pointer happened to be over when the click landed.
      return { locked: state.locked === action.index ? null : action.index, hovered: null };
    case "preview":
      // A hover may not displace a lock. It is a passing question and the lock
      // is an answer the reader chose.
      return state.hovered === action.index ? state : { ...state, hovered: action.index };
    case "endPreview":
      return state.hovered === action.index ? { ...state, hovered: null } : state;
    case "clear":
      return EMPTY_CHART_FOCUS;
    default:
      return state;
  }
}
