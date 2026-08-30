import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCar } from "@/lib/cars";
import { requireUser } from "@/lib/dal";
import { listFills } from "@/lib/fills";
import { formatKm, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "History" };

type Props = { params: Promise<{ carId: string }> };

export default async function HistoryPage({ params }: Props) {
  const { carId } = await params;
  const user = await requireUser();

  const car = await getCar(carId);
  if (!car) notFound();

  const fills = await listFills(carId, car.currency);

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Link
          href={`/cars/${car.id}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← {car.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Past fills</h1>

        {fills.length === 0 ? (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Nothing settled yet</CardTitle>
              <CardDescription>
                Once someone records a fill, the split lands here and stays.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="mt-6 space-y-4">
            {fills.map((fill) => (
              <li key={fill.id}>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-baseline justify-between gap-3">
                      <span>{formatMoney(fill.totalCents, fill.currency)}</span>
                      <span className="text-sm font-normal text-muted-foreground">
                        {formatDate(fill.filledOn)}
                      </span>
                    </CardTitle>
                    <CardDescription>
                      {fill.paidByYou ? "You paid" : `${fill.paidByName} paid`} ·{" "}
                      {formatKm(Math.round(fill.totalKm))} covered
                      {fill.odometerKm !== null ? ` · at ${formatKm(fill.odometerKm)}` : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="divide-y">
                      {fill.shares.map((share) => (
                        <li
                          key={share.userId}
                          className="flex items-baseline justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0"
                        >
                          <span className="min-w-0 truncate">
                            {share.displayName}
                            {share.isYou ? (
                              <span className="text-muted-foreground"> (you)</span>
                            ) : null}
                            {share.userId === fill.paidBy ? (
                              <span className="text-muted-foreground"> · paid</span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-muted-foreground tabular-nums">
                            {formatKm(share.displayKm)}
                          </span>
                          <span className="w-20 shrink-0 text-right tabular-nums">
                            {formatMoney(share.amountCents, fill.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {!fill.paidByYou && fill.yourAmountCents > 0 ? (
                      <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">
                        You owed {fill.paidByName}{" "}
                        <span className="font-medium">
                          {formatMoney(fill.yourAmountCents, fill.currency)}
                        </span>{" "}
                        for this fill.
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

/** Dates are stored as plain calendar days, so parse them as such. */
function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
