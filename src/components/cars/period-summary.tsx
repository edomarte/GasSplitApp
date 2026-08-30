import { formatKm } from "@/lib/format";
import type { OpenPeriod } from "@/lib/trips";

/**
 * Kilometres driven since the last fill, per member.
 *
 * The bar is the share of the period, which is exactly the proportion each
 * person will be charged. Showing the proportion rather than only the distance
 * means the split is not a surprise when the fill is recorded.
 */
export function PeriodSummary({
  period,
  tripCount,
}: {
  period: OpenPeriod;
  tripCount: number;
}) {
  if (period.totalKm === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No trips logged since the last fill. Add one to start the next split.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{formatKm(period.displayTotalKm)}</span> driven
        across {tripCount === 1 ? "one trip" : `${tripCount} trips`}.
      </p>

      <ul className="space-y-3">
        {period.perMember.map((member) => (
          <li key={member.userId} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                {member.displayName}
                {member.isYou ? <span className="text-muted-foreground"> (you)</span> : null}
                {member.hasLeft ? (
                  <span className="text-muted-foreground"> (left the car)</span>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums">
                {formatKm(member.displayKm)}
                <span className="ml-2 text-muted-foreground">
                  {Math.round(member.share * 100)}%
                </span>
              </span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={`${member.displayName}: ${Math.round(member.share * 100)} percent of the distance`}
            >
              <div
                className="h-full rounded-full bg-foreground"
                style={{ width: `${Math.max(member.share * 100, member.km > 0 ? 2 : 0)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
