import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Data Access Layer.
 *
 * Every read or write that depends on who is asking goes through here, so the
 * auth check can never be forgotten at a call site. Layouts are deliberately
 * not used for auth: they do not re-render on navigation and do not gate the
 * segments below them.
 */

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
};

/** Never expose the raw Supabase user object past this boundary. */
function toSessionUser(user: {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}): SessionUser {
  const meta = user.user_metadata ?? {};
  const name =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    (typeof meta.display_name === "string" && meta.display_name) ||
    user.email?.split("@")[0] ||
    "Member";
  const avatar =
    (typeof meta.avatar_url === "string" && meta.avatar_url) ||
    (typeof meta.picture === "string" && meta.picture) ||
    null;

  return {
    id: user.id,
    email: user.email ?? "",
    displayName: name,
    avatarUrl: avatar,
  };
}

/** The signed-in user, or null. Deduped per request. */
export const getOptionalUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  // getUser() revalidates the JWT with Supabase; never trust getSession() here.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ? toSessionUser(user) : null;
});

/** The signed-in user, or redirect to /login. Use this in pages and actions. */
export const requireUser = cache(async (): Promise<SessionUser> => {
  const user = await getOptionalUser();
  if (!user) redirect("/login");
  return user;
});

/**
 * The caller's row in `public.profiles` — the name and avatar other members of
 * a car see, kept in sync with auth.users by the handle_new_user trigger.
 *
 * Returns null if the row is missing, which should not happen: the trigger
 * creates it on signup and the initial migration backfills anyone older.
 */
export const getMyProfile = cache(async () => {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;
  return data;
});
