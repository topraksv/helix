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
import { classifyRootRoute, resolveRootGuard } from "../src/domain/app-guard";
import { markUrl, type MarkProvider } from "../src/domain/brand-marks";
import { MARKET_DATA_HOST } from "../src/domain/market";
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
    //
    // Two mechanisms count, because reachability is the rule and the route is
    // only one way to satisfy it. The auth screen opens `LegalNoticeSheet`
    // instead of pushing: a push there costs a half-typed form, and the sheet
    // renders the same `LegalNoticeBody` the route does, so there is no second
    // copy of the text to drift.
    for (const [screen, file] of [
      ["sign-up", "src/app/(auth)/sign-in.tsx"],
      ["feedback", "src/app/feedback.tsx"],
      ["settings", "src/app/(tabs)/settings/index.tsx"],
    ] as const) {
      const source = read(file);
      const reachable = source.includes('"/privacy"') || source.includes("LegalNoticeSheet");
      expect(reachable, `${screen} must link to or open the notice`).toBe(true);
    }
  });

  /** One body, two frames. A second copy is a second thing to keep true. */
  it("shows the same text on the route and in the sheet", () => {
    const shared = read("src/ui/legal-notice.tsx");
    expect(shared).toContain("export function LegalNoticeBody");
    expect(shared).toContain("export function LegalNoticeSheet");
    expect(read("src/app/privacy.tsx")).toContain("LegalNoticeBody");
    // The route must not re-implement the notice beside the shared one.
    expect(read("src/app/privacy.tsx")).not.toContain("legal.collectedTitle");
  });

  it("is readable before an account exists", () => {
    const layout = read("src/app/_layout.tsx");
    expect(layout).toContain('<Stack.Screen name="privacy"');
    // The route file is top-level, not inside the protected `(tabs)` group.
    expect(() => read("src/app/privacy.tsx")).not.toThrow();

    // Structure alone was not enough, and this is why the assertion below
    // exists: all of the above was already true on 2026-09-03 while the route
    // classified as protected account UI, so the guard sent every signed-out
    // reader back to sign-in. The notice was unreachable for exactly the
    // audience it is written for, and nothing here said so.
    expect(classifyRootRoute(["privacy"])).toBe("public");
    expect(resolveRootGuard({
      ready: true,
      locked: false,
      userId: null,
      onboarded: null,
      frozen: null,
      awaitingFirstPull: false,
      route: "public",
    })).toEqual({ view: "stack", redirect: null });
  });

  it("says the account is what takes the data off the device, on the screen that creates one", () => {
    // The FACT is what this rule is about: creating an account is the moment
    // records stop being device-only, and it has to be said where the account
    // is created rather than only inside a document. WHERE they go is the
    // notice's job and is asserted against the code below — a one-line form
    // note that named a country said less accurately what the notice says in
    // full, in the register of a warning, on the screen a person is trying to
    // sign up from.
    expect(tr.legal.signUpNotice).toMatch(/hesap oluşturduğunda/i);
    expect(tr.legal.signUpNotice).toMatch(/cihazından çık/i);
    expect(tr.legal.signUpNotice).toContain("Aydınlatma Metni");
    expect(read("src/app/(auth)/sign-in.tsx")).toContain("tr.legal.signUpNotice");
    // And the document itself still names the transfer, in the section the
    // statute expects it in.
    expect(tr.legal.transferTitle).toMatch(/yurt dışı/i);
    expect(tr.legal.transfers.join(" ")).toMatch(/Almanya/i);
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

  /**
   * The four names above were the whole disclosure, and the app was reaching
   * NINE hosts.
   *
   * Measured in a browser on 2026-09-05: opening the app with no account at
   * all already called `open.er-api.com` and `data-api.binance.vision`, and
   * typing "Netflix" into a subscription name — before saving anything —
   * called `www.google.com/s2/favicons?domain=netflix.com`. That last one is
   * the one that matters, because the request itself is the disclosure: the
   * domain IS which bank or which service the person just named.
   *
   * A hand-written list is what let that happen, so this one is DERIVED. The
   * hosts come out of the code that builds the URLs and out of the policy that
   * has to allow them; the map below is the only hand-written part, and its
   * job is to fail when a host appears that nobody has decided about. Adding a
   * host to the CSP or to a `fetch` therefore forces a line in the notice, or
   * an explicit `null` here saying why the host is not a network contact.
   */
  const DISCLOSED_AS: Record<string, string | null> = {
    // Delivery surfaces and processors, each named in the notice.
    "topraksv.github.io": "GitHub Pages",
    "open.er-api.com": "open.er-api.com",
    "www.tcmb.gov.tr": "TCMB",
    [MARKET_DATA_HOST]: MARKET_DATA_HOST,
    "www.google.com": "Google",
    // Google's favicon endpoint 301s here, so the policy allows it and the
    // browser follows it. Same recipient, so the same name discloses it.
    "*.gstatic.com": "Google",
    "icons.duckduckgo.com": "DuckDuckGo",
    "icon.horse": "icon.horse",
    // Not a network contact: a JSON-LD `@context` is a vocabulary identifier
    // that nothing fetches. It is mapped rather than filtered so that the rule
    // stays "every host was decided about" instead of "every host we bothered
    // to look at".
    "schema.org": null,
  };

  function hostsTheCodeCanReach(): string[] {
    const found = new Set<string>();
    // The policy is the ceiling on the web build: a host that is not in it is
    // a host the browser refuses.
    for (const file of ["src/app/+html.tsx", "src/services/fx-fetch.ts"]) {
      for (const match of read(file).matchAll(/https:\/\/([A-Za-z0-9*.-]+)/g)) {
        const host = match[1]!;
        // The Supabase origin is interpolated from configuration rather than
        // written down, and it is disclosed by name already.
        if (!host.includes("${")) found.add(host);
      }
    }
    // Native has no CSP, so the mark URLs are read from the builder itself.
    for (const provider of ["google", "duckduckgo", "iconhorse"] as MarkProvider[]) {
      found.add(new URL(markUrl("example.com", provider)).hostname);
    }
    found.add(MARKET_DATA_HOST);
    return [...found].sort();
  }

  it("names every third-party host the code can reach", () => {
    const hosts = hostsTheCodeCanReach();
    // A floor, because both discovery paths are regex-shaped: a pattern that
    // stopped matching would leave this suite asserting nothing while passing.
    expect(hosts.length, "host discovery stopped finding the URLs").toBeGreaterThanOrEqual(8);
    expect(hosts, "the favicon services must be discovered, not assumed")
      .toEqual(expect.arrayContaining(["icon.horse", "icons.duckduckgo.com", "www.google.com"]));

    const undecided = hosts.filter((host) => !(host in DISCLOSED_AS));
    expect(undecided, "a host the code reaches with no decision recorded for it").toEqual([]);

    const transfers = tr.legal.transfers.join(" ");
    const undisclosed = hosts
      .map((host) => DISCLOSED_AS[host])
      .filter((name): name is string => name != null)
      .filter((name) => !transfers.includes(name));
    expect(undisclosed, "reached by the code and absent from the notice").toEqual([]);
  });

  /**
   * The escape hatch the notice offered did not exist.
   *
   * For as long as there has been a transfer section, it ended with "if you do
   * not want the transfer, use the app without an account". `resolveRootGuard`
   * says otherwise and always has: with no `userId`, every route that is not
   * the auth screen, the recovery screen or this notice redirects to sign-in.
   * The account-less workspace in `session.ts` is reached only when the build
   * carries NO Supabase configuration, which is true of exactly one artifact —
   * the E2E export, which is never deployed.
   *
   * So the guard is asserted here beside the sentence. A notice that promises
   * a way out of a transfer is making a claim about the product's front door,
   * and this is the code that owns that door.
   */
  it("does not offer an account-less route the guard refuses to open", () => {
    const signedOut = {
      ready: true,
      locked: false,
      userId: null,
      onboarded: null,
      frozen: null,
      awaitingFirstPull: false,
    } as const;
    // The product's actual answer to "can I use this without an account".
    expect(resolveRootGuard({ ...signedOut, route: "protected" }))
      .toEqual({ view: "wait", redirect: "/(auth)/sign-in" });
    expect(resolveRootGuard({ ...signedOut, route: "onboarding" }))
      .toEqual({ view: "wait", redirect: "/(auth)/sign-in" });

    // Therefore the notice may not say the opposite.
    const note = tr.legal.transferNote;
    // The offer, not the denial: "kullanabilirsiniz" is the sentence that has
    // to be gone, while "kullanılamadığı" is the sentence that replaced it.
    expect(note, "there is no account-less mode to send a reader to").not.toMatch(/hesap açmadan kullanabil/i);
    expect(note, "the old absolute claim must stay gone").not.toMatch(/hiçbir veriniz cihazınızdan çıkmaz/);
    expect(note, "a reader is owed the fact that the account is the condition of use")
      .toMatch(/hesap açmadan kullanılamadığı|hesap oluşturmamanız/i);
  });

  it("names what each recipient actually receives, not merely that it receives", () => {
    // The half of the disclosure that stops it from being a list of logos: a
    // reader can tell records from connection information, and can tell which
    // of the two goes where.
    expect(tr.legal.transferNote).toMatch(/Supabase/);
    expect(tr.legal.transferNote).toMatch(/bağlantı bilgi/i);
  });

  it("says the logo lookup happens while the name is being typed", () => {
    // `logo.tsx` resolves the domain from the name on every render, so the
    // request goes out during entry rather than on save. A person reading the
    // notice would otherwise reasonably assume an abandoned draft sent nothing.
    const marks = tr.legal.transfers.find((entry) => entry.includes("icon.horse")) ?? "";
    expect(marks, "the mark services need their own entry").not.toBe("");
    expect(marks).toMatch(/alan ad/);
    expect(marks).toMatch(/yazarken|kaydetmeden/);
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

  it("states the consequence of the transfer instead of a way around it", () => {
    // This used to require the notice to offer account-less use as the way out
    // of the transfer. The app has no such mode — see the guard assertion in
    // the suite above — so what the notice owes a reader is the honest version:
    // the account is the condition of use, and declining the transfer means
    // declining the account.
    expect(tr.legal.transferNote).toMatch(/hesap oluşturmamanız|hesap açmadan kullanılamadığı/i);
    expect(tr.legal.transferNote).toMatch(/m\. 9/);
  });

  it("points at the Kurul when the controller's answer does not satisfy", () => {
    expect(tr.legal.contactBody(tr.legal.contactEmail)).toMatch(/Kişisel Verileri Koruma Kurulu/);
    expect(tr.legal.contactBody(tr.legal.contactEmail)).toMatch(/otuz gün/);
  });
});
