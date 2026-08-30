import type { Metadata } from "next";
import Link from "next/link";

import { GoogleButton } from "@/components/auth/google-button";
import { OrSeparator } from "@/components/auth/or-separator";
import { LoginForm } from "@/components/auth/login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { enabledProviders } from "@/lib/auth-providers";
import { firstParam, safeNextParam } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const next = safeNextParam(params);
  const { google } = await enabledProviders();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Track the kilometres, split the fuel.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {google ? (
          <>
            <GoogleButton next={next} />
            <OrSeparator />
          </>
        ) : null}
        <LoginForm next={next} initialError={firstParam(params, "error")} />
        <p className="text-center text-sm text-muted-foreground">
          No account?{" "}
          <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
            Create one
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
