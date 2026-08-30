import "server-only";

import { apportion } from "@/lib/apportion";
import { requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * Settled fills.
 *
 * Every figure here is read back from `fill_shares` rather than recomputed.
 * The database did the division when the fill was recorded; recomputing it in
 * TypeScript would be a second implementation of the same arithmetic, free to
 * drift from the one people were actually emailed.
 */

export type FillShare = {
  userId: string;
  displayName: string;
  isYou: boolean;
  /** Exact distance, as it was when the fill was settled. */
  km: number;
  /** Whole kilometres, rounded so the column adds up to the fill total. */
  displayKm: number;
  amountCents: number;
};

export type Fill = {
  id: string;
  filledOn: string;
  createdAt: string;
  totalCents: number;
  odometerKm: number | null;
  paidBy: string;
  paidByName: string;
  paidByYou: boolean;
  currency: string;
  totalKm: number;
  shares: FillShare[];
  /** What you owe the payer, or 0 if you are the payer or drove nothing. */
  yourAmountCents: number;
};

export async function listFills(carId: string, currency: string): Promise<Fill[]> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("fills")
    .select(
      `id, filled_on, created_at, total_cents, odometer_km, paid_by,
       profiles!fills_paid_by_fkey(display_name),
       fill_shares(user_id, km_scaled, km_scale, amount_cents,
         profiles(display_name))`,
    )
    .eq("car_id", carId)
    .order("filled_on", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const shares: FillShare[] = (row.fill_shares ?? []).map((share) => ({
      userId: share.user_id,
      displayName: share.profiles?.display_name ?? "Former member",
      isYou: share.user_id === user.id,
      // km_scaled is the distance multiplied by km_scale, which is what kept
      // the thirds exact. Divide only for display.
      km: share.km_scale > 0 ? Number(share.km_scaled) / share.km_scale : 0,
      displayKm: 0,
      amountCents: share.amount_cents,
    }));

    shares.sort((a, b) => b.amountCents - a.amountCents || a.displayName.localeCompare(b.displayName));

    // Same reason as the dashboard: rounding each figure alone prints a column
    // that does not add up to the total beside it.
    const totalKm = shares.reduce((sum, share) => sum + share.km, 0);
    const shownKm = apportion(Math.round(totalKm), shares.map((share) => share.km));
    shares.forEach((share, index) => {
      share.displayKm = shownKm[index];
    });

    return {
      id: row.id,
      filledOn: row.filled_on,
      createdAt: row.created_at,
      totalCents: row.total_cents,
      odometerKm: row.odometer_km,
      paidBy: row.paid_by,
      paidByName: row.profiles?.display_name ?? "A member",
      paidByYou: row.paid_by === user.id,
      currency,
      totalKm,
      shares,
      yourAmountCents:
        row.paid_by === user.id
          ? 0
          : (shares.find((share) => share.isYou)?.amountCents ?? 0),
    };
  });
}

/** The most recent fill, for the "last fill" line on the car page. */
export async function getLatestFill(carId: string, currency: string): Promise<Fill | null> {
  const fills = await listFills(carId, currency);
  return fills[0] ?? null;
}
