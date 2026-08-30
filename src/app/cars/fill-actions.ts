"use server";

import { z } from "zod";

import { requireUser } from "@/lib/dal";
import { parseMoneyToCents } from "@/lib/money";
import { sendEmail, settlementEmail, type SettlementRecipient } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";

export type NotificationOutcome = {
  displayName: string;
  email: string;
  status: "sent" | "skipped" | "failed";
  detail?: string;
};

export type FillFormState = {
  error?: string;
  fieldErrors?: Partial<Record<"cost" | "filledOn" | "odometer", string>>;
  settled?: {
    fillId: string;
    totalCents: number;
    shares: { displayName: string; amountCents: number; isYou: boolean }[];
    notifications: NotificationOutcome[];
  };
};

const fillSchema = z.object({
  carId: z.string().uuid(),
  totalCents: z
    .number({ message: "Enter what the fill cost" })
    .int()
    .positive("The cost must be more than zero")
    .max(1_000_000, "That looks too large"),
  filledOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  odometerKm: z.union([z.null(), z.number().int().min(0)]),
});

const MESSAGES: Record<string, string> = {
  not_signed_in: "Your session expired. Sign in and try again.",
  not_member: "You are not a member of this car.",
  bad_amount: "The cost must be more than zero.",
  future_date: "That date is in the future.",
  payer_not_member: "The person who paid must be a member of this car.",
  no_trips: "There are no trips to split since the last fill.",
};

export async function recordFill(
  _prev: FillFormState,
  formData: FormData,
): Promise<FillFormState> {
  const user = await requireUser();

  const rawCost = String(formData.get("cost") ?? "");
  const cents = parseMoneyToCents(rawCost);
  if (cents === null) {
    return { fieldErrors: { cost: "Enter an amount like 72.40" } };
  }

  const rawOdometer = String(formData.get("odometer") ?? "").trim();
  const parsed = fillSchema.safeParse({
    carId: formData.get("carId"),
    totalCents: cents,
    filledOn: String(formData.get("filledOn") ?? ""),
    odometerKm: rawOdometer === "" ? null : Number(rawOdometer),
  });

  if (!parsed.success) {
    const fieldErrors: FillFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      if (key === "totalCents") fieldErrors.cost ??= issue.message;
      else if (key === "filledOn") fieldErrors.filledOn ??= issue.message;
      else if (key === "odometerKm") fieldErrors.odometer ??= issue.message;
    }
    return { fieldErrors };
  }

  const { carId, totalCents, filledOn, odometerKm } = parsed.data;
  const supabase = await createClient();

  // One call. The split, the ledger rows and closing the period are one
  // transaction; nothing here can leave the group half-settled.
  const { data, error } = await supabase.rpc("settle_fill", {
    p_car_id: carId,
    p_total_cents: totalCents,
    p_filled_on: filledOn,
    p_paid_by: user.id,
    p_odometer_km: odometerKm ?? undefined,
  });

  if (error) {
    console.error("[fills] settlement failed", error);
    return { error: "Could not record the fill. Try again." };
  }

  const result = data as { status: string; fill_id?: string };
  if (result.status !== "ok") {
    return { error: MESSAGES[result.status] ?? "Could not record the fill." };
  }

  const fillId = result.fill_id!;
  const settled = await readBackSettlement(carId, fillId);

  // The money is already recorded. Email failures are reported, never allowed
  // to look like the settlement itself failed.
  const notifications = await notifyMembers({
    carName: settled.carName,
    currency: settled.currency,
    totalCents,
    totalKm: settled.totalKm,
    filledOn,
    payerId: user.id,
    payerName: user.displayName,
    recipients: settled.recipients,
  });

  // Deliberately no revalidatePath here. Refreshing the route unmounts the
  // dialog along with the result the user is waiting to read; the page is
  // refreshed when they dismiss it instead.
  return {
    settled: {
      fillId,
      totalCents,
      shares: settled.recipients.map((person) => ({
        displayName: person.displayName,
        amountCents: person.amountCents,
        isYou: person.userId === user.id,
      })),
      notifications,
    },
  };
}

type Recipient = SettlementRecipient & { userId: string; email: string };

/**
 * Reads the split back out of the database rather than recomputing it.
 * What people are told must be exactly what was written down.
 */
async function readBackSettlement(carId: string, fillId: string) {
  const supabase = await createClient();

  const { data: car } = await supabase
    .from("cars")
    .select("name, currency")
    .eq("id", carId)
    .maybeSingle();

  const { data: shares, error } = await supabase
    .from("fill_shares")
    .select("user_id, km_scaled, km_scale, amount_cents, profiles(display_name, email)")
    .eq("fill_id", fillId);

  if (error) throw error;

  const recipients: Recipient[] = (shares ?? []).map((share) => ({
    userId: share.user_id,
    displayName: share.profiles?.display_name ?? "Member",
    email: share.profiles?.email ?? "",
    km: share.km_scale > 0 ? Number(share.km_scaled) / share.km_scale : 0,
    amountCents: share.amount_cents,
  }));

  return {
    carName: car?.name ?? "your car",
    currency: car?.currency ?? "EUR",
    totalKm: recipients.reduce((sum, person) => sum + person.km, 0),
    recipients,
  };
}

async function notifyMembers({
  carName,
  currency,
  totalCents,
  totalKm,
  filledOn,
  payerId,
  payerName,
  recipients,
}: {
  carName: string;
  currency: string;
  totalCents: number;
  totalKm: number;
  filledOn: string;
  payerId: string;
  payerName: string;
  recipients: Recipient[];
}): Promise<NotificationOutcome[]> {
  const everyone: SettlementRecipient[] = recipients.map((person) => ({
    displayName: person.displayName,
    amountCents: person.amountCents,
    km: person.km,
  }));

  const outcomes: NotificationOutcome[] = [];

  for (const person of recipients) {
    if (!person.email) {
      outcomes.push({
        displayName: person.displayName,
        email: "",
        status: "failed",
        detail: "no email address on file",
      });
      continue;
    }

    const message = settlementEmail({
      carName,
      payerName,
      currency,
      totalCents,
      totalKm,
      filledOn,
      you: { displayName: person.displayName, amountCents: person.amountCents, km: person.km },
      everyone,
      isPayer: person.userId === payerId,
    });

    const result = await sendEmail({ to: person.email, ...message });
    outcomes.push({
      displayName: person.displayName,
      email: person.email,
      status: result.status,
      detail: result.status === "failed" ? result.reason : undefined,
    });
  }

  return outcomes;
}
