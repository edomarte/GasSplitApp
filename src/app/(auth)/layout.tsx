import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) redirect("/setup");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <span aria-hidden="true">⛽</span>
        <span>Gas Split</span>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
