/**
 * Helix presentation taxonomy. Routes choose a class by task semantics; the
 * class owns the header, safe-area and dismissal contract, while the surface
 * owns its content density.
 */
export type PresentationClass =
  | "primary-page"
  | "drill-down"
  | "task-sheet"
  | "bottom-sheet"
  | "contextual-overlay";

export const PRESENTATION_TAXONOMY: Record<PresentationClass, {
  description: string;
  backAction: "back" | "close" | "dismiss";
}> = {
  "primary-page": {
    description: "A full navigation page with browser/native back.",
    backAction: "back",
  },
  "drill-down": {
    description: "A detail or editor reached from a parent workspace.",
    backAction: "back",
  },
  "task-sheet": {
    description: "A focused task that returns to its owning workspace.",
    backAction: "close",
  },
  "bottom-sheet": {
    description: "A short contextual choice anchored to the current task.",
    backAction: "dismiss",
  },
  "contextual-overlay": {
    description: "A temporary alert, prompt or picker with focus restoration.",
    backAction: "dismiss",
  },
};
