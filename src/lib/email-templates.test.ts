import { describe, expect, it } from "vitest";

import {
  inviteEmail,
  settlementEmail,
  tripProposalAcceptedEmail,
  tripProposalCancelledEmail,
  tripProposalEmail,
  tripProposalRejectedEmail,
  type SettlementRecipient,
} from "./email-templates";
import { formatKm, formatMoney } from "./format";

const giulia: SettlementRecipient = { displayName: "Giulia", amountCents: 3679, km: 208.33 };
const edoardo: SettlementRecipient = { displayName: "Edoardo", amountCents: 2972, km: 168.33 };
const marco: SettlementRecipient = { displayName: "Marco", amountCents: 589, km: 33.33 };
const everyone = [giulia, edoardo, marco];

const base = {
  carName: "Fiat Panda",
  payerName: "Marco",
  currency: "EUR",
  totalCents: 7240,
  totalKm: 410,
  filledOn: "30 Aug 2026",
  everyone,
};

describe("settlementEmail, to someone who owes", () => {
  const mail = settlementEmail({ ...base, you: giulia, isPayer: false });

  it("says who to pay and how much, in the subject", () => {
    // The subject is often all someone reads.
    expect(mail.subject).toBe(`You owe Marco ${formatMoney(3679)} for Fiat Panda`);
  });

  it("shows the distance the amount came from", () => {
    // "You owe €36.79" invites an argument; the kilometres settle it.
    expect(mail.text).toContain(formatKm(208));
    expect(mail.text).toContain(formatMoney(3679));
    expect(mail.text).toContain("Send it to Marco.");
  });

  it("lists everyone, not only the reader", () => {
    for (const person of everyone) {
      expect(mail.text).toContain(person.displayName);
    }
  });

  it("marks who paid", () => {
    expect(mail.text).toContain(`Marco: ${formatKm(33)} — ${formatMoney(589)} (paid)`);
  });

  it("accounts for the whole fill across the listed shares", () => {
    const listed = everyone.reduce((sum, person) => sum + person.amountCents, 0);
    expect(listed).toBe(base.totalCents);
    expect(mail.text).toContain(formatMoney(7240));
  });
});

describe("settlementEmail, to the person who paid", () => {
  const mail = settlementEmail({ ...base, you: marco, isPayer: true });

  it("is written from the other side", () => {
    expect(mail.subject).toBe(`You filled Fiat Panda — ${formatMoney(7240)}`);
    expect(mail.text).toContain("What the others owe you:");
    expect(mail.text).not.toContain("Send it to Marco.");
  });

  it("lists what each person owes them, largest first", () => {
    const owed = mail.text.slice(mail.text.indexOf("What the others owe you:"));
    expect(owed.indexOf("Giulia")).toBeLessThan(owed.indexOf("Edoardo"));
    expect(owed).not.toContain("Marco: €");
  });

  it("says so plainly when nobody else drove", () => {
    const alone = settlementEmail({
      ...base,
      everyone: [marco],
      you: marco,
      isPayer: true,
    });
    expect(alone.text).toContain("Nobody else drove");
  });
});

