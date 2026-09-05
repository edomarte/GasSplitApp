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

/* -------------------------------------------------------------------------- */
/* Trip proposals                                                             */
/*                                                                            */
/* Four messages, and each has to survive three shapes of drive: one person    */
/* driving alone, a drive shared with whoever wrote it down, and a drive       */
/* between other people that the writer was not on. The third is the one most  */
/* likely to be wrong, so it is always said out loud.                          */
/*                                                                            */
/* Every message names the other people, the number of ways, and the distance  */
/* that lands on the reader. "Confirm this trip" invites a shrug; "80 km would */
/* be charged to you" invites a look.                                          */
/* -------------------------------------------------------------------------- */

export type ProposalPersonSummary = { userId: string; displayName: string };

export type ProposalContext = {
  carName: string;
  /** Whoever wrote the trip down. */
  proposer: ProposalPersonSummary;
  /** Everyone on the drive. May or may not include the proposer. */
  people: ProposalPersonSummary[];
  startKm: number;
  endKm: number;
  distanceKm: number;
  /** The day driven, already formatted for reading. */
  drivenOn: string;
  note: string | null;
  /** Where to go to answer. */
  url: string;
};

/** "you", "you and Edoardo", "Giulia and Rocco" — from one reader's side. */
function nameList(
  people: ProposalPersonSummary[],
  readerId: string | null,
  { capitalise = false } = {},
): string {
  // The reader first. "you and Edoardo" is about the reader; "Edoardo and you"
  // reads like a list they happen to be at the end of.
  const ordered = [
    ...people.filter((person) => person.userId === readerId),
    ...people.filter((person) => person.userId !== readerId),
  ];
  const names = ordered.map((person) =>
    person.userId === readerId ? (capitalise ? "You" : "you") : person.displayName,
  );
  if (names.length === 0) return "nobody";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "92 450 km → 92 610 km — 160 km" */
function readings(context: ProposalContext): string {
  return `${formatKm(context.startKm)} → ${formatKm(context.endKm)} — ${formatKm(
    context.distanceKm,
  )}`;
}

/** What the drive was, told to one particular reader. */
function driveSentence(context: ProposalContext, readerId: string): string {
  const { proposer, people, carName, drivenOn } = context;
  const proposerOnIt = people.some((person) => person.userId === proposer.userId);
  const readerOnIt = people.some((person) => person.userId === readerId);

  if (people.length === 1) {
    return readerOnIt
      ? `${proposer.displayName} recorded a trip in ${carName} on ${drivenOn} and says you were driving.`
      : `${proposer.displayName} recorded a trip in ${carName} on ${drivenOn}, driven by ${nameList(
          people,
          readerId,
        )}.`;
  }

  const everyone = nameList(people, readerId);

  if (proposerOnIt) {
    return `${proposer.displayName} recorded a trip in ${carName} on ${drivenOn} and says it was shared between ${everyone}.`;
  }

  // The case worth spelling out: the person who wrote it down was not there.
  return `${proposer.displayName} recorded a trip in ${carName} on ${drivenOn} and says it was shared between ${everyone}. ${proposer.displayName} was not on this drive.`;
}

/** How much of it lands on the reader. */
function shareSentence(context: ProposalContext, readerId: string): string {
  const onIt = context.people.some((person) => person.userId === readerId);
  const ways = context.people.length;
  const each = formatKm(context.distanceKm / ways);

  if (!onIt) {
    return `Split ${ways} ${ways === 1 ? "way" : "ways"} — ${each} each. You are not on this drive.`;
  }
  if (ways === 1) return `All ${formatKm(context.distanceKm)} would be charged to you.`;
  return `Split ${ways} ways, so ${each} would be charged to you.`;
}

function shell(body: string): string {
  return `
      <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0a0a0a">
        ${body}
      </div>
    `.trim();
}

function detailBlock(context: ProposalContext): string {
  return `
        <table style="width:100%;border-collapse:collapse;font-size:14px;border-top:1px solid #e5e5e5;margin:16px 0">
          <tr>
            <td style="padding:6px 0;color:#737373">Odometer</td>
            <td style="padding:6px 0;text-align:right;color:#0a0a0a">${escapeHtml(
              `${formatKm(context.startKm)} → ${formatKm(context.endKm)}`,
            )}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#737373">Distance</td>
            <td style="padding:6px 0;text-align:right;font-weight:500;color:#0a0a0a">${escapeHtml(
              formatKm(context.distanceKm),
            )}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#737373">Date</td>
            <td style="padding:6px 0;text-align:right;color:#0a0a0a">${escapeHtml(
              context.drivenOn,
            )}</td>
          </tr>
          ${
            context.note
              ? `<tr>
            <td style="padding:6px 0;color:#737373">Note</td>
            <td style="padding:6px 0;text-align:right;color:#0a0a0a">${escapeHtml(context.note)}</td>
          </tr>`
              : ""
          }
        </table>`;
}

/**
 * "Please confirm this." Goes to each person who has not answered, never to the
 * proposer — their agreement is implied by their asking.
 */
export function tripProposalEmail({
  context,
  recipientId,
  stillWaitingOn,
}: {
  context: ProposalContext;
  recipientId: string;
  /** The others yet to answer, not counting the recipient. */
  stillWaitingOn: ProposalPersonSummary[];
}): Omit<OutgoingEmail, "to"> {
  const subject = `${context.proposer.displayName} asks you to confirm a ${formatKm(
    context.distanceKm,
  )} trip in ${context.carName}`;

  const waiting =
    stillWaitingOn.length > 0
      ? `${nameList(stillWaitingOn, null, { capitalise: true })} ${
          stillWaitingOn.length === 1 ? "has" : "have"
        } still to confirm as well — the trip is recorded only when everybody does.`
      : "";

  const text = [
    subject,
    "",
    driveSentence(context, recipientId),
    "",
    readings(context),
    context.note ? `Note: ${context.note}` : "",
    "",
    shareSentence(context, recipientId),
    waiting,
    "",
    "Confirm or reject it here:",
    context.url,
    "",
    `If it is wrong, reject it and ${context.proposer.displayName} will be told.`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  return {
    subject,
    text,
    html: shell(`
        <p style="font-size:18px;font-weight:600;margin:0 0 12px">
          ${escapeHtml(context.proposer.displayName)} asks you to confirm a trip
        </p>
        <p style="margin:0 0 4px;line-height:1.5;color:#525252">
          ${escapeHtml(driveSentence(context, recipientId))}
        </p>
        ${detailBlock(context)}
        <p style="margin:0 0 16px;line-height:1.5;color:#0a0a0a">
          ${escapeHtml(shareSentence(context, recipientId))}
        </p>
        ${
          waiting
            ? `<p style="margin:0 0 16px;line-height:1.5;color:#525252">${escapeHtml(waiting)}</p>`
            : ""
        }
        <p style="margin:0 0 20px">
          <a href="${escapeHtml(context.url)}"
             style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:500">
            Confirm or reject
          </a>
        </p>
        <p style="margin:0;font-size:13px;color:#737373">
          If it is wrong, reject it and ${escapeHtml(context.proposer.displayName)} will be told.
        </p>`),
  };
}

/** Somebody said no. The proposer hears, and so does everyone else who was asked. */
export function tripProposalRejectedEmail({
  context,
  recipientId,
  rejectedBy,
}: {
  context: ProposalContext;
  recipientId: string;
  rejectedBy: ProposalPersonSummary;
}): Omit<OutgoingEmail, "to"> {
  const who = rejectedBy.userId === recipientId ? "You" : rejectedBy.displayName;
  const subject = `${who} rejected the ${formatKm(context.distanceKm)} trip in ${context.carName}`;

  const whose =
    context.proposer.userId === recipientId
      ? "the trip you recorded"
      : `the trip ${context.proposer.displayName} recorded`;

  const opening = `${who} rejected ${whose} in ${context.carName} on ${context.drivenOn}. It would have been shared between ${nameList(
    context.people,
    recipientId,
  )}.`;

  const closing =
    context.proposer.userId === recipientId
      ? "Nothing was recorded, and nobody has been charged for it. Record it again if it was right."
      : "Nothing was recorded, and nobody has been charged for it.";

  const text = [subject, "", opening, "", readings(context), "", closing, "", context.url].join(
    "\n",
  );

  return {
    subject,
    text,
    html: shell(`
        <p style="font-size:18px;font-weight:600;margin:0 0 12px">${escapeHtml(subject)}</p>
        <p style="margin:0 0 4px;line-height:1.5;color:#525252">${escapeHtml(opening)}</p>
        ${detailBlock(context)}
        <p style="margin:0;line-height:1.5;color:#525252">${escapeHtml(closing)}</p>`),
  };
}

/** The proposer, or an owner, withdrew it. Everyone who was asked hears about it. */
export function tripProposalCancelledEmail({
  context,
  recipientId,
  cancelledBy,
}: {
  context: ProposalContext;
  recipientId: string;
  cancelledBy: ProposalPersonSummary;
}): Omit<OutgoingEmail, "to"> {
  const byProposer = cancelledBy.userId === context.proposer.userId;
  const subject = `${cancelledBy.displayName} withdrew the ${formatKm(
    context.distanceKm,
  )} trip in ${context.carName}`;

  // An owner can withdraw somebody else's, so this also reaches the person who
  // raised it — who must not be told they were asked to confirm their own trip.
  const opening =
    recipientId === context.proposer.userId
      ? `${cancelledBy.displayName} withdrew the trip you recorded in ${context.carName} on ${context.drivenOn}.`
      : byProposer
        ? `${cancelledBy.displayName} withdrew the trip they asked you to confirm in ${context.carName} on ${context.drivenOn}.`
        : `${cancelledBy.displayName} withdrew the trip ${context.proposer.displayName} asked you to confirm in ${context.carName} on ${context.drivenOn}.`;

  const closing = "There is nothing left to confirm, and nobody has been charged for it.";

  const text = [subject, "", opening, "", readings(context), "", closing, "", context.url].join(
    "\n",
  );

  return {
    subject,
    text,
    html: shell(`
        <p style="font-size:18px;font-weight:600;margin:0 0 12px">${escapeHtml(subject)}</p>
        <p style="margin:0 0 4px;line-height:1.5;color:#525252">${escapeHtml(opening)}</p>
        ${detailBlock(context)}
        <p style="margin:0;line-height:1.5;color:#525252">${escapeHtml(closing)}</p>`),
  };
}

/**
 * Everybody agreed. Goes to each person on the drive and to the proposer, who
 * would otherwise never learn the outcome except by opening the app — while a
 * rejection would have reached them by mail.
 */
export function tripProposalAcceptedEmail({
  context,
  recipientId,
}: {
  context: ProposalContext;
  recipientId: string;
}): Omit<OutgoingEmail, "to"> {
  const subject = `The ${formatKm(context.distanceKm)} trip in ${context.carName} is confirmed`;

  const opening =
    context.proposer.userId === recipientId
      ? `Everybody confirmed the trip you recorded in ${context.carName} on ${context.drivenOn}.`
      : `Everybody confirmed the trip ${context.proposer.displayName} recorded in ${context.carName} on ${context.drivenOn}.`;

  const onIt = context.people.some((person) => person.userId === recipientId);
  const landing = onIt
    ? `${formatKm(
        context.distanceKm / context.people.length,
      )} is now on your account, and will be included in the next fill.`
    : "It will be included in the next fill.";

  const text = [
    subject,
    "",
    opening,
    `It is shared between ${nameList(context.people, recipientId)}.`,
    "",
    readings(context),
    context.note ? `Note: ${context.note}` : "",
    "",
    landing,
    "",
    context.url,
  ]
    .filter((line) => line !== "")
    .join("\n");

  return {
    subject,
    text,
    html: shell(`
        <p style="font-size:18px;font-weight:600;margin:0 0 12px">${escapeHtml(subject)}</p>
        <p style="margin:0 0 4px;line-height:1.5;color:#525252">
          ${escapeHtml(opening)} It is shared between ${escapeHtml(
            nameList(context.people, recipientId),
          )}.
        </p>
        ${detailBlock(context)}
        <p style="margin:0;line-height:1.5;color:#0a0a0a">${escapeHtml(landing)}</p>`),
  };
}
