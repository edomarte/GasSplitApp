"use client";

import { useActionState } from "react";

import { signUpWithPassword, type AuthFormState } from "@/app/auth/actions";
import { FieldError, FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignupForm({ next }: { next: string }) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(signUpWithPassword, {});

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <FormMessage error={state.error} notice={state.notice} />

      <div className="space-y-2">
        <Label htmlFor="displayName">Name</Label>
        <Input
          id="displayName"
          name="displayName"
          autoComplete="name"
          placeholder="How your group will see you"
          required
        />
        <FieldError message={state.fieldErrors?.displayName} />
      </div>

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
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <FieldError message={state.fieldErrors?.password} />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>

      <SubmitButton pendingLabel="Creating account...">Create account</SubmitButton>
    </form>
  );
}