describe("email escaping", () => {
  it("does not let a display name inject markup", () => {
    // Display names come from whatever the user typed at signup.
    const mail = settlementEmail({
      ...base,
      payerName: '<script>alert("x")</script>',
      you: giulia,
      isPayer: false,
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("escapes the car name and the invite link too", () => {
    const mail = inviteEmail({
      carName: 'Panda" onload="evil()',
      invitedBy: "Marco",
      url: 'https://example.com/join/x"><b>',
    });
    expect(mail.html).not.toContain('onload="evil()');
    expect(mail.html).not.toContain('"><b>');
    expect(mail.html).toContain("&quot;");
  });
});

describe("both templates", () => {
  it("always provide a plain-text alternative", () => {
    // Some clients never render the HTML, and a blank email is worse than none.
    const settlement = settlementEmail({ ...base, you: giulia, isPayer: false });
    const invite = inviteEmail({ carName: "Panda", invitedBy: "Marco", url: "https://x/join/y" });

    for (const mail of [settlement, invite]) {
      expect(mail.text.trim().length).toBeGreaterThan(40);
      expect(mail.subject.trim().length).toBeGreaterThan(0);
      expect(mail.html).toContain("<div");
    }
  });
});

/* -------------------------------------------------------------------------- */

const edoardoProfile = { userId: "u-edoardoProfile", displayName: "Edoardo" };
const giuliaProfile = { userId: "u-giuliaProfile", displayName: "Giulia" };
const roccoProfile = { userId: "u-roccoProfile", displayName: "Rocco" };

const drive = {
  carName: "Fiat Panda",
  proposer: edoardoProfile,
  startKm: 92450,
  endKm: 92610,
  distanceKm: 160,
  drivenOn: "3 Sep 2026",
  note: null,
  url: "https://gas-split-app.vercel.app/cars/abc",
};

describe("tripProposalEmail, for a drive the reader took alone", () => {
  const mail = tripProposalEmail({
    context: { ...drive, people: [giuliaProfile] },
    recipientId: giuliaProfile.userId,
    stillWaitingOn: [],
  });

  it("names who is asking, and what for, in the subject", () => {
    expect(mail.subject).toBe(
      `Edoardo asks you to confirm a ${formatKm(160)} trip in Fiat Panda`,
    );
  });

  it("says the reader was the one driving", () => {
    expect(mail.text).toContain("says you were driving");
  });

  it("says the whole distance lands on them", () => {
    // The number is the point. "Confirm this trip" invites a shrug.
    expect(mail.text).toContain(`All ${formatKm(160)} would be charged to you.`);
  });

  it("carries the odometer readings the claim rests on", () => {
    expect(mail.text).toContain(formatKm(92450));
    expect(mail.text).toContain(formatKm(92610));
  });
});

describe("tripProposalEmail, for a drive shared with whoever recorded it", () => {
  const mail = tripProposalEmail({
    context: { ...drive, people: [edoardoProfile, giuliaProfile] },
    recipientId: giuliaProfile.userId,
    stillWaitingOn: [],
  });

  it("says who it was shared between", () => {
    expect(mail.text).toContain("shared between you and Edoardo");
  });

  it("gives the reader's own share, not the total", () => {
    expect(mail.text).toContain(`Split 2 ways, so ${formatKm(80)} would be charged to you.`);
  });

  it("does not claim the recorder was absent", () => {
    expect(mail.text).not.toContain("was not on this drive");
  });
});

describe("tripProposalEmail, for a drive the recorder was not on", () => {
  const mail = tripProposalEmail({
    context: { ...drive, people: [giuliaProfile, roccoProfile] },
    recipientId: giuliaProfile.userId,
    stillWaitingOn: [roccoProfile],
  });

  it("says out loud that the person asking was not there", () => {
    // The case most likely to be wrong, so it is never left to be inferred.
    expect(mail.text).toContain("Edoardo was not on this drive.");
  });

  it("names the other person on it", () => {
    expect(mail.text).toContain("shared between you and Rocco");
  });

  it("says whose confirmation is still outstanding", () => {
    expect(mail.text).toContain("Rocco has still to confirm as well");
    expect(mail.text).toContain("recorded only when everybody does");
  });
});

describe("tripProposalRejectedEmail", () => {
  const context = { ...drive, people: [giuliaProfile, roccoProfile] };

  it("tells the recorder it was theirs, and that they can ask again", () => {
    const mail = tripProposalRejectedEmail({
      context,
      recipientId: edoardoProfile.userId,
      rejectedBy: giuliaProfile,
    });
    expect(mail.subject).toContain("Giulia rejected");
    expect(mail.text).toContain("the trip you recorded");
    expect(mail.text).toContain("Record it again if it was right.");
  });

  it("tells the others nothing was recorded, without inviting them to redo it", () => {
    const mail = tripProposalRejectedEmail({
      context,
      recipientId: roccoProfile.userId,
      rejectedBy: giuliaProfile,
    });
    expect(mail.text).toContain("the trip Edoardo recorded");
    expect(mail.text).toContain("nobody has been charged for it");
    expect(mail.text).not.toContain("Record it again");
  });

  it("addresses the rejector in the second person", () => {
    const mail = tripProposalRejectedEmail({
      context,
      recipientId: giuliaProfile.userId,
      rejectedBy: giuliaProfile,
    });
    expect(mail.subject).toContain("You rejected");
  });
});

describe("tripProposalCancelledEmail", () => {
  const context = { ...drive, people: [giuliaProfile, roccoProfile] };

  it("says the person who asked withdrew it", () => {
    const mail = tripProposalCancelledEmail({
      context,
      recipientId: giuliaProfile.userId,
      cancelledBy: edoardoProfile,
    });
    expect(mail.text).toContain("Edoardo withdrew the trip they asked you to confirm");
    expect(mail.text).toContain("nothing left to confirm");
  });

  it("distinguishes an owner withdrawing somebody else's", () => {
    const mail = tripProposalCancelledEmail({
      context,
      recipientId: giuliaProfile.userId,
      cancelledBy: roccoProfile,
    });
    expect(mail.text).toContain("Rocco withdrew the trip Edoardo asked you to confirm");
  });

  it("does not tell the person who raised it that they were asked to confirm it", () => {
    // An owner can withdraw somebody else's, so this reaches the proposer too.
    const mail = tripProposalCancelledEmail({
      context,
      recipientId: edoardoProfile.userId,
      cancelledBy: roccoProfile,
    });
    expect(mail.text).toContain("Rocco withdrew the trip you recorded");
    expect(mail.text).not.toContain("asked you to confirm");
  });
});

describe("tripProposalAcceptedEmail", () => {
  const context = { ...drive, people: [giuliaProfile, roccoProfile] };

  it("tells someone on the drive what landed on them", () => {
    const mail = tripProposalAcceptedEmail({ context, recipientId: giuliaProfile.userId });
    expect(mail.subject).toContain("is confirmed");
    expect(mail.text).toContain(`${formatKm(80)} is now on your account`);
    expect(mail.text).toContain("shared between you and Rocco");
  });

  it("tells the recorder the outcome even though they were not on it", () => {
    // Without this they would only ever hear about a rejection.
    const mail = tripProposalAcceptedEmail({ context, recipientId: edoardoProfile.userId });
    expect(mail.text).toContain("the trip you recorded");
    expect(mail.text).toContain("It will be included in the next fill.");
  });
});

describe("proposal emails and hostile display names", () => {
  const mischief = { userId: "u-x", displayName: '<script>alert("x")</script>' };

  it("escapes them in the HTML body", () => {
    const mail = tripProposalEmail({
      context: { ...drive, proposer: mischief, people: [giuliaProfile] },
      recipientId: giuliaProfile.userId,
      stillWaitingOn: [],
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});
