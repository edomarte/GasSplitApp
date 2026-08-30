import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { JoinButton } from "@/components/cars/join-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getOptionalUser } from "@/lib/dal";
import { isSupabaseConfigured } from "@/lib/env";
import { hashInviteToken } from "@/lib/invite-token";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Join a car" };

type Props = { params: Promise<{ token: string }> };

type Preview =
  | {
      status: "ok";
      car_id: string;
      car_name: string;
      invited_by: string;
      already_member: boolean;
    }
  | { status: "not_found" | "used" | "expired" };

export default async function JoinPage({ params }: Props) {
  if (!isSupabaseConfigured()) redirect("/setup");

  const { token } = await params;
  const user = await getOptionalUser();

  // Signing in has to come first: redeeming needs to know who is joining. The
  // token stays in the return path so they land back here afterwards.
  if (!user) {
    const next = encodeURIComponent(`/join/${encodeURIComponent(token)}`);
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle>You have been invited</CardTitle>
            <CardDescription>
              Sign in or create an account to join the car.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button asChild className="w-full">
              <Link href={`/login?next=${next}`}>Sign in</Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href={`/signup?next=${next}`}>Create an account</Link>
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invite_preview", {
    p_token_hash: hashInviteToken(token),
  });

  if (error) {
    console.error("[invites] preview failed", error);
    return (
      <Shell>
        <Problem
          title="Something went wrong"
          detail="We could not check that invite. Try the link again in a moment."
        />
      </Shell>
    );
  }

  const preview = data as Preview;

  if (preview.status !== "ok") {
    return (
      <Shell>
        <Problem {...explain(preview.status)} />
      </Shell>
    );
  }

  if (preview.already_member) {
    redirect(`/cars/${preview.car_id}`);
  }

  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle>Join &ldquo;{preview.car_name}&rdquo;</CardTitle>
          <CardDescription>
            {preview.invited_by} invited you to share this car and split its fuel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <JoinButton token={token} />
        </CardContent>
      </Card>
    </Shell>
  );
}

function explain(status: "not_found" | "used" | "expired") {
  switch (status) {
    case "used":
      return {
        title: "That invite has been used",
        detail: "Invites work once. Ask whoever sent it for a fresh link.",
      };
    case "expired":
      return {
        title: "That invite has expired",
        detail: "Invites last seven days. Ask whoever sent it for a fresh link.",
      };
    default:
      return {
        title: "That invite is not valid",
        detail: "Check you copied the whole link, or ask for a new one.",
      };
  }
}

function Problem({ title, detail }: { title: string; detail: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{detail}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" className="w-full">
          <Link href="/">Go to your cars</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <span aria-hidden="true">⛽</span>
        <span>Gas Split</span>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
