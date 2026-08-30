/**
 * Reading money that a person typed.
 *
 * Someone standing at a pump writes "72.40", "72,40", "72.4" or "€ 72,40" and
 * means the same thing every time. None of those may become a float: the whole
 * settlement is integer cents, and a float here would put the rounding error
 * back in at the very first step.
 */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input
    .trim()
    .replace(/[\s\u00a0\u202f]/g, "")
    // Strip a leading currency symbol, but never a minus sign: a negative
    // fill cost has to be refused, not quietly turned positive.
    .replace(/^[^\d,.\-]+/, "")
    .replace(",", ".");

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const [units, fraction = ""] = cleaned.split(".");
  const cents = Number(units) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}
