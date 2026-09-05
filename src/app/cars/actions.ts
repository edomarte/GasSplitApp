"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { z } from "zod";

import { requireUser } from "@/lib/dal";
import { inviteEmail, sendEmail } from "@/lib/email";
import { siteUrl } from "@/lib/env";
import {
  createInviteToken,
  hashInviteToken,
  inviteExpiry,
  inviteUrl,
} from "@/lib/invite-token";
import { createClient } from "@/lib/supabase/server";

export type CarFormState = {
  error?: string;
  fieldErrors?: Partial<Record<"name" | "odometer", string>>;
};

const carSchema = z.object({
  name: z.string().trim().min(1, "Give the car a name").max(60, "That name is too long"),
  odometer: z
    .number({ message: "Enter the current reading in kilometres" })
    .int("Whole kilometres only")
    .min(0, "That cannot be negative")
    .max(9_999_999, "That reading looks wrong"),
});

function firstIssues(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}

export async function createCar(_prev: CarFormState, formData: FormData): Promise<CarFormState> {
  const user = await requireUser();

  const rawOdometer = String(formData.get("odometer") ?? "").trim();
  const parsed = carSchema.safeParse({
    name: formData.get("name"),
    odometer: rawOdometer === "" ? 0 : Number(rawOdometer),
  });
  if (!parsed.success) return { fieldErrors: firstIssues(parsed.error) };

  const supabase = await createClient();

  // The id is generated here rather than read back from the insert.
  //
  // `insert(...).select()` would apply the SELECT policy to the returned row,
  // and that policy is "you are a member of this car". The membership is made
  // by an AFTER INSERT trigger, which has not fired at the point RETURNING is
  // evaluated, so asking for the row back fails with an RLS error even though
  // the insert itself is allowed. Choosing the id up front sidesteps the
  // read entirely.
  const carId = randomUUID();

  const { error } = await supabase.from("cars").insert({
    id: carId,
    name: parsed.data.name,
    initial_odometer_km: parsed.data.odometer,
    created_by: user.id,
  });

  if (error) {
    console.error("[cars] could not create car", error);
    return { error: "Could not create the car. Try again." };
  }

  revalidatePath("/", "layout");
  redirect(`/cars/${carId}`);
}

export type InviteState = {
  error?: string;
  /** Present once an invite exists; the raw token lives only in this response. */
  invite?: {
    url: string;
    qrDataUrl: string;
    expiresAt: string;
    /** What happened to the email, when one was requested. */
    email?: { to: string; status: "sent" | "skipped" | "failed"; detail?: string };
  };
};

const inviteSchema = z.object({
  carId: z.string().uuid(),
  email: z.union([z.literal(""), z.string().trim().email("That email looks wrong")]),
});

export async function createInvite(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const user = await requireUser();

  const parsed = inviteSchema.safeParse({
    carId: formData.get("carId"),
    email: formData.get("email") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const { carId, email } = parsed.data;
  const supabase = await createClient();

  // RLS lets any member invite; a non-member's insert is rejected there.
  const token = createInviteToken();
  const expiresAt = inviteExpiry();

  const { error } = await supabase.from("invites").insert({
    car_id: carId,
    token_hash: hashInviteToken(token),
    invited_email: email === "" ? null : email,
    created_by: user.id,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    console.error("[invites] could not create invite", error);
    return { error: "Could not create the invite. Try again." };
  }

  const url = inviteUrl(siteUrl, token);
  const qrDataUrl = await QRCode.toDataURL(url, {
    width: 512,
    margin: 1,
    errorCorrectionLevel: "M",
  });

  const state: InviteState = {
    invite: { url, qrDataUrl, expiresAt: expiresAt.toISOString() },
  };

  if (email !== "") {
    // The car name is worth a round trip: it is the whole subject line.
    const { data: car } = await supabase.from("cars").select("name").eq("id", carId).maybeSingle();

    const result = await sendEmail({
      to: email,
      ...inviteEmail({
        carName: car?.name ?? "a shared car",
        invitedBy: user.displayName,
        url,
      }),
    });

    state.invite!.email = {
      to: email,
      status: result.status,
      detail: result.status === "failed" ? result.reason : undefined,
    };
  }

  revalidatePath(`/cars/${carId}/members`);
  return state;
}

export async function revokeInvite(formData: FormData): Promise<void> {
  await requireUser();
  const inviteId = String(formData.get("inviteId") ?? "");
  const carId = String(formData.get("carId") ?? "");

  const supabase = await createClient();
  // RLS allows this only for the inviter or an owner.
  await supabase.from("invites").delete().eq("id", inviteId);

  revalidatePath(`/cars/${carId}/members`);
}

export type JoinResult =
  | { status: "joined" | "already_member"; carId: string }
  | { status: "not_found" | "expired" | "used" | "not_signed_in" | "error" };

/** Redeems an invite. The raw token is hashed here and never sent to the database. */
export async function redeemInvite(token: string): Promise<JoinResult> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("redeem_invite", {
    p_token_hash: hashInviteToken(token),
  });

  if (error) {
    console.error("[invites] redeem failed", error);
    return { status: "error" };
  }

  const result = data as { status: JoinResult["status"]; car_id?: string };
  if (result.status === "joined" || result.status === "already_member") {
    revalidatePath("/", "layout");
    return { status: result.status, carId: result.car_id! };
  }
  return { status: result.status };
}

/**
 * Nobody walks out of an open question.
 *
 * The DELETE policy on `memberships` refuses it too, and that is the real
 * boundary — but a policy refusal is a silent no-op, and "nothing happened" is
 * the worst possible answer. Checking first is only so the screen can say why.
 */
async function isHeldByProposal(carId: string, userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("has_pending_proposal", {
    p_car_id: carId,
    p_user_id: userId,
  });

  if (error) {
    console.error("[cars] could not check pending proposals", error);
    // Let the policy have the final word rather than guessing.
    return false;
  }

  return data === true;
}

export async function leaveCar(formData: FormData): Promise<void> {
  const user = await requireUser();
  const carId = String(formData.get("carId") ?? "");

  if (await isHeldByProposal(carId, user.id)) {
    redirect(`/cars/${carId}/members?blocked=leave`);
  }

  const supabase = await createClient();
  await supabase.from("memberships").delete().eq("car_id", carId).eq("user_id", user.id);

  revalidatePath("/", "layout");
  redirect("/");
}

export async function removeMember(formData: FormData): Promise<void> {
  await requireUser();
  const carId = String(formData.get("carId") ?? "");
  const userId = String(formData.get("userId") ?? "");

  if (await isHeldByProposal(carId, userId)) {
    redirect(`/cars/${carId}/members?blocked=remove`);
  }

  const supabase = await createClient();
  // RLS allows this only for an owner.
  await supabase.from("memberships").delete().eq("car_id", carId).eq("user_id", userId);

  revalidatePath(`/cars/${carId}/members`);
}

export async function deleteCar(formData: FormData): Promise<void> {
  await requireUser();
  const carId = String(formData.get("carId") ?? "");

  const supabase = await createClient();
  // RLS allows this only for an owner. Trips, invites and settlements cascade.
  const { error } = await supabase.from("cars").delete().eq("id", carId);
  if (error) console.error("[cars] could not delete car", error);

  revalidatePath("/", "layout");
  redirect("/");
}
