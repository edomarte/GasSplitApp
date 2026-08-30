/**
 * Splitting a whole into integer parts that still add up to the whole.
 *
 * Rounding each share on its own loses or invents units: three people sharing
 * 100 km get 33.33 each, which rounds to 33, and 33 × 3 is 99. On a dashboard
 * that is a number that does not add up. On an invoice it is a missing cent,
 * and the sum of what everyone owes no longer equals what was paid.
 *
 * The largest-remainder method fixes this. Give everyone their whole units,
 * then hand the leftovers out one at a time to whoever was cut back hardest.
 * The result always sums to the total exactly, and no share is ever more than
 * one unit away from its exact value.
 *
 * This module is deliberately free of any database, framework or currency: it
 * is arithmetic, and it is used for both kilometres on screen and cents in a
 * settlement.
 */

/**
 * Distributes `total` whole units across `weights`, proportionally.
 *
 * `total` must be a non-negative integer — cents, not euros; kilometres, not
 * fractions of one. Weights may be fractional and need not sum to anything in
 * particular; only their ratios matter.
 *
 * Ties are broken by position, so the result is deterministic: given the same
 * input it always produces the same output, which matters when the numbers end
 * up in an email someone might check twice.
 */
export function apportion(total: number, weights: number[]): number[] {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(`apportion needs a non-negative whole total, got ${total}`);
  }
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
    throw new Error("apportion needs finite, non-negative weights");
  }

  if (weights.length === 0) return [];

  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);

  // Nobody has any claim on it. Refusing to guess is better than handing the
  // whole amount to whoever happens to be first in the list.
  if (weightTotal <= 0) return weights.map(() => 0);

  const exact = weights.map((weight) => (weight / weightTotal) * total);
  const floors = exact.map(Math.floor);
  const distributed = floors.reduce((sum, value) => sum + value, 0);

  let remaining = total - distributed;

  // Hand out the leftover units to the largest fractional parts first. The
  // count is bounded by the number of shares, so this cannot loop away.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const result = [...floors];
  for (const { index } of order) {
    if (remaining <= 0) break;
    result[index] += 1;
    remaining -= 1;
  }

  return result;
}

/**
 * The same split, described for a person: each share and what it is out of.
 * Useful for both the dashboard and the settlement email.
 */
export type Apportioned<T> = {
  item: T;
  units: number;
  /** Share of the total, 0–1, from the exact weights rather than the rounding. */
  fraction: number;
};

export function apportionAmong<T>(
  total: number,
  items: T[],
  weightOf: (item: T) => number,
): Apportioned<T>[] {
  const weights = items.map(weightOf);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const units = apportion(total, weights);

  return items.map((item, index) => ({
    item,
    units: units[index],
    fraction: weightTotal > 0 ? weights[index] / weightTotal : 0,
  }));
}
