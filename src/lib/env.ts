/**
 * Environment access.
 *
 * Supabase is not wired up until the project exists, so instead of throwing at
 * import time we expose `isSupabaseConfigured` and let the UI render a setup
 * screen. Anything that actually talks to Supabase calls `supabaseEnv()`, which
 * throws a message telling you exactly what to put in `.env.local`.
 */

const URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_VAR = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

function read(name: string): string | undefined {
  // Next.js inlines `process.env.NEXT_PUBLIC_*` only for statically written
  // property accesses, so these cannot be looked up dynamically.
  const value =
    name === URL_VAR
      ? process.env.NEXT_PUBLIC_SUPABASE_URL
      : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return value && value.length > 0 ? value : undefined;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(read(URL_VAR) && read(KEY_VAR));
}

export function supabaseEnv(): { url: string; anonKey: string } {
  const url = read(URL_VAR);
  const anonKey = read(KEY_VAR);

  if (!url || !anonKey) {
    const missing = [!url && URL_VAR, !anonKey && KEY_VAR].filter(Boolean);
    throw new Error(
      `Supabase is not configured: missing ${missing.join(" and ")}. ` +
        `Copy .env.local.example to .env.local and fill in the values from ` +
        `your Supabase project (Settings -> API).`,
    );
  }

  return { url, anonKey };
}

export const siteUrl: string =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
