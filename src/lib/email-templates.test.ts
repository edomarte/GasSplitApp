import { describe, expect, it } from "vitest";

import { inviteEmail, settlementEmail, type SettlementRecipient } from "./email-templates";
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
