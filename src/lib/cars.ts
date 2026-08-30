import "server-only";

import { cache } from "react";

import { requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * Reads about cars and their members.
 *
 * None of these filter by user. RLS does that: a query for "all cars" returns
 * only the caller's, and a car id they are not a member of simply comes back
 * empty. Adding a redundant `.eq("user_id", …)` here would suggest the filter
 * matters, and hide the fact that the real boundary is in the database.
 */

export type CarSummary = {
  id: string;
  name: string;
  currency: string;
  memberCount: number;
  role: "owner" | "member";
};

export type CarMember = {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  role: "owner" | "member";
  isYou: boolean;
};

export type CarDetail = {
  id: string;
  name: string;
  currency: string;
  initialOdometerKm: number;
  lastOdometerKm: number;
  createdBy: string;
  members: CarMember[];
  yourRole: "owner" | "member";
};

export const listMyCars = cache(async (): Promise<CarSummary[]> => {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("memberships")
    .select("role, cars!inner(id, name, currency, memberships(user_id))")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.cars.id,
    name: row.cars.name,
    currency: row.cars.currency,
    memberCount: row.cars.memberships.length,
    role: row.role as "owner" | "member",
  }));
});

export const getCar = cache(async (carId: string): Promise<CarDetail | null> => {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("cars")
    .select(
      `id, name, currency, initial_odometer_km, created_by,
       memberships(role, user_id, joined_at,
         profiles(id, display_name, email, avatar_url))`,
    )
    .eq("id", carId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const members: CarMember[] = (data.memberships ?? [])
    .map((m) => ({
      userId: m.user_id,
      displayName: m.profiles?.display_name ?? "Member",
      email: m.profiles?.email ?? "",
      avatarUrl: m.profiles?.avatar_url ?? null,
      role: m.role as "owner" | "member",
      isYou: m.user_id === user.id,
    }))
    // Owner first, then alphabetically; a stable order stops the list jumping.
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });

  const yourRole = members.find((m) => m.isYou)?.role ?? "member";

  const { data: odo } = await supabase
    .from("car_odometer")
    .select("last_km")
    .eq("car_id", carId)
    .maybeSingle();

  return {
    id: data.id,
    name: data.name,
    currency: data.currency,
    initialOdometerKm: data.initial_odometer_km,
    lastOdometerKm: odo?.last_km ?? data.initial_odometer_km,
    createdBy: data.created_by,
    members,
    yourRole,
  };
});

export type PendingInvite = {
  id: string;
  invitedEmail: string | null;
  createdAt: string;
  expiresAt: string;
  createdByYou: boolean;
};

/** Unredeemed, unexpired invites for a car. */
export async function listPendingInvites(carId: string): Promise<PendingInvite[]> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invites")
    .select("id, invited_email, created_at, expires_at, created_by")
    .eq("car_id", carId)
    .is("accepted_by", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    invitedEmail: row.invited_email,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    createdByYou: row.created_by === user.id,
  }));
}
