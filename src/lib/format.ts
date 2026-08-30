/**
 * Display formatting.
 *
 * These run on the server, where `toLocaleString()` with no locale would follow
 * whatever the host is set to — "92.450" on one machine and "92,450" on another,
 * for the same number. Worse, a reader in the wrong locale sees "92.450 km" as
 * ninety-two point four five. A narrow no-break space groups the digits without
 * claiming a decimal convention, so the reading is the same everywhere.
 */

const NARROW_NBSP = "\u202f";

export function formatKm(km: number): string {
  const grouped = Math.round(km)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NBSP);
  return `${grouped}${NARROW_NBSP}km`;
}

/** Symbols for the currencies a shared car is plausibly billed in. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€",
  GBP: "£",
  USD: "$",
  CHF: "CHF ",
};

/**
 * Money, from integer cents.
 *
 * Deliberately not `Intl.NumberFormat`: this runs on the server, and the
 * server's locale is not the reader's. A settlement email that says "72,40" to
 * one member and "72.40" to another, for the same fill, invites exactly the
 * argument the app exists to prevent.
 */
export function formatMoney(cents: number, currency = "EUR"): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  const negative = cents < 0;
  const absolute = Math.abs(Math.round(cents));
  const units = Math.floor(absolute / 100);
  const remainder = String(absolute % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${symbol}${units}.${remainder}`;
}
