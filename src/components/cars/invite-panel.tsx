"use client";

/* eslint-disable @next/next/no-img-element -- the QR is a generated data URI */

import { useActionState, useState } from "react";

import { createInvite, type InviteState } from "@/app/cars/actions";
import { FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatInstantAsDay } from "@/lib/format";

export function InvitePanel({ carId }: { carId: string }) {
  const [state, formAction] = useActionState<InviteState, FormData>(createInvite, {});

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="carId" value={carId} />

        <FormMessage error={state.error} />

        <div className="space-y-2">
          <Label htmlFor="email">Their email (optional)</Label>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            placeholder="them@example.com"
          />
          <p className="text-xs text-muted-foreground">
            Leave it empty to just get a QR code and a link to share yourself.
          </p>
        </div>

        <SubmitButton pendingLabel="Creating invite...">Create invite</SubmitButton>
      </form>

      {state.invite ? <InviteResult invite={state.invite} /> : null}
    </div>
  );
}

function InviteResult({ invite }: { invite: NonNullable<InviteState["invite"]> }) {
  return (
    <div className="space-y-4 rounded-lg border bg-muted/40 p-4">
      <EmailOutcome email={invite.email} />

      <div className="flex flex-col items-center gap-3">
        <img
          src={invite.qrDataUrl}
          alt="QR code linking to the invite"
          className="size-48 rounded-md bg-white p-2"
          width={192}
          height={192}
        />
        <p className="text-center text-xs text-muted-foreground">
          Let them scan this, or send the link below.
        </p>
      </div>

      <CopyableLink url={invite.url} />

      <p className="text-xs text-muted-foreground">
        Works once, and expires on{" "}
{formatInstantAsDay(invite.expiresAt)}
        . Anyone with the link can join, so share it directly.
      </p>
    </div>
  );
}

function EmailOutcome({ email }: { email: NonNullable<InviteState["invite"]>["email"] }) {
  if (!email) return null;

  if (email.status === "sent") {
    return (
      <p className="rounded-md bg-background px-3 py-2 text-sm">
        Invite emailed to <span className="font-medium">{email.to}</span>.
      </p>
    );
  }

  // Never let an undelivered invite look delivered.
  return (
    <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {email.status === "skipped"
        ? `Email is not set up yet, so nothing was sent to ${email.to}. The invite below still works — share it yourself.`
        : `Could not email ${email.to}${email.detail ? ` (${email.detail})` : ""}. The invite below still works — share it yourself.`}
    </p>
  );
}

function CopyableLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex gap-2">
      <Input readOnly value={url} className="font-mono text-xs" aria-label="Invite link" />
      <Button
        type="button"
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // Clipboard access can be refused; the field is selectable anyway.
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
