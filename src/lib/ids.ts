/**
 * Identifier shapes.
 *
 * Postgres rejects a malformed uuid with an error rather than an empty result,
 * so a typo in the address bar would surface as "something went wrong" instead
 * of a 404. Checking the shape before querying keeps a bad URL a bad URL.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
