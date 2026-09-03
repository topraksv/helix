/** Pure root-route guard. Effects consume `redirect`; rendering consumes `view`. */

type RootRouteArea = "auth" | "recovery" | "public" | "onboarding" | "setup-helper" | "protected" | "root";
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
  const second = segments[1];
  if (!first) return "root";
  if (first === "(auth)" && second === "reset-password") return "recovery";
  if (first === "(auth)") return "auth";
  // The KVKK notice is the one screen whose whole job is to be readable BEFORE
  // an account exists. Left in the fall-through below it classified as
  // `protected`, so the guard bounced a signed-out reader straight back to
  // sign-in and the link on that screen did nothing at all.
  if (first === "privacy") return "public";
  if (first === "(onboarding)") return "onboarding";
  if (first === "import-wizard" || first === "bulk-entry") return "setup-helper";
  return "protected";
}

export function resolveRootGuard(input: RootGuardInput): RootGuardDecision {
  if (!input.ready || input.locked !== false) return { view: "wait", redirect: null };

  // A disclosure nobody can open discloses nothing, so this route answers
  // before the session is even considered. It carries no account data — it is
  // the same static text for every reader — which is what makes granting it
  // unconditionally safe rather than merely convenient.
  if (input.route === "public") return { view: "stack", redirect: null };

  if (!input.userId) {
    if (input.route === "auth" || input.route === "recovery") return { view: "stack", redirect: null };
    return { view: "wait", redirect: "/(auth)/sign-in" };
  }

  // Password recovery must remain reachable regardless of onboarding/freeze
  // flags; it is the credential-repair surface, not protected account UI.
  if (input.route === "recovery") return { view: "stack", redirect: null };

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
 * Why the workspace would not open.
 *
 * There are two endings a person can act on and they need opposite advice, so
 * the boot screen has to tell them apart rather than saying "database error"
 * and leaving the guessing to whoever is holding the phone.
 *
 * `busy` is the app already being open somewhere else. On web the SQLite file
 * lives in OPFS behind an exclusive sync access handle: a second tab cannot
 * take it, and wa-sqlite's VFS then stays broken FOR THAT DOCUMENT, so no
 * amount of retrying in the page recovers — only a reload, once the other tab
 * is gone. Native hits the same shape when a second process holds the file.
 * Nothing is wrong with the data, which is the first thing to say.
 *
 * The strings are matched rather than a code because none of the layers
 * involved — OPFS, wa-sqlite, expo-sqlite — surfaces one. They are matched
 * loosely and on purpose: a miss falls through to `unknown`, whose screen is
 * correct for every failure including this one, just less specific.
 */
export type BootFailure = "busy" | "unknown";

const BUSY_DATABASE = /invalid vfs state|nomodificationallowed|access handle|already locked|database is locked|being used by another/i;

export function classifyBootFailure(error: unknown): BootFailure {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return BUSY_DATABASE.test(text) ? "busy" : "unknown";
}
