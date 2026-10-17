/** Pure root-route guard. Effects consume `redirect`; rendering consumes `view`. */

type RootRouteArea = "auth" | "public" | "onboarding" | "setup-helper" | "protected" | "root";
type RootGuardRedirect = "/(auth)/sign-in" | "/(onboarding)/setup" | "/(tabs)";

interface RootGuardInput {
  ready: boolean;
  locked: boolean | null;
  userId: string | null;
  onboarded: boolean | null;
  frozen: boolean | null;
  awaitingFirstPull: boolean;
  route: RootRouteArea;
}

interface RootGuardDecision {
  view: "wait" | "stack";
  redirect: RootGuardRedirect | null;
}

export function classifyRootRoute(segments: readonly string[]): RootRouteArea {
  const first = segments[0];
  if (!first) return "root";
  if (first === "(auth)") return "auth";
  // The KVKK notice must be readable BEFORE an account exists; as `protected` it would bounce to sign-in.
  if (first === "privacy") return "public";
  // The feedback form needs no account: sign-in sends a failure there.
  if (first === "feedback") return "public";
  if (first === "(onboarding)") return "onboarding";
  if (first === "import-wizard" || first === "bulk-entry") return "setup-helper";
  return "protected";
}

export function resolveRootGuard(input: RootGuardInput): RootGuardDecision {
  if (!input.ready || input.locked !== false) return { view: "wait", redirect: null };

  // A disclosure nobody can open discloses nothing, so this answers before the
  // session is considered; it is static text, so granting it is safe.
  if (input.route === "public") return { view: "stack", redirect: null };

  if (!input.userId) {
    if (input.route === "auth") return { view: "stack", redirect: null };
    return { view: "wait", redirect: "/(auth)/sign-in" };
  }

  if (input.onboarded == null) return { view: "wait", redirect: null };
  if (!input.onboarded) {
    if (input.route === "onboarding" || input.route === "setup-helper") {
      return { view: "stack", redirect: null };
    }
    if (input.awaitingFirstPull) return { view: "wait", redirect: null };
    return { view: "wait", redirect: "/(onboarding)/setup" };
  }

  // A resolved false is safe. Null is not: rendering protected UI while the
  // synced freeze flag is still loading can briefly expose a frozen account.
  if (input.frozen == null) return { view: "wait", redirect: null };

  if (input.route === "protected" || input.route === "setup-helper") {
    return { view: "stack", redirect: null };
  }
  return { view: "wait", redirect: "/(tabs)" };
}

/**
 * Why the workspace would not open; the two endings need opposite advice.
 *
 * `busy` is the app already open elsewhere. On web the SQLite file lives in
 * OPFS behind an exclusive handle and wa-sqlite's VFS then stays broken FOR
 * THAT DOCUMENT, so only a reload recovers; nothing is wrong with the data.
 * Matched on message text because no layer surfaces a code, and loosely: a
 * miss falls through to `unknown`, whose screen is right if less specific.
 */
export type BootFailure = "busy" | "unknown";

const BUSY_DATABASE = /invalid vfs state|nomodificationallowed|access handle|already locked|database is locked|being used by another/i;

export function classifyBootFailure(error: unknown): BootFailure {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return BUSY_DATABASE.test(text) ? "busy" : "unknown";
}
