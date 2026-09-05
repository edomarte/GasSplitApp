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
 * Read back from the database rather than passed in from the action, for the
 * same reason the settlement email is: what somebody is told must be what was
 * actually written down, not what the caller believed it was about.
 *
 * Nothing here is allowed to fail the operation it follows. The proposal, the
 * response or the withdrawal is already recorded, and the app itself shows the
 * state; the email is the nudge that stops somebody waiting on a car they never
 * opened.
 */

export type NotifyOutcome = {
  displayName: string;
  email: string;
  status: "sent" | "skipped" | "failed";
  detail?: string;
};

type Loaded = {
  context: ProposalContext;
  carId: string;
  status: string;
  /** Everyone on the drive, with an address to reach them at. */
  people: (ProposalPersonSummary & { email: string; response: string })[];
  proposer: ProposalPersonSummary & { email: string };
};

async function load(proposalId: string): Promise<Loaded | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("trip_proposals")
    .select(
      `id, car_id, start_km, end_km, distance_km, driven_on, note, proposed_by, status,
       cars(name),
       profiles!trip_proposals_proposed_by_fkey(display_name, email),
       trip_proposal_participants(user_id, response, profiles(display_name, email))`,
    )
    .eq("id", proposalId)
    .maybeSingle();

  if (error || !data) {
    console.error("[proposals] could not read the proposal back", error);
    return null;
  }

  const proposer = {
    userId: data.proposed_by,
    displayName: data.profiles?.display_name ?? "Member",
    email: data.profiles?.email ?? "",
  };

  const people = (data.trip_proposal_participants ?? []).map((person) => ({
    userId: person.user_id,
    displayName: person.profiles?.display_name ?? "Member",
    email: person.profiles?.email ?? "",
    response: person.response,
  }));

  // The proposer first when they are on the drive, then alphabetically — the
  // same order the card on screen uses, so the two do not read differently.
  people.sort((a, b) => {
    if ((a.userId === proposer.userId) !== (b.userId === proposer.userId)) {
      return a.userId === proposer.userId ? -1 : 1;
    }
    return a.displayName.localeCompare(b.displayName);
  });

  return {
    carId: data.car_id,
    status: data.status,
    proposer,
    people,
    context: {
      carName: data.cars?.name ?? "your car",
      proposer: { userId: proposer.userId, displayName: proposer.displayName },
      people: people.map((person) => ({
        userId: person.userId,
        displayName: person.displayName,
      })),
      startKm: data.start_km,
      endKm: data.end_km,
      distanceKm: data.distance_km ?? data.end_km - data.start_km,
      drivenOn: formatDay(data.driven_on),
      note: data.note,
      url: `${siteUrl}/cars/${data.car_id}`,
    },
  };
}

async function deliver(
  recipients: { userId: string; displayName: string; email: string }[],
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
  const loaded = await load(proposalId);
  if (!loaded) return [];

  const pending = loaded.people.filter((person) => person.response === "pending");

  return deliver(pending, (recipientId) =>
    tripProposalEmail({
      context: loaded.context,
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
  proposalId: string,
  outcome: "accepted" | "rejected" | "cancelled",
  actorId: string,
): Promise<NotifyOutcome[]> {
  const loaded = await load(proposalId);
  if (!loaded) return [];

  const everyone = [
    ...loaded.people,
    { ...loaded.proposer, response: "accepted" as const },
  ];

  if (outcome === "accepted") {
    // Nobody is left out here: the last person to accept still wants the
    // confirmation that it went through, and so does everyone else.
    return deliver(everyone, (recipientId) =>
      tripProposalAcceptedEmail({ context: loaded.context, recipientId }),
    );
  }

  const actor = everyone.find((person) => person.userId === actorId) ?? {
    userId: actorId,
    displayName: "Somebody",
    email: "",
  };
  const others = everyone.filter((person) => person.userId !== actorId);

  if (outcome === "rejected") {
    return deliver(others, (recipientId) =>
      tripProposalRejectedEmail({
        context: loaded.context,
        recipientId,
        rejectedBy: { userId: actor.userId, displayName: actor.displayName },
      }),
    );
  }

  return deliver(others, (recipientId) =>
    tripProposalCancelledEmail({
      context: loaded.context,
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
