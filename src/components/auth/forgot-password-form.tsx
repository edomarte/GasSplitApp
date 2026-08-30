"use client";

import { useActionState } from "react";

import { requestPasswordReset, type AuthFormState } from "@/app/auth/actions";
import { FieldError, FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<AuthFormState, FormData>(requestPasswordReset, {});

  return (
    <form action={formAction} className="space-y-4">
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

      <SubmitButton pendingLabel="Sending...">Send reset link</SubmitButton>
    </form>
  );
}
