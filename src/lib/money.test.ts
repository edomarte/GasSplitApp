import { describe, expect, it } from "vitest";

import { parseMoneyToCents } from "./money";

describe("parseMoneyToCents", () => {
  it("reads the obvious forms", () => {
    expect(parseMoneyToCents("72.40")).toBe(7240);
    expect(parseMoneyToCents("72")).toBe(7200);
    expect(parseMoneyToCents("0.05")).toBe(5);
  });

  it("treats a comma as a decimal point", () => {
    // Half of Europe types it this way, including the people this is built for.
    expect(parseMoneyToCents("72,40")).toBe(7240);
    expect(parseMoneyToCents("0,05")).toBe(5);
  });

  it("pads a single decimal digit rather than reading it as cents", () => {
    // "72.4" is seventy-two euros forty, not seventy-two euros four cents.
    expect(parseMoneyToCents("72.4")).toBe(7240);
    expect(parseMoneyToCents("72,4")).toBe(7240);
  });

  it("ignores a currency symbol and stray spaces", () => {
    expect(parseMoneyToCents(" € 72,40 ")).toBe(7240);
    expect(parseMoneyToCents("$72.40")).toBe(7240);
  });

  it("never returns a fraction of a cent", () => {
    for (const input of ["72.40", "72,4", "0.01", "199.99", "1000"]) {
      const cents = parseMoneyToCents(input);
      expect(Number.isInteger(cents)).toBe(true);
    }
  });

  it("refuses anything it cannot read exactly", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("72.405")).toBeNull();
    expect(parseMoneyToCents("-72.40")).toBeNull();
    expect(parseMoneyToCents("72.40.10")).toBeNull();
    expect(parseMoneyToCents("1,234.56")).toBeNull();
  });
});
