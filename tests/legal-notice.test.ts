/**
 * The KVKK notice, held to the two things that make it real.
 *
 * A notice fails in two quiet ways, and neither shows up anywhere else. It
 * becomes unreachable — written where the people it is for cannot find it, or
 * linked from every screen except the one that collects the data. And it names
 * a rights channel nobody reads, which is worse than naming none: it converts a
 * legal obligation into an unanswered mailbox.
 *
 * So this asserts reachability from each collection point, and that the address
 * a person is told to write to is the address the feedback function delivers
 * to. Everything else in the notice is prose, and prose is reviewed by reading.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tr } from "../src/i18n/tr";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("KVKK notice", () => {
  it("names a controller and a channel, with no placeholder left in either", () => {
    expect(tr.legal.controllerName.trim().length).toBeGreaterThan(3);
    expect(tr.legal.contactEmail).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    for (const value of [tr.legal.controllerName, tr.legal.contactEmail]) {
      expect(value, "a notice shipped with a placeholder identity discloses nothing")
        .not.toMatch(/TODO|TBD|example\.com|placeholder|xxx/i);
    }
  });

  it("sends people to the mailbox that is actually read", () => {
    // `supabase/functions/send-feedback` is a Deno function and cannot import
    // from `src/`, so the two copies of this address are held together here
    // instead. Item 8 will move both; this is what makes it move both.
    const fn = read("supabase/functions/send-feedback/index.ts");
    const owner = /const OWNER_EMAIL = "([^"]+)"/.exec(fn)?.[1];
    expect(owner, "OWNER_EMAIL must stay parseable").toBeTruthy();
    expect(tr.legal.contactEmail).toBe(owner);
  });

  it("is reachable from every screen that collects something", () => {
    // Sign-up creates the account and starts the transfer; feedback sends a
    // message and a screenshot; settings is where a person goes to look.
    for (const [screen, file] of [
      ["sign-up", "src/app/(auth)/sign-in.tsx"],
      ["feedback", "src/app/feedback.tsx"],
      ["settings", "src/app/(tabs)/settings/index.tsx"],
    ] as const) {
      expect(read(file), `${screen} must link to the notice`).toContain('"/privacy"');
    }
  });

  it("is readable before an account exists", () => {
    const layout = read("src/app/_layout.tsx");
    expect(layout).toContain('<Stack.Screen name="privacy"');
    // The route file is top-level, not inside the protected `(tabs)` group.
    expect(() => read("src/app/privacy.tsx")).not.toThrow();
  });

  it("says the account is what moves the data abroad, on the screen that creates one", () => {
    expect(tr.legal.signUpNotice).toMatch(/Almanya|yurt dışı/i);
    expect(read("src/app/(auth)/sign-in.tsx")).toContain("tr.legal.signUpNotice");
  });

  it("discloses every processor the code actually talks to", () => {
    // Read from the notice rather than counted: a transfer the app performs
    // and the notice omits is the failure KVKK md.9 is about.
    const transfers = tr.legal.transfers.join(" ");
    for (const processor of ["Supabase", "Resend", "GitHub Pages", "Expo"]) {
      expect(transfers, `${processor} receives data and must be named`).toContain(processor);
    }
    expect(transfers, "the location of the main store must be stated").toMatch(/Frankfurt/);
  });

  it("gives every store the app writes to a stated end", () => {
    const retention = tr.legal.retention.join(" ");
    for (const [store, mention] of [
      ["the device database", /[Cc]ihaz/],
      ["cloud rows and documents", /[Bb]ulut/],
      ["the incident log", /180 gün/],
      ["feedback mail", /[Gg]eri bildirim/],
    ] as const) {
      expect(retention, `${store} must have a retention statement`).toMatch(mention);
    }
  });

  it("matches the retention window the database enforces", () => {
    // The policy and the delete have to be the same number, or one of them is
    // a claim. Migration 36 is the one that actually removes rows.
    const migration = read("supabase/migrations/00000000000036_diagnostic_retention.sql");
    const days = /interval '(\d+) days'/.exec(migration)?.[1];
    expect(days).toBe("180");
    expect(tr.legal.retention.join(" ")).toContain(`${days} gün`);
  });

  it("lists all eight rights KVKK md. 11 enumerates", () => {
    expect(tr.legal.rights).toHaveLength(8);
  });
});

/**
 * Apple's declaration and the KVKK notice describe the same collection.
 *
 * They are written in different languages, for different regulators, in
 * different files — and they are the same set of facts. That is exactly the
 * pair that drifts: a new thing gets collected, one of the two is updated, and
 * the other quietly becomes a false statement to somebody who is entitled to a
 * true one.
 */
