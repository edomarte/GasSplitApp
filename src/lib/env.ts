/**
 * Environment access.
 *
 * Supabase is not wired up until the project exists, so instead of throwing at
 * import time we expose `isSupabaseConfigured` and let the UI render a setup
 * screen. Anything that actually talks to Supabase calls `supabaseEnv()`, which
 * throws a message telling you exactly what to put in `.env.local`.
 */

const URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_VAR = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

function read(name: string): string | undefined {
  // Next.js inlines `process.env.NEXT_PUBLIC_*` only for statically written
  // property accesses, so these cannot be looked up dynamically.
  const value =
    name === URL_VAR
      ? process.env.NEXT_PUBLIC_SUPABASE_URL
      : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return value && value.length > 0 ? value : undefined;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(read(URL_VAR) && read(KEY_VAR));
}

export function supabaseEnv(): { url: string; publishableKey: string } {
  const url = read(URL_VAR);
  const publishableKey = read(KEY_VAR);

  if (!url || !publishableKey) {
    const missing = [!url && URL_VAR, !publishableKey && KEY_VAR].filter(Boolean);
    throw new Error(
      `Supabase is not configured: missing ${missing.join(" and ")}. ` +
        `Copy .env.local.example to .env.local and fill in the values from ` +
        `your Supabase project (Settings -> API Keys).`,
    );
  }

  return { url, publishableKey };
}

/**
 * The public origin, with any trailing slash removed.
 *
 * Everything builds paths as `${siteUrl}/join/...`, so a value ending in a
 * slash produces `https://host//join/...`. Vercel happens to redirect that to
 * the right place, which hides the problem — but the same origin builds the
 * auth `redirectTo` URLs, and Supabase matches those against an exact
 * allowlist. `//auth/callback` is not `/auth/callback`, and sign-in would break
 * in a way that looks nothing like a stray slash.
 *
 * Normalising here rather than asking people to type it correctly, because they
 * will not, and the failure is silent.
 */
export function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function resolveSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  }
  // The project's stable production domain. VERCEL_URL is per-deployment and
  // changes every push, so an invite built from it dies on the next deploy.
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${normalizeOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL)}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${normalizeOrigin(process.env.VERCEL_URL)}`;
  }
  return "http://localhost:3000";
}

export const siteUrl: string = resolveSiteUrl();
