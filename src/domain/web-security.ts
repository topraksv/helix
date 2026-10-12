/** Return the one HTTPS Supabase origin this build is allowed to contact. */
export function trustedSupabaseOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const plain = !url.username && !url.password && !url.port && url.pathname === "/" && !url.search && !url.hash;
    return url.protocol === "https:" && plain && /^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname) ? url.origin : null;
  } catch {
    return null;
  }
}
