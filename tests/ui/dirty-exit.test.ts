import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { shouldBlockDirtyExit } from "../../src/domain/form-state";
import { sourceFiles } from "../source-corpus";

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
      // The snapshot is the form's fields minus what a save does not write, taken
      // apart in one destructuring whose rest is what `useDraftDirty` reads.
      const split = /const \{([^}]*?)\.\.\.(\w+) \} = \w+;/.exec(source);
      expect(split, "the draft is the fields with the disclosure state taken out").not.toBeNull();
      const [, omitted, rest] = split!;
      expect(omitted).toContain("showCurrency");
      expect(source).toMatch(new RegExp(`useDraftDirty\\(JSON\\.stringify\\((\\{ \\.\\.\\.)?${rest}\\b`));
    },
  );

  /**
   * Which screens must hold the guard, rather than which two happen to.
   *
   * Five form routes were written over three releases without one — the
   * statement review, both investment forms, the product form and the card
   * payment panel — and nothing in the suite could see it, because the only
   * assertion here named two files by hand. A reviewed statement was twenty
   * rows of work that one press on the back control threw away in silence.
   *
   * The predicate is "renders a field the owner types into", which is what a
   * lost draft is made of. The exemptions are listed rather than filtered out,
   * so exempting a sixth screen is a decision someone has to write down.
   */
  it("every route that takes typed input either guards its draft or says why not", () => {
    const INPUTS = /<(Field|MoneyField|DateField|MonthDayField|CardCycleFields)\b/;
    const exempt = [
      // Tab ROOTS, not pushed forms. `usePreventRemove` fires on a stack
      // removal, and switching tabs is not one — a guard here would not run,
      // and a tab that asks before letting go would be wrong if it did.
      "src/app/(tabs)/cash-flow/analytics.tsx",
      "src/app/(tabs)/settings/index.tsx",
      // Credentials, not a draft. Nothing typed here is persisted, and
      // blocking the way out of a sign-in screen is how an account gets stuck.
      "src/app/(auth)/reset-password.tsx",
      "src/app/(auth)/sign-in.tsx",
      // A destructive form: leaving loses nothing, because nothing is written
      // until the confirmation. "Discard changes?" on a screen whose whole
      // purpose is discarding would be asking the question twice.
      "src/app/data-reset.tsx",
    ];
    const unguarded = sourceFiles("src/app", { extensions: [".tsx"], atLeast: 40 })
      .filter((file) => {
        const source = readFileSync(join(process.cwd(), file), "utf8");
        return INPUTS.test(source) && !source.includes("useDirtyExitGuard");
      })
      .map((file) => file.split(sep).join("/"))
      .sort();
    expect(unguarded).toEqual([...exempt].sort());
  });

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
