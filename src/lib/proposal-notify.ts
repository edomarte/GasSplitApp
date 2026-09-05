import "server-only";

import { siteUrl } from "@/lib/env";
import {
  sendEmail,
  tripProposalAcceptedEmail,
  tripProposalCancelledEmail,
  tripProposalEmail,
  tripProposalRejectedEmail,
  type ProposalContext,
  type ProposalPersonSummary,
} from "@/lib/email";
import { formatDay } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

/**
 * Telling people about a proposal.
 *
 * A pending one is still in the database, so the "please confirm" mail reads it
 * back — what somebody is told must be what was actually written down, not what
 * the caller believed it was about.
 *
 * A resolved one is gone by the time we get here: accepting, rejecting and
 * withdrawing all delete the row. So the database function hands back everything
 * the message needs on its way out, and that is what the outcome mails are built
 * from.
 *
 * Nothing here is allowed to fail the operation it follows. The trip, the
 * refusal or the withdrawal is already recorded, and the app itself shows the
 * state; the email is the nudge that stops somebody waiting on a car they never
 * opened.
 */

export type NotifyOutcome = {
  displayName: string;
  email: string;
  status: "sent" | "skipped" | "failed";
  detail?: string;
};

/** What the database returns as a proposal is resolved. */
export type ResolvedProposal = {
  car_id: string;
  car_name: string;
  proposed_by: string;
  start_km: number;
  end_km: number;
  distance_km: number;
  driven_on: string;
  note: string | null;
  people: string[];
};

type Person = ProposalPersonSummary & { email: string };

/**
 * The proposer first when they were on the drive, then alphabetically — the
 * same order the card on screen uses, so the two never read differently.
 */
function inReadingOrder(people: Person[], proposerId: string): Person[] {
  return [...people].sort((a, b) => {
    if ((a.userId === proposerId) !== (b.userId === proposerId)) {
      return a.userId === proposerId ? -1 : 1;
    }
    return a.displayName.localeCompare(b.displayName);
  });
}

async function deliver(
  recipients: Person[],
  build: (recipientId: string) => { subject: string; text: string; html: string },
): Promise<NotifyOutcome[]> {
  const outcomes: NotifyOutcome[] = [];

  // One address per person, whatever list they turned up on.
  const seen = new Set<string>();

  for (const person of recipients) {
    if (seen.has(person.userId)) continue;
    seen.add(person.userId);

    if (!person.email) {
      outcomes.push({
        displayName: person.displayName,
        email: "",
        status: "failed",
        detail: "no email address on file",
      });
      continue;
    }

    const result = await sendEmail({ to: person.email, ...build(person.userId) });
    outcomes.push({
      displayName: person.displayName,
      email: person.email,
      status: result.status,
      detail: result.status === "failed" ? result.reason : undefined,
    });
  }

  return outcomes;
}

/** "Please confirm this." Only to the people whose answer is outstanding. */
export async function notifyProposalRaised(proposalId: string): Promise<NotifyOutcome[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("trip_proposals")
    .select(
      `id, car_id, start_km, end_km, distance_km, driven_on, note, proposed_by,
       cars(name),
       profiles!trip_proposals_proposed_by_fkey(display_name),
       trip_proposal_participants(user_id, response, profiles(display_name, email))`,
    )
    .eq("id", proposalId)
    .maybeSingle();

  if (error || !data) {
    console.error("[proposals] could not read the proposal back", error);
    return [];
  }

  const proposer = {
    userId: data.proposed_by,
    displayName: data.profiles?.display_name ?? "Member",
  };

  const people: Person[] = (data.trip_proposal_participants ?? []).map((person) => ({
    userId: person.user_id,
    displayName: person.profiles?.display_name ?? "Member",
    email: person.profiles?.email ?? "",
  }));

  const ordered = inReadingOrder(people, proposer.userId);

  const context: ProposalContext = {
    carName: data.cars?.name ?? "your car",
    proposer,
    people: ordered.map(({ userId, displayName }) => ({ userId, displayName })),
    startKm: data.start_km,
    endKm: data.end_km,
    distanceKm: data.distance_km ?? data.end_km - data.start_km,
    drivenOn: formatDay(data.driven_on),
    note: data.note,
    url: `${siteUrl}/cars/${data.car_id}`,
  };

  const pending = ordered.filter(
    (person) =>
      (data.trip_proposal_participants ?? []).find((row) => row.user_id === person.userId)
        ?.response === "pending",
  );

  return deliver(pending, (recipientId) =>
    tripProposalEmail({
      context,
      recipientId,
      stillWaitingOn: pending
        .filter((person) => person.userId !== recipientId)
        .map(({ userId, displayName }) => ({ userId, displayName })),
    }),
  );
}

