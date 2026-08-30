import "server-only";

import { requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * Trips and the open-period figures the dashboard shows.
 *
 * The numbers here are for display. Settlement recomputes them from the same
 * rows in exact integer arithmetic, because a third of a kilometre cannot be
 * held in a decimal and rounding must happen once, on the money.
 */

export type TripParticipant = {
  userId: string;
  displayName: string;
  isYou: boolean;
};

export type Trip = {
  id: string;
  startKm: number;
  endKm: number;
  distanceKm: number;
  drivenOn: string;
  note: string | null;
  recordedBy: string;
  recordedByName: string;
  isYours: boolean;
  participants: TripParticipant[];
  /** Distance charged to each participant, as an exact fraction of the trip. */
  sharePerPerson: number;
};

export type MemberKm = {
  userId: string;
  displayName: string;
  isYou: boolean;
  km: number;
  /** Fraction of the period's total, 0–1. Zero when nobody has driven. */
  share: number;
};

export type OpenPeriod = {
  totalKm: number;
  perMember: MemberKm[];
};

/** Trips in the open period, newest drive first. */
export async function listOpenTrips(carId: string): Promise<Trip[]> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("trips")
    .select(
      `id, start_km, end_km, distance_km, driven_on, note, recorded_by,
       profiles!trips_recorded_by_fkey(display_name),
       trip_shares(user_id, profiles(display_name))`,
    )
    .eq("car_id", carId)
    .is("fill_id", null)
    .order("driven_on", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const participants: TripParticipant[] = (row.trip_shares ?? []).map((share) => ({
      userId: share.user_id,
      displayName: share.profiles?.display_name ?? "Member",
      isYou: share.user_id === user.id,
    }));
    participants.sort((a, b) => a.displayName.localeCompare(b.displayName));

    const distance = row.distance_km ?? row.end_km - row.start_km;

    return {
      id: row.id,
      startKm: row.start_km,
      endKm: row.end_km,
      distanceKm: distance,
      drivenOn: row.driven_on,
      note: row.note,
      recordedBy: row.recorded_by,
      recordedByName: row.profiles?.display_name ?? "Member",
      isYours: row.recorded_by === user.id,
      participants,
      sharePerPerson: participants.length > 0 ? distance / participants.length : 0,
    };
  });
}

/**
 * Kilometres per member since the last fill.
 *
 * Members who have not driven are included with zero. Leaving them out would
 * make the dashboard look like the group is smaller than it is, and they are
 * about to owe nothing — which is worth showing, not hiding.
 */
export async function getOpenPeriod(
  carId: string,
  members: { userId: string; displayName: string; isYou: boolean }[],
): Promise<OpenPeriod> {
  const supabase = await createClient();

  // Only km is read from the view. Its trip_count is per member, so a trip
  // split three ways appears in three rows; summing those counts it three
  // times. The number of trips is the length of the trip list, not a total.
  const { data, error } = await supabase
    .from("open_period_km")
    .select("user_id, km")
    .eq("car_id", carId);

  if (error) throw error;

  const driven = new Map<string, number>();
  for (const row of data ?? []) {
    if (row.user_id) driven.set(row.user_id, Number(row.km ?? 0));
  }

  const totalKm = [...driven.values()].reduce((sum, km) => sum + km, 0);

  const perMember: MemberKm[] = members
    .map((member) => {
      const km = driven.get(member.userId) ?? 0;
      return {
        userId: member.userId,
        displayName: member.displayName,
        isYou: member.isYou,
        km,
        share: totalKm > 0 ? km / totalKm : 0,
      };
    })
    .sort((a, b) => b.km - a.km || a.displayName.localeCompare(b.displayName));

  return { totalKm, perMember };
}
