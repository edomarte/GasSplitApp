import { createBrowserClient } from "@supabase/ssr";

import { supabaseEnv } from "@/lib/env";

/** Supabase client for Client Components. Reads the session from cookies. */
export function createClient() {
  const { url, publishableKey } = supabaseEnv();
  return createBrowserClient(url, publishableKey);
}
