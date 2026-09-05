"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/dal";
import { isUuid } from "@/lib/ids";
import {
  notifyProposalResolved,
  reportNotifications,
  type ResolvedProposal,
} from "@/lib/proposal-notify";
import { createClient } from "@/lib/supabase/server";

/**
 * Answering and withdrawing proposals.
 *
 * Plain form actions rather than `useActionState` ones, because nothing on
 * screen is rendered from their result: answering makes the card disappear and
 * the trip appear, and the page has to be refreshed for either. That is also
 * why an email failure is logged rather than shown — the app itself is the
 * record, and both people can see the change in it. The mail is the nudge for
 * whoever is not looking.
 */

/**
 * The function hands the proposal back on its way out, because by the time we
 * read this the row has been deleted — resolving one removes it.
 */
type Resolution = { status: string; outcome?: string; proposal?: ResolvedProposal };

export async function respondToProposal(formData: FormData): Promise<void> {
  const user = await requireUser();
  const proposalId = String(formData.get("proposalId") ?? "");
  const carId = String(formData.get("carId") ?? "");
  const accept = String(formData.get("accept") ?? "") === "true";

  if (!isUuid(proposalId)) return;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("respond_to_trip_proposal", {
    p_proposal_id: proposalId,
    p_accept: accept,
  });

  if (error) {
    console.error("[proposals] could not record the response", error);
    revalidatePath(`/cars/${carId}`);
    return;
  }

  const result = data as Resolution;

  // 'awaiting' means somebody else has yet to answer: there is nothing to tell
  // anyone, and an email on every partial acceptance would be noise.
  if (
    result.status === "ok" &&
    result.proposal &&
    (result.outcome === "accepted" || result.outcome === "rejected")
  ) {
    reportNotifications(
      result.outcome,
      await notifyProposalResolved(result.proposal, result.outcome, user.id),
    );
  } else if (result.status !== "ok") {
    console.error(`[proposals] response refused: ${JSON.stringify(result)}`);
  }

  revalidatePath(`/cars/${carId}`);
}

export async function cancelProposal(formData: FormData): Promise<void> {
  const user = await requireUser();
  const proposalId = String(formData.get("proposalId") ?? "");
  const carId = String(formData.get("carId") ?? "");

  if (!isUuid(proposalId)) return;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_trip_proposal", {
    p_proposal_id: proposalId,
  });

  if (error) {
    console.error("[proposals] could not withdraw the proposal", error);
    revalidatePath(`/cars/${carId}`);
    return;
  }

  const result = data as Resolution;

  if (result.status === "ok" && result.proposal) {
    reportNotifications(
      "cancelled",
      await notifyProposalResolved(result.proposal, "cancelled", user.id),
    );
  } else if (result.status !== "ok") {
    console.error(`[proposals] withdrawal refused: ${JSON.stringify(result)}`);
  }

  revalidatePath(`/cars/${carId}`);
}
