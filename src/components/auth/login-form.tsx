"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signInWithPassword, type AuthFormState } from "@/app/auth/actions";
import { FieldError, FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(signInWithPassword, {
    error: initialError,
  });

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <FormMessage error={state.error} notice={state.notice} />

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          required
        />
        <FieldError message={state.fieldErrors?.email} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Forgot?
          </Link>
        </div>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
        <FieldError message={state.fieldErrors?.password} />
      </div>

      <SubmitButton pendingLabel="Signing in...">Sign in</SubmitButton>
    </form>
  );
}
