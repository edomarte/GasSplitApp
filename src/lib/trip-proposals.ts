import "server-only";

import { requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * Trips somebody is waiting to have confirmed.
 *
 * Only pending ones are ever read. A resolved proposal is history: the people
 * involved were emailed the outcome, and an accepted one is now an ordinary
 * trip in the list below it.
 *
 * One query for the whole card, because this runs on the most-visited page in
 * the app and the free tier is what it is. The partial index on
 * (car_id) where status = 'pending' is what keeps it cheap.
 */

export type ProposalResponse = "pending" | "accepted" | "rejected";

export type ProposalPerson = {
  userId: string;
  displayName: string;
  isYou: boolean;
  response: ProposalResponse;
};

export type TripProposal = {
  id: string;
  startKm: number;
  endKm: number;
  distanceKm: number;
  drivenOn: string;
  note: string | null;
  proposedBy: string;
  proposedByName: string;
  /** You raised this one. */
  isYours: boolean;
  /** You are on the drive being described. */
  youAreOnIt: boolean;
  /** It is your answer that is outstanding. */
  waitingOnYou: boolean;
  participants: ProposalPerson[];
  /** Still to answer, in the order they will be shown. */
  outstanding: ProposalPerson[];
  /** Distance each person on the drive would carry. */
  sharePerPerson: number;
};

export async function listPendingProposals(carId: string): Promise<TripProposal[]> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("trip_proposals")
    .select(
      `id, start_km, end_km, distance_km, driven_on, note, proposed_by,
       profiles!trip_proposals_proposed_by_fkey(display_name),
       trip_proposal_participants(user_id, response, profiles(display_name))`,
    )
    .eq("car_id", carId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const participants: ProposalPerson[] = (row.trip_proposal_participants ?? []).map((person) => ({
      userId: person.user_id,
      displayName: person.profiles?.display_name ?? "Member",
      isYou: person.user_id === user.id,
      response: person.response as ProposalResponse,
    }));

    // You first when you are on it — the card is about your answer — then
    // alphabetically, so the order does not shuffle between renders.
    participants.sort((a, b) => {
      if (a.isYou !== b.isYou) return a.isYou ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });

    const distance = row.distance_km ?? row.end_km - row.start_km;
    const you = participants.find((person) => person.isYou);
    const outstanding = participants.filter((person) => person.response === "pending");

    return {
      id: row.id,
      startKm: row.start_km,
      endKm: row.end_km,
      distanceKm: distance,
      drivenOn: row.driven_on,
      note: row.note,
      proposedBy: row.proposed_by,
      proposedByName: row.profiles?.display_name ?? "Member",
      isYours: row.proposed_by === user.id,
      youAreOnIt: Boolean(you),
      waitingOnYou: you?.response === "pending",
      participants,
      outstanding,
      sharePerPerson: participants.length > 0 ? distance / participants.length : 0,
    };
  });
}
