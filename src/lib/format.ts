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