describe("privacy manifest", () => {
  const app = JSON.parse(read("app.json"));
  const manifest = app.expo.ios.privacyManifests;

  it("declares no tracking, matching an app that has no analytics at all", () => {
    expect(manifest.NSPrivacyTracking).toBe(false);
    expect(manifest.NSPrivacyTrackingDomains).toEqual([]);
  });

  it("marks every collected type as linked and never as tracking", () => {
    // Every row this app writes carries the account id, so "not linked" would
    // be false for all of them; and nothing here follows anyone anywhere.
    for (const entry of manifest.NSPrivacyCollectedDataTypes) {
      expect(entry.NSPrivacyCollectedDataTypeLinked, entry.NSPrivacyCollectedDataType).toBe(true);
      expect(entry.NSPrivacyCollectedDataTypeTracking, entry.NSPrivacyCollectedDataType).toBe(false);
      expect(entry.NSPrivacyCollectedDataTypePurposes).toEqual(["NSPrivacyCollectedDataTypePurposeAppFunctionality"]);
    }
  });

  it("declares the same collection the KVKK notice describes", () => {
    const declared = new Set<string>(
      manifest.NSPrivacyCollectedDataTypes.map((e: { NSPrivacyCollectedDataType: string }) => e.NSPrivacyCollectedDataType),
    );
    const notice = tr.legal.collected.join(" ");
    // Apple's identifier on the left, the words the notice uses on the right.
    // Both sides must be present, so adding a collection to one file and not
    // the other fails here rather than in front of a regulator.
    for (const [type, described] of [
      ["NSPrivacyCollectedDataTypeEmailAddress", /e-posta/i],
      ["NSPrivacyCollectedDataTypeOtherFinancialInfo", /[Ff]inansal/],
      ["NSPrivacyCollectedDataTypePhotosorVideos", /[Ff]iş|fatura/],
      ["NSPrivacyCollectedDataTypeOtherUserContent", /[Nn]ot|[Bb]elge/],
      ["NSPrivacyCollectedDataTypeCrashData", /[Hh]ata kay/],
      ["NSPrivacyCollectedDataTypeOtherDiagnosticData", /yığın izi|hata sınıf/],
      ["NSPrivacyCollectedDataTypeCustomerSupport", /[Gg]eri bildirim/],
    ] as const) {
      expect(declared.has(type), `${type} must be declared to Apple`).toBe(true);
      expect(notice, `${type} must also be described in the notice`).toMatch(described);
    }
    expect(declared.size, "an undeclared-in-Turkish type would slip past the row above").toBe(7);
  });

  it("declares only the required-reason API this app's own binary drives", () => {
    // The six bundled libraries that touch these APIs ship their own manifests
    // and Xcode aggregates them. What is left for the app is SQLite: it stats
    // the database file inside the container, and `expo-sqlite` carries no
    // manifest of its own. `kv` uses the Keychain, which is not a
    // required-reason API — declaring UserDefaults here would be a statement
    // about a call this binary does not make.
    expect(manifest.NSPrivacyAccessedAPITypes).toEqual([
      {
        NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
        NSPrivacyAccessedAPITypeReasons: ["C617.1"],
      },
    ]);
  });
});

/**
 * The notice against the article that requires it.
 *
 * Article 10 of Law 6698 enumerates what a controller must disclose, and a
 * notice missing one of those items is not a shorter notice — it is a notice
 * that does not satisfy the article. Collection method is the one that goes
 * missing most easily, because it is the only item that is not also something
 * a product team would think to write down on its own.
 */
describe("KVKK notice against Article 10", () => {
  it("carries every item the article enumerates", () => {
    const sections: [string, string][] = [
      ["veri sorumlusunun kimliği", tr.legal.controllerTitle],
      ["işlenen veriler", tr.legal.collectedTitle],
      ["toplanma yöntemi", tr.legal.methodTitle],
      ["amaç ve hukuki sebep", tr.legal.purposeTitle],
      ["aktarılan alıcı grupları", tr.legal.transferTitle],
      ["saklama ve imha", tr.legal.retentionTitle],
      ["ilgili kişinin hakları", tr.legal.rightsTitle],
      ["başvurusuz kullanılabilecek araçlar", tr.legal.selfServiceTitle],
      ["başvuru usulü", tr.legal.contactTitle],
    ];
    for (const [item, title] of sections) {
      expect(title.trim().length, `${item} must have a section`).toBeGreaterThan(0);
    }
    // Numbered, and numbered in order: a legal text is cited by section, and a
    // section that has quietly moved makes every earlier citation wrong.
    expect(sections.map(([, title]) => title.split(".")[0])).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  });

  it("names a legal basis for every purpose, not just the purpose", () => {
    // A purpose without an article is the half of the disclosure that is easy
    // to write and the half that carries no legal weight.
    for (const purpose of tr.legal.purposes) {
      expect(purpose, `"${purpose.slice(0, 40)}…" must cite its basis`).toMatch(/Hukuki sebep: KVKK m\. 5/);
    }
  });

  it("states that collection is direct, since nothing is bought or matched", () => {
    expect(tr.legal.methodBody).toMatch(/doğrudan sizden/);
    expect(tr.legal.methodBody).toMatch(/[Üü]çüncü kişilerden veri temin edilmez/);
  });

  it("offers the way out of the transfer alongside the transfer itself", () => {
    // The app genuinely works with no account and no transfer at all. A notice
    // that lists four processors and omits that is technically complete and
    // practically misleading.
    expect(tr.legal.transferNote).toMatch(/hesap açmadan/);
    expect(tr.legal.transferNote).toMatch(/m\. 9/);
  });

  it("points at the Kurul when the controller's answer does not satisfy", () => {
    expect(tr.legal.contactBody(tr.legal.contactEmail)).toMatch(/Kişisel Verileri Koruma Kurulu/);
    expect(tr.legal.contactBody(tr.legal.contactEmail)).toMatch(/otuz gün/);
  });
});
