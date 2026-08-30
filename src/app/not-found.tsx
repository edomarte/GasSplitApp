import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * Also what a member of no car sees when they guess a car id: RLS turns "not
 * yours" into "no row", so this page must not hint that the thing exists.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <span aria-hidden="true" className="text-3xl">
        ⛽
      </span>
      <h1 className="text-xl font-semibold tracking-tight">Not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        This page does not exist, or it belongs to a car you are not part of.
      </p>
      <Button asChild>
        <Link href="/">Go to your cars</Link>
      </Button>
    </main>
  );
}
