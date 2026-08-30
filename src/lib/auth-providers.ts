import "server-only";

import { isSupabaseConfigured, supabaseEnv } from "@/lib/env";

/**
 * Which social providers the Supabase project actually has switched on.
 *
 * Rendering a provider button that the project has not enabled sends the user
 * out of the app to a raw JSON error from Supabase, with no way back. Asking
 * the auth server instead means the button appears by itself once the provider
 * is turned on, with no redeploy and no env flag to keep in sync.
 *
 * Cached for five minutes: this changes about once in the life of a project.
 */
export async function enabledProviders(): Promise<{ google: boolean }> {
  if (!isSupabaseConfigured()) return { google: false };

  try {
    const { url, publishableKey } = supabaseEnv();
    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: publishableKey },
      next: { revalidate: 300 },
    });

    if (!response.ok) return { google: false };

    const settings = (await response.json()) as {
      external?: Record<string, boolean>;
    };
    return { google: settings.external?.google === true };
  } catch {
    // Never let a settings hiccup take down the login page; the email form
    // still works, and that is the path everyone has.
    return { google: false };
  }
}
