import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyProfile, requireUser } from "@/lib/dal";
import { isSupabaseConfigured } from "@/lib/env";

export default async function HomePage() {
  if (!isSupabaseConfigured()) redirect("/setup");

  // Auth check lives here, not in a layout: layouts do not re-render on
  // navigation and do not gate the segments below them.
  const user = await requireUser();
  const profile = await getMyProfile();

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Hi {user.displayName.split(" ")[0]}
        </h1>
        <p className="mt-1 text-muted-foreground">Signed in as {user.email}.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {profile
            ? `Your group sees you as "${profile.display_name}".`
            : "No profile row found — the signup trigger did not run."}
        </p>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Your cars</CardTitle>
            <CardDescription>
              Creating and joining cars arrives with the next step. Auth is done.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Nothing here yet.</p>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
