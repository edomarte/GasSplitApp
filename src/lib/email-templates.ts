/**
 * Email bodies.
 *
 * Deliberately free of `server-only` and of any transport: these are pure
 * functions from facts to strings, so they can be unit-tested and previewed
 * without sending anything to anyone.
 */

import { formatKm, formatMoney } from "@/lib/format";

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

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

export type SettlementRecipient = {
  displayName: string;
  amountCents: number;
  km: number;
};

/**
 * What one member is told after a fill.
 *
 * The payer gets the same message from the other side: what each person owes
 * them, rather than what they owe. Both carry the kilometres the split came
 * from, because "you owe €25.42" invites an argument and "you drove 214 of the
 * 610 km" settles it.
 */
export function settlementEmail({
  carName,
  payerName,
  currency,
  totalCents,
  totalKm,
  filledOn,
  you,
  everyone,
  isPayer,
}: {
  carName: string;
  payerName: string;
  currency: string;
  totalCents: number;
  totalKm: number;
  filledOn: string;
  you: SettlementRecipient;
  everyone: SettlementRecipient[];
  isPayer: boolean;
}): Omit<OutgoingEmail, "to"> {
  const money = (cents: number) => formatMoney(cents, currency);
  const distance = (km: number) => formatKm(km);

  const owedToYou = everyone
    .filter((person) => person.displayName !== payerName && person.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents);

  const headline = isPayer
    ? `You filled ${carName} — ${money(totalCents)}`
    : `You owe ${payerName} ${money(you.amountCents)} for ${carName}`;

  const breakdown = everyone
    .slice()
    .sort((a, b) => b.amountCents - a.amountCents)
    .map((person) => ({
      ...person,
      isPayer: person.displayName === payerName,
    }));

  const textLines = [
    headline,
    "",
    `${payerName} filled ${carName} on ${filledOn} for ${money(totalCents)}.`,
    `The tank covered ${distance(totalKm)} since the last fill.`,
    "",
  ];

  if (isPayer) {
    textLines.push(
      owedToYou.length > 0 ? "What the others owe you:" : "Nobody else drove, so nobody owes you.",
    );
    for (const person of owedToYou) {
      textLines.push(`  ${person.displayName}: ${money(person.amountCents)}`);
    }
  } else {
    textLines.push(
      `You drove ${distance(you.km)} of it, so your share is ${money(you.amountCents)}.`,
      `Send it to ${payerName}.`,
    );
  }

  textLines.push("", "The full split:");
  for (const person of breakdown) {
    textLines.push(
      `  ${person.displayName}: ${distance(person.km)} — ${money(person.amountCents)}${
        person.isPayer ? " (paid)" : ""
      }`,
    );
  }

  const rows = breakdown
    .map(
      (person) => `
        <tr>
          <td style="padding:6px 0;color:#0a0a0a">${escapeHtml(person.displayName)}${
            person.isPayer
              ? ' <span style="color:#737373;font-size:13px">(paid)</span>'
              : ""
          }</td>
          <td style="padding:6px 0;text-align:right;color:#525252">${escapeHtml(distance(person.km))}</td>
          <td style="padding:6px 0;text-align:right;font-weight:500;color:#0a0a0a">${escapeHtml(money(person.amountCents))}</td>
        </tr>`,
    )
    .join("");

  return {
    subject: headline,
    text: textLines.join("\n"),
    html: `
      <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0a0a0a">
        <p style="font-size:18px;font-weight:600;margin:0 0 8px">${escapeHtml(headline)}</p>
        <p style="margin:0 0 20px;line-height:1.5;color:#525252">
          ${escapeHtml(payerName)} filled ${escapeHtml(carName)} on ${escapeHtml(filledOn)} for
          ${escapeHtml(money(totalCents))}. The tank covered ${escapeHtml(distance(totalKm))}
          since the last fill${
            isPayer
              ? "."
              : `, and you drove ${escapeHtml(distance(you.km))} of it.`
          }
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;border-top:1px solid #e5e5e5">
          ${rows}
        </table>
        <p style="margin:20px 0 0;font-size:13px;color:#737373">
          ${
            isPayer
              ? "Everyone has been told what they owe you."
              : `Send ${escapeHtml(money(you.amountCents))} to ${escapeHtml(payerName)}.`
          }
        </p>
      </div>
    `.trim(),
  };
}
