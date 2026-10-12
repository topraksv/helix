// An uncaught failure must reach the ring, the previous handler must still run, and installing twice must not chain.
import { beforeEach, describe, expect, it, vi } from "vitest";

const recordDiagnostic = vi.fn();
vi.mock("../../src/services/diagnostics", () => ({ recordDiagnostic }));

/** A fresh module, because the install is once per process by design. */
async function freshLogger() {
  vi.resetModules();
  return import("../../src/services/logger");
}

type Listener = (event: unknown) => void;

function fakeHost() {
  const listeners = new Map<string, Listener[]>();
  const nativeCrashReport = vi.fn();
  let globalHandler: ((error: unknown, isFatal?: boolean) => void) | undefined = nativeCrashReport;
  return {
    nativeCrashReport,
    emit: (type: string, event: unknown) => listeners.get(type)?.forEach((listener) => listener(event)),
    crash: (error: unknown, isFatal?: boolean) => globalHandler?.(error, isFatal),
    listenerCount: (type: string) => listeners.get(type)?.length ?? 0,
    host: {
      ErrorUtils: {
        getGlobalHandler: () => globalHandler,
        setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => {
          globalHandler = handler;
        },
      },
      addEventListener: (type: string, listener: Listener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
    },
  };
}

async function installed() {
  const { installCrashHandlers } = await freshLogger();
  const world = fakeHost();
  installCrashHandlers(world.host);
  return { world, installCrashHandlers };
}

beforeEach(() => recordDiagnostic.mockClear());

describe("installCrashHandlers", () => {
  it("records an uncaught native error and still lets the app crash loudly", async () => {
    const { world } = await installed();

    const error = new Error("boom");
    world.crash(error, true);

    expect(recordDiagnostic).toHaveBeenCalledWith("crash.fatal", "error", error);
    // The red box in development and the native crash report in production
    // both hang off the handler that was already there.
    expect(world.nativeCrashReport).toHaveBeenCalledWith(error, true);
  });

  it("separates a fatal crash from one the runtime survived", async () => {
    const { world } = await installed();

    world.crash(new Error("recoverable"), false);
    expect(recordDiagnostic).toHaveBeenCalledWith("crash.uncaught", "error", expect.any(Error));
  });

  it("records a rejected promise that nothing caught", async () => {
    const { world } = await installed();

    const reason = new Error("no catch");
    world.emit("unhandledrejection", { reason });
    expect(recordDiagnostic).toHaveBeenCalledWith("crash.rejection", "error", reason);
  });

  it("falls back to the message when a web error event carries no error object", async () => {
    const { world } = await installed();

    world.emit("error", { message: "Script error." });
    expect(recordDiagnostic).toHaveBeenCalledWith("crash.uncaught", "error", "Script error.");
  });

  it("installs once, so a Fast Refresh cannot chain the handler onto itself", async () => {
    const { world, installCrashHandlers } = await installed();
    installCrashHandlers(world.host);
    installCrashHandlers(world.host);

    world.crash(new Error("once"), true);
    expect(recordDiagnostic).toHaveBeenCalledTimes(1);
    expect(world.listenerCount("error")).toBe(1);
    expect(world.listenerCount("unhandledrejection")).toBe(1);
  });

  it("still delegates when the recorder itself throws", async () => {
    const { world } = await installed();
    recordDiagnostic.mockImplementationOnce(() => {
      throw new Error("storage is gone");
    });

    const error = new Error("boom");
    expect(() => world.crash(error, true)).not.toThrow();
    expect(world.nativeCrashReport).toHaveBeenCalledWith(error, true);
  });

  it("works on a host with neither ErrorUtils nor addEventListener", async () => {
    const { installCrashHandlers } = await freshLogger();
    expect(() => installCrashHandlers({})).not.toThrow();
  });
});