/**
 * The outcome, to everyone it concerns except whoever caused it — they were
 * looking at the screen when it happened.
 *
 * The proposer is always included. Without the accepted case they would learn
 * of a refusal by email but of an agreement not at all, which is the wrong way
 * round: the agreement is the one that puts kilometres on somebody.
 */
export async function notifyProposalResolved(
  proposal: ResolvedProposal,
  outcome: "accepted" | "rejected" | "cancelled",
  actorId: string,
): Promise<NotifyOutcome[]> {
  const supabase = await createClient();

  // Everyone who has to hear about it, including the proposer when they were
  // not on the drive themselves.
  const ids = [...new Set([...proposal.people, proposal.proposed_by])];

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, display_name, email")
    .in("id", ids);

  if (error) {
    console.error("[proposals] could not look up who to tell", error);
    return [];
  }

  const byId = new Map(
    (profiles ?? []).map((row) => [
      row.id,
      { userId: row.id, displayName: row.display_name, email: row.email },
    ]),
  );

  const unknown = (id: string): Person => ({ userId: id, displayName: "Member", email: "" });

  const proposer = byId.get(proposal.proposed_by) ?? unknown(proposal.proposed_by);
  const onTheDrive = inReadingOrder(
    proposal.people.map((id) => byId.get(id) ?? unknown(id)),
    proposer.userId,
  );

  const context: ProposalContext = {
    carName: proposal.car_name,
    proposer: { userId: proposer.userId, displayName: proposer.displayName },
    people: onTheDrive.map(({ userId, displayName }) => ({ userId, displayName })),
    startKm: proposal.start_km,
    endKm: proposal.end_km,
    distanceKm: proposal.distance_km,
    drivenOn: formatDay(proposal.driven_on),
    note: proposal.note,
    url: `${siteUrl}/cars/${proposal.car_id}`,
  };

  const everyone = [...onTheDrive];
  if (!everyone.some((person) => person.userId === proposer.userId)) everyone.push(proposer);

  if (outcome === "accepted") {
    // Nobody is left out here: the last person to accept still wants the
    // confirmation that it went through, and so does everyone else.
    return deliver(everyone, (recipientId) => tripProposalAcceptedEmail({ context, recipientId }));
  }

  const actor = everyone.find((person) => person.userId === actorId) ?? unknown(actorId);
  const others = everyone.filter((person) => person.userId !== actorId);

  if (outcome === "rejected") {
    return deliver(others, (recipientId) =>
      tripProposalRejectedEmail({
        context,
        recipientId,
        rejectedBy: { userId: actor.userId, displayName: actor.displayName },
      }),
    );
  }

  return deliver(others, (recipientId) =>
    tripProposalCancelledEmail({
      context,
      recipientId,
      cancelledBy: { userId: actor.userId, displayName: actor.displayName },
    }),
  );
}

/** Logs whatever could not be delivered. The operation itself already happened. */
export function reportNotifications(label: string, outcomes: NotifyOutcome[]): void {
  const failed = outcomes.filter((outcome) => outcome.status === "failed");
  if (failed.length > 0) {
    console.error(
      `[proposals] ${label}: could not notify ${failed
        .map((outcome) => `${outcome.displayName} (${outcome.detail ?? "unknown"})`)
        .join(", ")}`,
    );
  }
}
