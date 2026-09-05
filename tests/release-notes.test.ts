/**
 * The changelog section a release is published from.
 *
 * The extractor is small and the two ways it can be wrong are both silent: it
 * can find the wrong section, and it can find nothing and let a release go out
 * empty. Both are checked here, and the second is the reason the script exits
 * non-zero rather than printing nothing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { notesFor } from "../scripts/release-notes.mjs";

const changelog = readFileSync("CHANGELOG.md", "utf8");

describe("release notes", () => {
  it("returns a version's own section and stops at the next one", () => {
    const notes = notesFor(changelog, "1.4.1");
    expect(notes).toBeTruthy();
    expect(notes).toContain("Expo Go");
    // The boundary that matters: the previous release's text must not be
    // appended to this one's.
    expect(notes).not.toContain("## 1.4.0");
    expect(notes).not.toMatch(/Satır vurguları kartın kenarına/);
  });

  it("does not match a version by prefix", () => {
    // `## 1.4.1` must not be found by a search for `1.4`, and a future
    // `## 1.4.10` must not be found by a search for `1.4.1`.
    expect(notesFor(changelog, "1.4")).toBeNull();
    const invented = "## 1.4.10\n\n- ten\n\n## 1.4.1\n\n- one\n";
    expect(notesFor(invented, "1.4.1")).toBe("- one");
  });

  it("returns null for a version with no section, rather than empty notes", () => {
    expect(notesFor(changelog, "9.9.9")).toBeNull();
    // And for a heading that exists but carries nothing under it, which is the
    // shape a half-written entry has.
    expect(notesFor("## 2.0.0\n\n## 1.9.9\n\n- something\n", "2.0.0")).toBeNull();
  });

  it("has a section for the version this tree ships", () => {
    // The release workflow refuses a tag whose version has no entry. Catching
    // that here means the refusal never has to happen in front of a tag that
    // has already been pushed.
    const shipped = JSON.parse(readFileSync("app.json", "utf8")).expo.version;
    expect(notesFor(changelog, shipped), `CHANGELOG.md has no section for ${shipped}`).toBeTruthy();
  });

  it("has a section for every tag that has been published", () => {
    // Every release's body is read from here, so a tag whose section was
    // renamed or removed would publish nothing on the next re-run.
    for (const version of ["1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.4.1"]) {
      expect(notesFor(changelog, version), version).toBeTruthy();
    }
  });
});
