import "server-only";

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

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

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

/** Escapes text destined for an HTML email body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function inviteEmail({
  carName,
  invitedBy,
  url,
}: {
  carName: string;
  invitedBy: string;
  url: string;
}): Omit<OutgoingEmail, "to"> {
  const safeCar = escapeHtml(carName);
  const safeFrom = escapeHtml(invitedBy);
  const safeUrl = escapeHtml(url);

  return {
    subject: `${invitedBy} invited you to share "${carName}" on Gas Split`,
    text: [
      `${invitedBy} invited you to join "${carName}" on Gas Split.`,
      "",
      "Gas Split tracks the kilometres each person drives in a shared car, and",
      "splits the cost of each fill proportionally.",
      "",
      "Join here:",
      url,
      "",
      "The link works once and expires in 7 days.",
    ].join("\n"),
    html: `
      <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0a0a0a">
        <p style="font-size:18px;font-weight:600;margin:0 0 16px">
          ${safeFrom} invited you to share &ldquo;${safeCar}&rdquo;
        </p>
        <p style="margin:0 0 16px;line-height:1.5;color:#525252">
          Gas Split tracks the kilometres each person drives in a shared car, and splits
          the cost of each fill proportionally.
        </p>
        <p style="margin:0 0 24px">
          <a href="${safeUrl}"
             style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:500">
            Join ${safeCar}
          </a>
        </p>
        <p style="margin:0;font-size:13px;color:#737373">
          The link works once and expires in 7 days. If you were not expecting this, ignore it.
        </p>
      </div>
    `.trim(),
  };
}
