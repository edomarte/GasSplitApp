import { describe, expect, it } from "vitest";

import { apportion, apportionAmong } from "./apportion";

/** The property everything else depends on. */
function sums(parts: number[]): number {
  return parts.reduce((total, part) => total + part, 0);
}

describe("apportion", () => {
  it("splits evenly when it divides evenly", () => {
    expect(apportion(100, [1, 1])).toEqual([50, 50]);
    expect(apportion(90, [1, 1, 1])).toEqual([30, 30, 30]);
  });

  it("keeps the total when it does not divide evenly", () => {
    // The case that started this: 33 + 33 + 33 is 99, not 100.
    const parts = apportion(100, [1, 1, 1]);
    expect(sums(parts)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
  });

  it("splits proportionally, not equally", () => {
    expect(apportion(100, [3, 1])).toEqual([75, 25]);
    expect(apportion(410, [208.33, 168.33, 33.33])).toEqual([209, 168, 33]);
  });

  it("keeps the total for money, to the cent", () => {
    // 72.40 EUR split 175 / 135 kilometres.
    const parts = apportion(7240, [175, 135]);
    expect(sums(parts)).toBe(7240);
    expect(parts).toEqual([4087, 3153]);
  });

  it("never loses or invents a unit, across many awkward splits", () => {
    for (let total = 0; total <= 200; total += 7) {
      for (const weights of [
        [1, 1, 1],
        [1, 2, 3],
        [0.1, 0.2, 0.7],
        [1, 1, 1, 1, 1, 1, 1],
        [99, 1],
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      ]) {
        expect(sums(apportion(total, weights))).toBe(total);
      }
    }
  });

  it("gives nobody more than one unit away from their exact share", () => {
    const weights = [17, 5, 3, 91, 44];
    const total = 1000;
    const weightTotal = sums(weights);
    const parts = apportion(total, weights);

    parts.forEach((part, index) => {
      const exact = (weights[index] / weightTotal) * total;
      expect(Math.abs(part - exact)).toBeLessThan(1);
    });
  });

  it("gives the leftover to whoever was cut back hardest", () => {
    // Exact shares are 16.67 / 16.67 / 66.67; all three lose two thirds, so the
    // first two by position take the spare units.
    expect(apportion(100, [1, 1, 4])).toEqual([17, 17, 66]);
  });

  it("handles a single share", () => {
    expect(apportion(7240, [1])).toEqual([7240]);
    expect(apportion(0, [1])).toEqual([0]);
  });

  it("gives nothing to people with no weight", () => {
    expect(apportion(100, [1, 0, 1])).toEqual([50, 0, 50]);
  });

  it("refuses to guess when nobody has any weight", () => {
    // A fill with no trips: handing the whole bill to whoever sorts first would
    // be worse than declining to split it at all.
    expect(apportion(100, [0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("returns nothing for nobody", () => {
    expect(apportion(100, [])).toEqual([]);
  });

  it("is deterministic when weights tie", () => {
    const once = apportion(10, [1, 1, 1]);
    const twice = apportion(10, [1, 1, 1]);
    expect(once).toEqual(twice);
    expect(once).toEqual([4, 3, 3]);
  });

  it("rejects a total that is not a whole number of units", () => {
    // 72.40 euros must arrive as 7240 cents, or the rounding is already lost.
    expect(() => apportion(72.4, [1, 1])).toThrow();
    expect(() => apportion(-1, [1, 1])).toThrow();
  });

  it("rejects weights that are negative or not numbers", () => {
    expect(() => apportion(100, [1, -1])).toThrow();
    expect(() => apportion(100, [1, Number.NaN])).toThrow();
    expect(() => apportion(100, [1, Number.POSITIVE_INFINITY])).toThrow();
  });
});

describe("apportionAmong", () => {
  it("keeps each share with the thing it belongs to", () => {
    const people = [
      { name: "Giulia", km: 175 },
      { name: "Edoardo", km: 135 },
    ];
    const split = apportionAmong(7240, people, (person) => person.km);

    expect(split.map((row) => row.item.name)).toEqual(["Giulia", "Edoardo"]);
    expect(split.map((row) => row.units)).toEqual([4087, 3153]);
    expect(sums(split.map((row) => row.units))).toBe(7240);
  });

  it("reports the exact fraction, not the rounded one", () => {
    const split = apportionAmong(100, [1, 1, 1], (weight) => weight);
    expect(split.every((row) => Math.abs(row.fraction - 1 / 3) < 1e-12)).toBe(true);
  });

  it("reports a zero fraction when nobody has driven", () => {
    const split = apportionAmong(100, [0, 0], (weight) => weight);
    expect(split.map((row) => row.fraction)).toEqual([0, 0]);
    expect(split.map((row) => row.units)).toEqual([0, 0]);
  });
});
