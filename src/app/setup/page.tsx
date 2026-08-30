import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Setup" };

/** Shown until the Supabase keys exist, so `npm run dev` never crashes on a fresh clone. */
export default function SetupPage() {
  if (isSupabaseConfigured()) redirect("/");

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Finish the Supabase setup</CardTitle>
          <CardDescription>
            Sign-in needs a Supabase project. It takes about five minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              Create a project at{" "}
              <a
                className="font-medium underline underline-offset-4"
                href="https://supabase.com/dashboard"
                target="_blank"
                rel="noreferrer"
              >
                supabase.com/dashboard
              </a>
              .
            </li>
            <li>
              Copy <code className="rounded bg-muted px-1 py-0.5">.env.local.example</code> to{" "}
              <code className="rounded bg-muted px-1 py-0.5">.env.local</code> and paste in the
              Project URL and the anon/publishable key from Settings → API.
            </li>
            <li>
              In Authentication → Providers, enable <strong>Email</strong> and{" "}
              <strong>Google</strong>.
            </li>
            <li>
              In Authentication → URL Configuration, add{" "}
              <code className="rounded bg-muted px-1 py-0.5">http://localhost:3000/auth/callback</code>{" "}
              and{" "}
              <code className="rounded bg-muted px-1 py-0.5">http://localhost:3000/auth/confirm</code>{" "}
              as redirect URLs.
            </li>
            <li>Restart the dev server.</li>
          </ol>
        </CardContent>
      </Card>
    </main>
  );
}
