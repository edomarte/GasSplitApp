import { describe, expect, it } from "vitest";

import { formatKm, formatMoney } from "./format";

const NNBSP = "\u202f";

describe("formatKm", () => {
  it("groups thousands without committing to a decimal convention", () => {
    // "92.450" reads as ninety-two point four five to half of Europe, and
    // "92,450" reads that way to the other half. A space is unambiguous.
    expect(formatKm(92450)).toBe(`92${NNBSP}450${NNBSP}km`);
    expect(formatKm(1234567)).toBe(`1${NNBSP}234${NNBSP}567${NNBSP}km`);
  });

  it("leaves short numbers alone", () => {
    expect(formatKm(0)).toBe(`0${NNBSP}km`);
    expect(formatKm(7)).toBe(`7${NNBSP}km`);
    expect(formatKm(999)).toBe(`999${NNBSP}km`);
  });

  it("adds a separator at exactly four digits", () => {
    expect(formatKm(1000)).toBe(`1${NNBSP}000${NNBSP}km`);
  });

  it("rounds rather than showing a fraction of a kilometre", () => {
    expect(formatKm(150.4)).toBe(`150${NNBSP}km`);
    expect(formatKm(150.6)).toBe(`151${NNBSP}km`);
  });

  it("does not depend on the host locale", () => {
    // The bug this guards: toLocaleString() on a server set to it-IT renders
    // "92.450", and the same code on Vercel renders "92,450".
    const output = formatKm(92450);
    expect(output).not.toContain(",");
    expect(output).not.toContain(".");
  });
});

describe("formatMoney", () => {
  it("renders whole and part units", () => {
    expect(formatMoney(7240)).toBe("€72.40");
    expect(formatMoney(100)).toBe("€1.00");
    expect(formatMoney(5)).toBe("€0.05");
    expect(formatMoney(0)).toBe("€0.00");
  });

  it("keeps the trailing zero, which money always has", () => {
    expect(formatMoney(250)).toBe("€2.50");
    expect(formatMoney(200)).toBe("€2.00");
  });

  it("knows a few currencies and falls back to the code", () => {
    expect(formatMoney(7240, "GBP")).toBe("£72.40");
    expect(formatMoney(7240, "USD")).toBe("$72.40");
    expect(formatMoney(7240, "SEK")).toBe("SEK 72.40");
  });

  it("does not depend on the host locale", () => {
    // The bug this guards: a server set to it-IT rendering "72,40" in an email
    // that another member reads as seventy-two thousand four hundred.
    expect(formatMoney(7240)).not.toContain(",");
  });

  it("handles a negative amount", () => {
    expect(formatMoney(-250)).toBe("-€2.50");
  });
});
