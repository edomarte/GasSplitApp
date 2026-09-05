"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/dal";
import { notifyProposalRaised, type NotifyOutcome } from "@/lib/proposal-notify";
import { createClient } from "@/lib/supabase/server";

export type TripFormState = {
  error?: string;
  fieldErrors?: Partial<Record<"startKm" | "endKm" | "drivenOn", string>>;
  /** Set on success so the dialog knows to close itself. */
  savedAt?: number;
  /**
   * Set instead of `savedAt` when the drive involves somebody else, so nothing
   * has been recorded yet — only asked. The dialog shows this rather than
   * closing, because "saved" would be a lie.
   */
  proposed?: {
    distanceKm: number;
    ways: number;
    asked: NotifyOutcome[];
  };
};

const tripSchema = z
  .object({
    carId: z.string().uuid(),
    tripId: z.union([z.literal(""), z.string().uuid()]),
    startKm: z.number().int("Whole kilometres only").min(0, "That cannot be negative"),
    endKm: z.number().int("Whole kilometres only").min(0, "That cannot be negative"),
    drivenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
    participants: z.array(z.string().uuid()),
    /** Everyone on the drive, when adding. Empty means "just me". */
    people: z.array(z.string().uuid()),
    note: z.string().trim().max(200, "That note is too long"),
  })
  .refine((value) => value.endKm > value.startKm, {
    message: "The end reading must be higher than the start",
    path: ["endKm"],
  });

/** Turns a status from the database function into something a person can act on. */
const MESSAGES: Record<string, string> = {
  not_member: "You are not a member of this car.",
  not_signed_in: "Your session expired. Sign in and try again.",
  bad_distance: "The end reading must be higher than the start.",
  future_date: "That date is in the future.",
  not_all_members: "You can only share a drive with people in this car.",
  not_found: "That trip no longer exists.",
  not_yours: "You can only edit trips you recorded.",
  settled: "That trip is part of a settled fill and can no longer be changed.",
  not_allowed: "You are not allowed to change that trip.",
  from_proposal:
    "This trip was confirmed by everyone on it, so it can no longer be changed. Delete it and ask again.",
  needs_confirmation:
    "A drive involving somebody else has to be confirmed by them. Ask them from the trip form instead.",
  no_one_to_ask: "Pick at least one other person, or record the trip as your own.",
  duplicate: "That has already been sent, and is waiting to be confirmed.",
};

function readNumber(formData: FormData, key: string): number {
  const raw = String(formData.get(key) ?? "").trim();
  return raw === "" ? Number.NaN : Number(raw);
}

export async function saveTrip(
  _prev: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  const user = await requireUser();

  const parsed = tripSchema.safeParse({
    carId: formData.get("carId"),
    tripId: formData.get("tripId") ?? "",
    startKm: readNumber(formData, "startKm"),
    endKm: readNumber(formData, "endKm"),
    drivenOn: String(formData.get("drivenOn") ?? ""),
    participants: formData.getAll("participants").map(String),
    people: formData.getAll("people").map(String),
    note: String(formData.get("note") ?? ""),
  });

  if (!parsed.success) {
    const fieldErrors: TripFormState["fieldErrors"] = {};
    let formError: string | undefined;
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      if (key === "startKm" || key === "endKm" || key === "drivenOn") {
        fieldErrors[key] ??= issue.message;
      } else {
        formError ??= issue.message;
      }
    }
    return { fieldErrors, error: formError };
  }

  const { carId, tripId, startKm, endKm, drivenOn, participants, people, note } = parsed.data;
  const supabase = await createClient();

  // Anyone on the drive who is not the person filling the form. Their agreement
  // is what turns this into a proposal rather than a trip: nobody is charged
  // for kilometres they did not write down and have not confirmed.
  const involvesOthers = !tripId && people.some((id) => id !== user.id);

  if (involvesOthers) {
    const { data, error } = await supabase.rpc("propose_trip", {
      p_car_id: carId,
      p_start_km: startKm,
      p_end_km: endKm,
      p_driven_on: drivenOn,
      p_participants: people,
      p_note: note,
    });

    if (error) {
      console.error("[trips] could not propose trip", error);
      return { error: "Could not send the request. Try again." };
    }

    const result = data as { status: string; proposal_id?: string };
    if (result.status !== "ok") {
      return { error: MESSAGES[result.status] ?? "Could not send the request." };
    }

    const asked = await notifyProposalRaised(result.proposal_id!);

    // Deliberately no revalidatePath. The dialog renders what comes back from
    // here, and refreshing the route would remount it and throw the result
    // away — which is how the settlement dialog silently failed once already.
    return {
      proposed: { distanceKm: endKm - startKm, ways: people.length, asked },
    };
  }

  // One database call, because the trip and its participants have to be written
  // in the same transaction — see the comment on add_trip.
  const { data, error } = tripId
    ? await supabase.rpc("update_trip", {
        p_trip_id: tripId,
        p_start_km: startKm,
        p_end_km: endKm,
        p_driven_on: drivenOn,
        p_participants: participants,
        p_note: note,
      })
    : await supabase.rpc("add_trip", {
        p_car_id: carId,
        p_start_km: startKm,
        p_end_km: endKm,
        p_driven_on: drivenOn,
        p_participants: participants,
        p_note: note,
      });

  if (error) {
    console.error("[trips] could not save trip", error);
    return { error: "Could not save the trip. Try again." };
  }

  const result = data as { status: string };
  if (result.status !== "ok") {
    return { error: MESSAGES[result.status] ?? "Could not save the trip." };
  }

  revalidatePath(`/cars/${carId}`);
  return { savedAt: Date.now() };
}

export async function deleteTrip(formData: FormData): Promise<void> {
  await requireUser();
  const tripId = String(formData.get("tripId") ?? "");
  const carId = String(formData.get("carId") ?? "");

  const supabase = await createClient();
  // RLS allows this only for the recorder or an owner, and only while unsettled.
  const { error } = await supabase.from("trips").delete().eq("id", tripId);
  if (error) console.error("[trips] could not delete trip", error);

  revalidatePath(`/cars/${carId}`);
}
