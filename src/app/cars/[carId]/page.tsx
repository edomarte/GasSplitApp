import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { MemberAvatar } from "@/components/cars/member-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCar } from "@/lib/cars";
import { formatKm } from "@/lib/format";
import { requireUser } from "@/lib/dal";

type Props = { params: Promise<{ carId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { carId } = await params;
  const car = await getCar(carId);
  return { title: car?.name ?? "Car" };
}

export default async function CarPage({ params }: Props) {
  const { carId } = await params;
  const user = await requireUser();

  // RLS turns "not a member" into "no row", so a stranger gets the same 404 as
  // a car that does not exist. That is deliberate: it does not confirm the id.
  const car = await getCar(carId);
  if (!car) notFound();

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Link
              href="/"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              ← All cars
            </Link>
            <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">{car.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Odometer at {formatKm(car.lastOdometerKm)}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={`/cars/${car.id}/members`}>Members</Link>
          </Button>
        </div>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Since the last fill</CardTitle>
            <CardDescription>
              Who has driven how far, and what each person owes at the next fill.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Logging trips arrives in the next step. Nothing to split yet.
            </p>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Sharing this car</CardTitle>
            <CardDescription>
              {car.members.length === 1
                ? "Only you so far. Invite the others to start splitting."
                : `${car.members.length} people share it.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2">
              {car.members.map((member) => (
                <li key={member.userId} className="flex items-center gap-3">
                  <MemberAvatar member={member} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {member.displayName}
                    {member.isYou ? (
                      <span className="text-muted-foreground"> (you)</span>
                    ) : null}
                  </span>
                  {member.role === "owner" ? (
                    <span className="text-xs text-muted-foreground">Owner</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <Button asChild variant="secondary" className="w-full sm:w-auto">
              <Link href={`/cars/${car.id}/members`}>Invite someone</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
