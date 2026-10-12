import { describe, expect, it } from "vitest";
import { trustedSupabaseOrigin } from "../../src/domain/web-security";

describe("web network trust boundary", () => {
  it("pins CSP to the configured HTTPS Supabase project origin", () => {
    expect(trustedSupabaseOrigin("https://project-ref.supabase.co"))
      .toBe("https://project-ref.supabase.co");
    expect(trustedSupabaseOrigin("https://other.supabase.co/rest/v1"))
      .toBeNull();
    expect(trustedSupabaseOrigin("http://project-ref.supabase.co"))
      .toBeNull();
    expect(trustedSupabaseOrigin("https://supabase.co.attacker.example"))
      .toBeNull();
    expect(trustedSupabaseOrigin("https://user@project-ref.supabase.co"))
      .toBeNull();
  });

  it("keeps network host matching anchored to the entire hostname", () => {
    expect(trustedSupabaseOrigin("https://project.supabase.co")).toBe("https://project.supabase.co");
    expect(trustedSupabaseOrigin("https://evil-project.supabase.co.attacker.test")).toBeNull();
    expect(trustedSupabaseOrigin("https://attacker.test/project.supabase.co")).toBeNull();
  });

  it("accepts a bare project origin and rejects every extra URL component", () => {
    expect(trustedSupabaseOrigin(undefined)).toBeNull();
    expect(trustedSupabaseOrigin("not a url")).toBeNull();
    expect(trustedSupabaseOrigin("https://project.supabase.co?token=x")).toBeNull();
    expect(trustedSupabaseOrigin("https://project.supabase.co#fragment")).toBeNull();
    expect(trustedSupabaseOrigin("https://project.supabase.co:444")).toBeNull();
    expect(trustedSupabaseOrigin("https://evil.project.supabase.co")).toBeNull();
    expect(trustedSupabaseOrigin("https://project.supabase.co/")).toBe("https://project.supabase.co");
  });
});
