/** Measurable phone-layout contracts kept outside React for regression tests. */

export const NARROW_ACTION_STACK_WIDTH = 430;

export function shouldStackListActions(viewportWidth: number): boolean {
  return viewportWidth < NARROW_ACTION_STACK_WIDTH;
}
