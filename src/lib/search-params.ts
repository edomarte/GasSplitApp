/** Reads one query param as a string, ignoring repeats. */
export function firstParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** Same-site relative path only, so `?next=` can never become an open redirect. */
export function safeNextParam(
  params: Record<string, string | string[] | undefined>,
): string {
  const next = firstParam(params, "next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
