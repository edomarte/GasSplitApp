import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

export * from "@/lib/email-templates";
import type { OutgoingEmail } from "@/lib/email-templates";

/**
 * Outbound email, over plain SMTP.
 *
 * SMTP rather than one provider's HTTP API on purpose: Gmail, Brevo, Mailjet
 * and Resend all speak it, so moving between them is four environment variables
 * and no code. This app sends a handful of messages a month; there is nothing
 * here worth coupling to a single vendor for.
 *
 * Without configuration it reports `skipped` and logs the message rather than
 * failing. An invite that was never delivered must not look delivered, or
 * someone waits by an inbox for a message that does not exist.
 *
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=587
 *   SMTP_USER=you@gmail.com
 *   SMTP_PASSWORD=<a Google App Password, not the account password>
 *   EMAIL_FROM=Gas Split <you@gmail.com>
 *
 * Gmail rewrites the From header to the authenticated account, so EMAIL_FROM
 * must use the same address as SMTP_USER or the two will disagree.
 */

export type EmailResult =
  | { status: "sent"; id: string }
  | { status: "skipped"; reason: "not_configured" }
  | { status: "failed"; reason: string };

type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
};

function smtpConfig(): SmtpConfig | null {
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !EMAIL_FROM) return null;

  return {
    host: SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: SMTP_USER,
    password: SMTP_PASSWORD,
    from: EMAIL_FROM,
  };
}

export function isEmailConfigured(): boolean {
  return smtpConfig() !== null;
}

let cached: Transporter | null = null;

function transporter(config: SmtpConfig): Transporter {
  if (cached) return cached;

  cached = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // 587 is STARTTLS, 465 is implicit TLS. Both are encrypted; only 465 wants
    // the connection to start that way.
    secure: config.port === 465,
    auth: { user: config.user, pass: config.password },
    // A settlement sends one message per member, and without pooling that is a
    // fresh TCP connection and TLS handshake each time — the slowest part of
    // the request, repeated. One connection carries them all.
    pool: true,
    maxConnections: 1,
    // A slow mail server must not hold up a settlement. The money is recorded
    // before this runs, and a failure here is reported rather than fatal.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  return cached;
}

export async function sendEmail(message: OutgoingEmail): Promise<EmailResult> {
  const config = smtpConfig();

  if (!config) {
    console.info(
      `[email] not configured, would have sent to ${message.to}: ${message.subject}\n${message.text}`,
    );
    return { status: "skipped", reason: "not_configured" };
  }

  try {
    const info = await transporter(config).sendMail({
      from: config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    // Accepted by the server but addressed to nobody is not a success.
    if (info.rejected?.length) {
      return { status: "failed", reason: "the mail server refused the address" };
    }

    return { status: "sent", id: info.messageId ?? "unknown" };
  } catch (error) {
    const reason = describe(error);
    console.error(`[email] could not send to ${message.to}: ${reason}`);
    return { status: "failed", reason };
  }
}

/** Turns an SMTP failure into something a person can act on. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";

  const code = (error as { code?: string }).code;
  const response = (error as { response?: string }).response;

  if (code === "EAUTH") return "the mail server rejected the username or password";
  if (code === "ECONNECTION" || code === "ETIMEDOUT" || code === "ESOCKET") {
    return "could not reach the mail server";
  }
  if (code === "EENVELOPE") return response ?? "the mail server refused the address";

  return error.message;
}
