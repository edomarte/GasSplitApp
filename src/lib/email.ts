import "server-only";

export * from "@/lib/email-templates";
import type { OutgoingEmail } from "@/lib/email-templates";

/**
 * Outbound email.
 *
 * Resend is not configured yet, and rather than pretend otherwise this reports
 * `skipped` and logs the message to the server console. Callers surface that to
 * the user — an invite that was never delivered must not look delivered, or
 * someone waits by an inbox for a message that does not exist.
 *
 * Set RESEND_API_KEY and EMAIL_FROM to switch it on; nothing else changes.
 */

export type EmailResult =
  | { status: "sent"; id: string }
  | { status: "skipped"; reason: "not_configured" }
  | { status: "failed"; reason: string };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(message: OutgoingEmail): Promise<EmailResult> {
  if (!isEmailConfigured()) {
    console.info(
      `[email] not configured, would have sent to ${message.to}: ${message.subject}\n${message.text}`,
    );
    return { status: "skipped", reason: "not_configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error(`[email] Resend rejected the message: ${response.status} ${detail}`);
      return { status: "failed", reason: `Resend returned ${response.status}` };
    }

    const body = (await response.json()) as { id?: string };
    return { status: "sent", id: body.id ?? "unknown" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.error(`[email] could not reach Resend: ${reason}`);
    return { status: "failed", reason };
  }
}

