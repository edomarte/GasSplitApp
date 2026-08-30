"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * Shown when a page throws.
 *
 * Deliberately vague on screen and specific in the console: a stack trace or a
 * database message on the page tells an attacker about the schema and tells the
 * user nothing they can act on.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] unhandled error", error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The page could not be loaded. This is usually temporary.
      </p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" asChild>
          {/* A real navigation, not a client-side one. Whatever threw may have
              left the router in a state that a soft transition inherits. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/">Go to your cars</a>
        </Button>
      </div>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">Reference: {error.digest}</p>
      ) : null}
    </main>
  );
}
