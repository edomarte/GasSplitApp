import { cancelProposal, respondToProposal } from "@/app/cars/trip-proposal-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDay, formatKm } from "@/lib/format";
import type { TripProposal } from "@/lib/trip-proposals";

/**
 * Trips waiting to be confirmed.
 *
 * Two kinds, and they read differently on purpose: one is a question put to the
 * reader, the other is a question the reader put to somebody else. Both say the
 * distance that would land on the people involved, because "confirm this trip"
 * is easy to wave through and "53 km would be charged to you" is not.
 */
export function ProposalPanel({
  carId,
  proposals,
  isOwner,
}: {
  carId: string;
  proposals: TripProposal[];
  /** Owners can withdraw anybody's, so one silent member cannot block the car. */
  isOwner: boolean;
}) {
  if (proposals.length === 0) return null;

  const forYou = proposals.filter((proposal) => proposal.waitingOnYou);
  const fromYou = proposals.filter((proposal) => !proposal.waitingOnYou);

  return (
    <>
      {forYou.length > 0 ? (
        <Card className="mt-4 border-foreground/20">
          <CardHeader>
            <CardTitle>
              {forYou.length === 1 ? "A trip to confirm" : `${forYou.length} trips to confirm`}
            </CardTitle>
            <CardDescription>
              Nothing is charged to you until you accept. Rejecting tells whoever asked.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {forYou.map((proposal) => (
              <ForYou key={proposal.id} carId={carId} proposal={proposal} />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {fromYou.length > 0 ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Waiting to be confirmed</CardTitle>
            <CardDescription>
              Not recorded yet, and the car cannot be settled until each of these is answered.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {fromYou.map((proposal) => (
              <FromYou
                key={proposal.id}
                carId={carId}
                proposal={proposal}
                isOwner={isOwner}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

/** The claim itself, in whichever of the three shapes it takes. */
function claim(proposal: TripProposal): string {
  const { proposedByName, participants } = proposal;
  const proposerOnIt = participants.some((person) => person.userId === proposal.proposedBy);
  const names = participants.map((person) => (person.isYou ? "you" : person.displayName));

  if (participants.length === 1) {
    return participants[0].isYou
      ? `${proposedByName} says you were driving.`
      : `${proposedByName} says ${names[0]} was driving.`;
  }

  if (proposerOnIt) {
    return `${proposedByName} says it was shared between ${listNames(names)}.`;
  }

  // Worth saying out loud: the person who wrote it down was not there.
  return `${proposedByName} says it was shared between ${listNames(
    names,
  )}. ${proposedByName} was not on this drive.`;
}

function Readings({ proposal }: { proposal: TripProposal }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium">
        {formatKm(proposal.distanceKm)}
        <span className="ml-2 font-normal text-muted-foreground">
          {formatKm(proposal.startKm)} → {formatKm(proposal.endKm)}
        </span>
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {formatDay(proposal.drivenOn)} · {claim(proposal)}
      </p>
      {proposal.note ? (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{proposal.note}</p>
      ) : null}
    </div>
  );
}

function ForYou({ carId, proposal }: { carId: string; proposal: TripProposal }) {
  const others = proposal.outstanding.filter((person) => !person.isYou);

  return (
    <div className="rounded-lg border p-3">
      <Readings proposal={proposal} />

      <p className="mt-2 text-sm">
        {proposal.participants.length === 1 ? (
          <>
            All <span className="font-medium">{formatKm(proposal.distanceKm)}</span> would be
            charged to you.
          </>
        ) : (
          <>
            Split {proposal.participants.length} ways, so{" "}
            <span className="font-medium">{formatKm(proposal.sharePerPerson)}</span> would be
            charged to you.
          </>
        )}
      </p>

      {others.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {listNames(others.map((person) => person.displayName))}{" "}
          {others.length === 1 ? "has" : "have"} still to confirm as well — it is recorded only
          when everybody does.
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <form action={respondToProposal}>
          <input type="hidden" name="proposalId" value={proposal.id} />
          <input type="hidden" name="carId" value={carId} />
          <input type="hidden" name="accept" value="true" />
          <Button type="submit" size="sm">
            Accept
          </Button>
        </form>
        <form action={respondToProposal}>
          <input type="hidden" name="proposalId" value={proposal.id} />
          <input type="hidden" name="carId" value={carId} />
          <input type="hidden" name="accept" value="false" />
          <Button type="submit" size="sm" variant="ghost" className="text-destructive">
            Reject
          </Button>
        </form>
      </div>
    </div>
  );
}

function FromYou({
  carId,
  proposal,
  isOwner,
}: {
  carId: string;
  proposal: TripProposal;
  isOwner: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <Readings proposal={proposal} />

      <ul className="mt-2 space-y-1">
        {proposal.participants.map((person) => (
          <li key={person.userId} className="flex items-center gap-2 text-xs">
            <span
              className={
                person.response === "accepted"
                  ? "text-foreground"
                  : "text-muted-foreground"
              }
            >
              {person.isYou ? "You" : person.displayName}
            </span>
            <span className="text-muted-foreground">
              {person.response === "accepted" ? "confirmed" : "has not answered yet"}
            </span>
          </li>
        ))}
      </ul>

      {proposal.isYours || isOwner ? (
        <form action={cancelProposal} className="mt-3">
          <input type="hidden" name="proposalId" value={proposal.id} />
          <input type="hidden" name="carId" value={carId} />
          <Button type="submit" size="sm" variant="ghost" className="text-destructive">
            {proposal.isYours ? "Withdraw" : "Withdraw for them"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
