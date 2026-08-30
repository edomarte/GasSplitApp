import { NextResponse, type NextRequest } from "next/server";

import { safeNextFromSearch } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/** OAuth (Google) redirect target: swaps the one-time code for a session. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextFromSearch(searchParams);

  if (!code) {
    const reason = searchParams.get("error_description") ?? "Sign-in was cancelled.";
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
