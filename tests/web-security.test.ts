import { describe, expect, it } from "vitest";
import { trustedSupabaseOrigin } from "../src/domain/web-security";

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
});
