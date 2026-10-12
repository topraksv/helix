/** PII-free local health events in production; raw details only in development. */
import { recordDiagnostic } from "./diagnostics";

export function devError(scope: string, error: unknown, detail?: unknown): void {
  recordDiagnostic(scope, "error", error);
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.error("Helix development error", { scope, error, detail: detail ?? "" });
  }
}

export function devWarning(scope: string, message: string): void {
  recordDiagnostic(scope, "warning", message);
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.warn("Helix development warning", { scope, message });
  }
}

// Both handlers delegate to the previous one: swallowing it would hide the red box and the native crash report.
interface GlobalErrorUtils {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
}

interface CrashHost {
  ErrorUtils?: GlobalErrorUtils;
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
}

let crashHandlersInstalled = false;

/** Idempotent: Fast Refresh re-runs module bodies, and chaining a handler onto
 *  itself would record one crash once per reload of this file. */
export function installCrashHandlers(host: CrashHost = globalThis as CrashHost): void {
  if (crashHandlersInstalled) return;
  crashHandlersInstalled = true;

  const errorUtils = host.ErrorUtils;
  if (errorUtils?.setGlobalHandler && errorUtils.getGlobalHandler) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      // A throw from the recorder would replace the app's crash with this
      // function's crash, and the original error would be lost on the way.
      try {
        devError(isFatal ? "crash.fatal" : "crash.uncaught", error);
      } catch {
        // Nothing to fall back to; the delegate below is what matters.
      }
      previous?.(error, isFatal);
    });
  }

  if (typeof host.addEventListener !== "function") return;
  host.addEventListener("error", (event) => {
    const source = event as { error?: unknown; message?: unknown };
    try {
      devError("crash.uncaught", source?.error ?? source?.message ?? event);
    } catch {
      // Same reason as above.
    }
  });
  host.addEventListener("unhandledrejection", (event) => {
    try {
      devError("crash.rejection", (event as { reason?: unknown })?.reason ?? event);
    } catch {
      // Same reason as above.
    }
  });
}
