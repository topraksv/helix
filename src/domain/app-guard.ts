/** Pure root-route guard. Effects consume `redirect`; rendering consumes `view`. */

export type RootRouteArea = "auth" | "recovery" | "onboarding" | "setup-helper" | "protected" | "root";
export type RootGuardRedirect = "/(auth)/sign-in" | "/(onboarding)/setup" | "/(tabs)";

export interface RootGuardInput {
  ready: boolean;
  locked: boolean | null;
  userId: string | null;
  onboarded: boolean | null;
  awaitingFirstPull: boolean;
  route: RootRouteArea;
}

export interface RootGuardDecision {
  view: "wait" | "stack";
  redirect: RootGuardRedirect | null;
}

export function classifyRootRoute(segments: readonly string[]): RootRouteArea {
  const first = segments[0];
  const second = segments[1];
  if (!first) return "root";
  if (first === "(auth)" && second === "reset-password") return "recovery";
  if (first === "(auth)") return "auth";
  if (first === "(onboarding)") return "onboarding";
  if (first === "import-wizard" || first === "bulk-entry") return "setup-helper";
  return "protected";
}

export function resolveRootGuard(input: RootGuardInput): RootGuardDecision {
  if (!input.ready || input.locked !== false) return { view: "wait", redirect: null };

  if (!input.userId) {
    if (input.route === "auth" || input.route === "recovery") return { view: "stack", redirect: null };
    return { view: "wait", redirect: "/(auth)/sign-in" };
  }

  if (input.onboarded == null) return { view: "wait", redirect: null };
  if (!input.onboarded) {
    if (input.route === "recovery" || input.route === "onboarding" || input.route === "setup-helper") {
      return { view: "stack", redirect: null };
    }
    if (input.awaitingFirstPull) return { view: "wait", redirect: null };
    return { view: "wait", redirect: "/(onboarding)/setup" };
  }

  if (input.route === "recovery" || input.route === "protected" || input.route === "setup-helper") {
    return { view: "stack", redirect: null };
  }
  return { view: "wait", redirect: "/(tabs)" };
}
