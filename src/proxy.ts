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
     * Everything except Next internals and static assets. Auth routes are
     * included on purpose so sessions refresh there too.
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
