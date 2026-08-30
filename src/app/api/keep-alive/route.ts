import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Keeps the Supabase project awake.
 *
 * A free project pauses after roughly a week without database activity, and a
 * fuel-splitting app is used in bursts — a fortnight between fills is normal.
 * Vercel calls this daily; it makes one trivial query and does nothing else.
 *
 * Deliberately a real query rather than a page load: the session check in the
 * proxy talks to the auth server, and it is database activity that counts.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Vercel attaches this header when CRON_SECRET is set. It is optional: the
  // endpoint reads nothing and costs one query, so an open one is not a risk,
  // but honouring the secret when it exists keeps it from being trivially
  // hammered.
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    // Logged as an error on purpose. If the scheduler ever stops sending the
    // right token, this endpoint goes quiet and the project pauses a week later
    // — a delay long enough that nobody connects the two. An error in the logs
    // is the only warning there will be.
    console.error(
      "[keep-alive] rejected a call with a missing or wrong token; if this is " +
        "the scheduler, the project will pause once the week runs out",
    );
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });
  }

  const started = Date.now();

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("health");

    if (error) {
      console.error("[keep-alive] database did not answer", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
    }

    return NextResponse.json({
      ok: true,
      database: data,
      tookMs: Date.now() - started,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.error("[keep-alive] failed", reason);
    return NextResponse.json({ ok: false, error: reason }, { status: 503 });
  }
}
