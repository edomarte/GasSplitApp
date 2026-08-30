"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { redeemInvite } from "@/app/cars/actions";
import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";

/** Explanations for the ways a redeem can fail after the preview looked fine. */
const REASONS: Record<string, string> = {
  not_found: "That invite is no longer valid. Ask for a new link.",
  expired: "That invite has expired. Ask for a new link.",
  used: "Someone already used that invite. Ask for a new link.",
  not_signed_in: "Your session expired. Sign in and open the link again.",
  error: "Something went wrong. Try again in a moment.",
};

export function JoinButton({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  return (
    <div className="space-y-3">
      <FormMessage error={error} />
      <Button
        className="w-full"
        disabled={pending}
        onClick={() => {
          setError(undefined);
          startTransition(async () => {
            // The preview passed, but the invite could have been claimed or
            // revoked between rendering this page and pressing the button.
            const result = await redeemInvite(token);
            if (result.status === "joined" || result.status === "already_member") {
              router.replace(`/cars/${result.carId}`);
              return;
            }
            setError(REASONS[result.status] ?? REASONS.error);
          });
        }}
      >
        {pending ? "Joining..." : "Join this car"}
      </Button>
    </div>
  );
}
