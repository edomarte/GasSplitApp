import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { safeNextFromSearch } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Target of emailed links: signup confirmation, password recovery, email change.
 *
 * Supabase can send two different shapes here and which one you get depends on
 * the email template, so this handles both:
 *
 *   ?token_hash=...&type=...  the template uses {{ .TokenHash }}, and the link
 *                             works from any device
 *   ?code=...                 the default template, which routes through the
 *                             Supabase verify endpoint and comes back as a PKCE
 *                             code. That code can only be exchanged in the
 *                             browser that started the flow, because the
 *                             matching verifier is in a cookie there.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = safeNextFromSearch(searchParams);

  const failure = (message: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`);

  // Supabase reports a rejected link by redirecting here with an error.
  const emailedError = searchParams.get("error_description") ?? searchParams.get("error");
  if (emailedError && !tokenHash && !code) {
    return failure(emailedError);
  }

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return failure("That link has expired. Request a new one.");
    return NextResponse.redirect(`${origin}${next}`);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return failure(
        "That link could not be confirmed here. Open it in the browser you signed up from, or request a new one.",
      );
    }
    return NextResponse.redirect(`${origin}${next}`);
  }

  return failure("That link is incomplete. Request a new one.");
}
