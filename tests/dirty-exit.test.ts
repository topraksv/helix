import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shouldBlockDirtyExit } from "../src/domain/form-state";

describe("dirty form navigation contract", () => {
  /**
   * Revealing an optional section is not an edit.
   *
   * Both money forms hide the currency row behind a "change currency" button
   * and tracked that button's own state in the draft snapshot, so opening the
   * row and leaving asked the user to discard changes they had not made — two
   * taps, nothing to lose. Disclosure state has no persisted counterpart, so it
   * can never be the thing a discard would throw away.
   */
  it.each(["src/app/transaction.tsx", "src/app/subscription-form.tsx"])(
    "%s keeps disclosure state out of the draft snapshot",
    (file) => {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      const start = source.indexOf("const draftSnapshot = JSON.stringify({");
      const snapshot = source.slice(start, source.indexOf("\n", source.indexOf("})", start)));
      expect(snapshot).not.toBe("");
      expect(snapshot).not.toContain("showCurrency");
    },
  );

  /**
   * `usePreventRemove` stays — it is what actually refuses the exit, and it is
   * the only thing the back control and the browser's own Back both go
   * through. What changed is that a dirty form no longer OFFERS the native
   * dismissal gesture.
   *
   * The original note here said `preventNativeDismiss` cancels a dirty
   * dismissal natively, so the gesture could stay available. On a device it
   * does not cancel it invisibly: the screen slides away, snaps back, and only
   * then does the confirmation appear — reported as "it leaves, comes back,
   * and then asks". A gesture that is going to be refused should not be there.
   */
  it("refuses a dirty exit before the screen moves", () => {
    const source = readFileSync(join(process.cwd(), "src/ui/dirty-exit.ts"), "utf8");
    expect(source).toContain("usePreventRemove");
    expect(source).toContain("navigation.setOptions({ gestureEnabled: !dirty || exitAllowed })");
    // Web has no dismissal gesture, and setting the option there would fight
    // the history integration.
    expect(source).toContain('if (Platform.OS === "web") return;');
  });

  // Two booleans have exactly four states; asserting three of them left the
  // fourth free. `dirty !== explicitlyAllowed` satisfies the other three rows
  // exactly and is only refuted by the clean-and-allowed one.
  it("blocks only an unapproved exit with unsaved changes", () => {
    expect(shouldBlockDirtyExit(true, false)).toBe(true);
    expect(shouldBlockDirtyExit(false, false)).toBe(false);
    expect(shouldBlockDirtyExit(true, true)).toBe(false);
    // A saved/deleted form that already called allowExit: nothing to warn about.
    expect(shouldBlockDirtyExit(false, true)).toBe(false);
  });
});
