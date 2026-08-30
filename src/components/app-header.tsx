import Link from "next/link";

import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import type { SessionUser } from "@/lib/dal";

export function AppHeader({ user }: { user: SessionUser }) {
  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3">
        <span className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden="true">⛽</span>
          Gas Split
        </span>
        <div className="flex items-center gap-3">
          <Link
            href="/account/password"
            className="hidden text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:inline"
            title="Change password"
          >
            {user.email}
          </Link>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
