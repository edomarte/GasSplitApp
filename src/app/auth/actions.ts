"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { siteUrl } from "@/lib/env";
import { safeRelativePath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export type AuthFormState = {
  error?: string;
  notice?: string;
  fieldErrors?: Partial<Record<"email" | "password" | "displayName" | "confirm", string>>;
};

const emailSchema = z.string().trim().min(1, "Enter your email").email("That email looks wrong");

const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
});

const signUpSchema = z.object({
  displayName: z.string().trim().min(1, "Enter your name").max(60, "That name is too long"),
  email: emailSchema,
  password: z.string().min(8, "Use at least 8 characters"),
});

/** Turns a zod error into the flat shape the forms render. */
function fieldErrors(error: z.ZodError): AuthFormState["fieldErrors"] {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0]);
    out[key] ??= issue.message;
  }
  return out;
}

export async function signInWithPassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Telling an unconfirmed user their password is wrong sends them to reset a
    // password that was fine. This only reaches someone who already typed the
    // right one, so it gives nothing away to a stranger.
    if (error.code === "email_not_confirmed") {
      return {
        error: "Confirm your email first — check your inbox for the link we sent.",
      };
    }
    // Otherwise stay vague: do not reveal whether the address has an account.
    return { error: "Wrong email or password." };
  }

  revalidatePath("/", "layout");
  redirect(safeRelativePath(formData.get("next")));
}

export async function signUpWithPassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const { displayName, email, password } = parsed.data;
  const next = safeRelativePath(formData.get("next"));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName, full_name: displayName },
      emailRedirectTo: `${siteUrl}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    // Do not echo Supabase's message verbatim; it is written for developers and
    // can name internals.
    //
    // "User already registered" is a genuine account-enumeration leak, and it
    // undermines the deliberately vague answers on sign-in and password reset.
    // It only appears when the project has email confirmation switched OFF: with
    // confirmation on — the intended production setting — Supabase returns a
    // decoy success instead and says nothing. There is no wording that is both
    // honest and non-revealing when confirmation is off, because no email goes
    // out to point the user at, so the fix is the project setting, not copy.
    if (error.code === "user_already_exists" || /already registered/i.test(error.message)) {
      return { error: "That email cannot be used. Try signing in instead." };
    }
    if (error.code === "weak_password") {
      return { error: "That password is too weak. Try a longer one.", fieldErrors: {} };
    }
    if (error.code === "email_address_invalid") {
      return { fieldErrors: { email: "That email address was rejected." } };
    }
    return { error: "Could not create the account. Try again in a moment." };
  }

  // With email confirmation on, Supabase returns a user but no session.
  if (!data.session) {
    return { notice: `Check ${email} for a link to confirm your account.` };
  }

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  const next = safeRelativePath(formData.get("next"));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data.url) {
    redirect(`/login?error=${encodeURIComponent("Could not reach Google. Try again.")}`);
  }

  redirect(data.url);
}

export async function requestPasswordReset(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { fieldErrors: { email: parsed.error.issues[0].message } };

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${siteUrl}/auth/confirm?next=${encodeURIComponent("/account/password")}`,
  });

  // Always the same answer, whether or not the address is registered.
  return { notice: `If ${parsed.data} has an account, a reset link is on its way.` };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

const passwordSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters"),
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    message: "The two passwords do not match",
    path: ["confirm"],
  });

/**
 * Sets a new password for whoever is signed in.
 *
 * This serves both cases: someone who followed a reset link — the link signs
 * them in, which is what makes the change possible — and someone already signed
 * in who simply wants a different password. There is nothing to tell apart, so
 * there is one action rather than two.
 *
 * No current-password check, because the reset case has no current password to
 * offer. If that is ever wanted, Supabase's "Secure password change" setting is
 * the place for it, not a field here.
 */
export async function updatePassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    if (error.code === "same_password") {
      return { fieldErrors: { password: "That is already your password." } };
    }
    if (error.code === "weak_password") {
      return { fieldErrors: { password: "That password is too weak. Try a longer one." } };
    }
    // A recovery link that expired between opening it and submitting.
    if (error.code === "session_not_found" || error.status === 401) {
      return {
        error: "Your session expired. Request a new reset link and try again.",
      };
    }
    console.error("[auth] could not update password", error);
    return { error: "Could not change the password. Try again." };
  }

  revalidatePath("/", "layout");
  return { notice: "Your password has been changed." };
}
