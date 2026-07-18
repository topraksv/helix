/** Measurable phone-layout contracts kept outside React for regression tests. */

export const PHONE_TOOL_SIZE = 40;
export const PHONE_TOOL_GAP = 8;
export const NARROW_ACTION_STACK_WIDTH = 430;

export function fixedToolRowWidth(count: number): number {
  return count * PHONE_TOOL_SIZE + Math.max(0, count - 1) * PHONE_TOOL_GAP;
}

export function shouldStackListActions(viewportWidth: number): boolean {
  return viewportWidth < NARROW_ACTION_STACK_WIDTH;
}
