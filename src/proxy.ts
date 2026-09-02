import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseConfigured } from "@/lib/env";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next 16 renamed Middleware to Proxy. Runs on the Node.js runtime.
 * Keep this cookie-only: it runs on every request, including prefetches.
 */
export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    // Nothing to protect yet — let the setup screen explain what is missing.
    return NextResponse.next({ request });
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals, static assets, and the scheduled health
     * check. Auth routes stay in on purpose, so sessions refresh there too.
     *
     * The health check is excluded rather than merely allowed: the proxy calls
     * getUser() before it knows whether a route is public, so leaving it in
     * would spend a Supabase auth round trip every day authenticating a request
     * that has no session and wants nothing but the time.
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|api/keep-alive|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
