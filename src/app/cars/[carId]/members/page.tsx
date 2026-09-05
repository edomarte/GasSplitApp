import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { deleteCar, leaveCar, removeMember, revokeInvite } from "@/app/cars/actions";
import { AppHeader } from "@/components/app-header";
import { InvitePanel } from "@/components/cars/invite-panel";
import { MemberAvatar } from "@/components/cars/member-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCar, listPendingInvites } from "@/lib/cars";
import { requireUser } from "@/lib/dal";
import { isEmailConfigured } from "@/lib/email";
import { formatInstantAsDay } from "@/lib/format";
import { firstParam } from "@/lib/safe-redirect";
import { listPendingProposals } from "@/lib/trip-proposals";

export const metadata: Metadata = { title: "Members" };

type Props = {
  params: Promise<{ carId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MembersPage({ params, searchParams }: Props) {
  const { carId } = await params;
  const blocked = firstParam(await searchParams, "blocked");
  const user = await requireUser();

  const car = await getCar(carId);
  if (!car) notFound();

  const [invites, proposals] = await Promise.all([
    listPendingInvites(carId),
    listPendingProposals(carId),
  ]);
  const isOwner = car.yourRole === "owner";

  // Nobody walks out of an open question: their kilometres are still in
  // dispute, and the car's fills are blocked until it is answered.
  const held = new Set<string>();
  for (const proposal of proposals) {
    held.add(proposal.proposedBy);
    for (const person of proposal.participants) held.add(person.userId);
  }
  const youAreHeld = held.has(user.id);

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Link
          href={`/cars/${car.id}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← {car.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Members</h1>

        {blocked ? (
          <p className="mt-4 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
            {blocked === "leave"
              ? "You cannot leave while a trip you are involved in is waiting to be confirmed."
              : "They cannot be removed while a trip they are involved in is waiting to be confirmed."}{" "}
            Those kilometres would be left belonging to nobody.
          </p>
        ) : null}

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Sharing this car</CardTitle>
            <CardDescription>
              Everyone here can log trips and record a fill.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {car.members.map((member) => (
                <li key={member.userId} className="flex items-center gap-3 py-3 first:pt-0">
                  <MemberAvatar member={member} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {member.displayName}
                      {member.isYou ? (
                        <span className="font-normal text-muted-foreground"> (you)</span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {member.email}
                    </span>
                  </span>
                  {member.role === "owner" ? (
                    <span className="text-xs text-muted-foreground">Owner</span>
                  ) : isOwner && !member.isYou ? (
                    held.has(member.userId) ? (
                      <span className="max-w-[9rem] text-right text-xs text-muted-foreground">
                        Waiting on a trip
                      </span>
                    ) : (
                      <form action={removeMember}>
                        <input type="hidden" name="carId" value={car.id} />
                        <input type="hidden" name="userId" value={member.userId} />
                        <Button type="submit" variant="ghost" size="sm">
                          Remove
                        </Button>
                      </form>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Invite someone</CardTitle>
            <CardDescription>
              {isEmailConfigured()
                ? "Email them a link, or share the QR code."
                : "Share the QR code or link. Email delivery is not set up yet."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InvitePanel carId={car.id} />
          </CardContent>
        </Card>

        {invites.length > 0 ? (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Pending invites</CardTitle>
              <CardDescription>Not yet used. Revoke one to make its link dead.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {invites.map((invite) => (
                  <li key={invite.id} className="flex items-center gap-3 py-3 first:pt-0">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {invite.invitedEmail ?? "Shared as a link"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Expires{" "}
{formatInstantAsDay(invite.expiresAt)}
                      </span>
                    </span>
                    {invite.createdByYou || isOwner ? (
                      <form action={revokeInvite}>
                        <input type="hidden" name="inviteId" value={invite.id} />
                        <input type="hidden" name="carId" value={car.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          Revoke
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {isOwner ? (
          <form action={deleteCar} className="mt-6">
            <input type="hidden" name="carId" value={car.id} />
            <Button type="submit" variant="ghost" size="sm" className="text-destructive">
              Delete this car
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">
              Removes it for everyone, along with its trips and settlement history.
            </p>
          </form>
        ) : youAreHeld ? (
          <div className="mt-6">
            <Button variant="ghost" size="sm" className="text-destructive" disabled>
              Leave this car
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">
              A trip you are involved in is waiting to be confirmed. Answer it, or withdraw the
              one you asked for, and you can leave.
            </p>
          </div>
        ) : (
          <form action={leaveCar} className="mt-6">
            <input type="hidden" name="carId" value={car.id} />
            <Button type="submit" variant="ghost" size="sm" className="text-destructive">
              Leave this car
            </Button>
          </form>
        )}
      </main>
    </>
  );
}
