"use client";

import Link from "next/link";
import { useActionState } from "react";

import { updatePassword, type AuthFormState } from "@/app/auth/actions";
import { FieldError, FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ChangePasswordForm() {
  const [state, formAction] = useActionState<AuthFormState, FormData>(updatePassword, {});

  // Once it is changed there is nothing left to do on this page, and leaving
  // the filled form up invites a second, pointless submission.
  if (state.notice) {
    return (
      <div className="space-y-4">
        <FormMessage notice={state.notice} />
        <Button asChild className="w-full">
          <Link href="/">Go to your cars</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage error={state.error} />

      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          autoFocus
        />
        <FieldError message={state.fieldErrors?.password} />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm">Repeat it</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <FieldError message={state.fieldErrors?.confirm} />
      </div>

      <SubmitButton pendingLabel="Saving...">Change password</SubmitButton>
    </form>
  );
}
