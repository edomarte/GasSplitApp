import type { Metadata } from "next";
import Link from "next/link";

import { GoogleButton } from "@/components/auth/google-button";
import { OrSeparator } from "@/components/auth/or-separator";
import { SignupForm } from "@/components/auth/signup-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { enabledProviders } from "@/lib/auth-providers";
import { safeNextParam } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Create account" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SignupPage({ searchParams }: Props) {
  const next = safeNextParam(await searchParams);
  const { google } = await enabledProviders();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create account</CardTitle>
        <CardDescription>You will need one to join or create a car.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {google ? (
          <>
            <GoogleButton next={next} />
            <OrSeparator />
          </>
        ) : null}
        <SignupForm next={next} />
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
