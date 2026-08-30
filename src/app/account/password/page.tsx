import type { Metadata } from "next";
import Link from "next/link";

import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/dal";

export const metadata: Metadata = { title: "Change password" };

/**
 * Where a reset link lands, and where someone signed in comes to change their
 * password on purpose.
 *
 * Both arrive with a session — the reset link creates one, which is what makes
 * the change possible at all — so there is nothing to distinguish and one page
 * serves both. `requireUser` sends anyone else to sign in, which is also what
 * happens when a reset link has expired.
 */
export default async function ChangePasswordPage() {
  const user = await requireUser();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <span aria-hidden="true">⛽</span>
        <span>Gas Split</span>
      </div>
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>For {user.email}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ChangePasswordForm />
            <p className="text-center text-sm text-muted-foreground">
              <Link
                href="/"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Back to your cars
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
