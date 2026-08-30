import { describe, expect, it } from "vitest";

import { formatKm } from "./format";

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
