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

/**
 * A calendar day, as stored in a `date` column.
 *
 * Parsed as UTC on purpose. `new Date("2026-08-30")` is midnight UTC, which in
 * any timezone behind it is still the 29th — so a trip logged on the 30th would
 * display as the 29th to anyone west of Greenwich. Reading the parts and
 * formatting in UTC keeps the day the one that was actually recorded.
 *
 * The locale is fixed rather than the reader's: this renders on the server,
 * whose locale is nobody's, and a fixed one at least renders the same for
 * everyone looking at the same car.
 */
export function formatDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;

  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A moment in time — an invite expiry — as a calendar day. */
export function formatInstantAsDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
