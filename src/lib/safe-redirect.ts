/**
 * Redirect target validation.
 *
 * Every `?next=` in the app passes through here. The value arrives from a query
 * string or a form field, so it is attacker-controlled: an unchecked redirect
 * lets a phishing link send someone from our real login page to a copy of it on
 * another host, with the address bar showing our domain until the moment they
 * hand over their password.
 *
 * Only same-site absolute paths survive. Everything else falls back to "/".
 */

const FALLBACK = "/";

// Control characters, including the tab, newline and carriage return that
// browsers strip from a URL before parsing it. That stripping is what turns
// "/\t/evil.com" into "//evil.com" after our checks have already run.
 
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export function safeRelativePath(value: unknown, fallback: string = FALLBACK): string {
  if (typeof value !== "string") return fallback;

  const candidate = value.trim();

  // Must be rooted, so "evil.com" and "../admin" cannot get through.
  if (!candidate.startsWith("/")) return fallback;

  // "//host" is a protocol-relative URL: browsers read it as another origin
  // even though it starts with a slash.
  if (candidate.startsWith("//")) return fallback;

  // Some browsers treat a backslash as a slash when resolving a URL, so
  // "/\evil.com" can escape the origin. Reject rather than normalise.
  if (candidate.includes("\\")) return fallback;

  if (CONTROL_CHARS.test(candidate)) return fallback;

  return candidate;
}

/** Reads one query param as a string, ignoring repeats. */
export function firstParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** The validated `?next=` of a page, or "/" when it is missing or unsafe. */
export function safeNextParam(params: Record<string, string | string[] | undefined>): string {
  return safeRelativePath(firstParam(params, "next"));
}

/** The validated `next` of a URL's search params, for route handlers. */
export function safeNextFromSearch(searchParams: URLSearchParams): string {
  return safeRelativePath(searchParams.get("next"));
}
