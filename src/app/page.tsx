import Link from "next/link";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { CreateCarForm } from "@/components/cars/create-car-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listMyCars } from "@/lib/cars";
import { requireUser } from "@/lib/dal";
import { isSupabaseConfigured } from "@/lib/env";

export default async function HomePage() {
  if (!isSupabaseConfigured()) redirect("/setup");

  // Auth check lives here, not in a layout: layouts do not re-render on
  // navigation and do not gate the segments below them.
  const user = await requireUser();
  const cars = await listMyCars();

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Hi {user.displayName.split(" ")[0]}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {cars.length === 0
            ? "Create a car, then invite whoever you share it with."
            : `You share ${cars.length === 1 ? "one car" : `${cars.length} cars`}.`}
        </p>

        {cars.length > 0 ? (
          <ul className="mt-6 space-y-3">
            {cars.map((car) => (
              <li key={car.id}>
                <Link
                  href={`/cars/${car.id}`}
                  className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{car.name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {car.memberCount === 1 ? "Just you" : `${car.memberCount} people`}
                    </span>
                  </span>
                  {car.role === "owner" ? <Badge variant="secondary">Owner</Badge> : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{cars.length === 0 ? "Add your first car" : "Add another car"}</CardTitle>
            <CardDescription>
              You will be its owner, and can invite the others afterwards.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateCarForm />
          </CardContent>
        </Card>
      </main>
    </>
  );
}
