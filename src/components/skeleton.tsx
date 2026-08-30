/**
 * Placeholder blocks shown while a page's data loads.
 *
 * Sized to roughly match what replaces them, so the layout does not jump when
 * the real content arrives.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 rounded-xl border p-6">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-64" />
      <div className="space-y-2 pt-2">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} className="h-4 w-full" />
        ))}
      </div>
    </div>
  );
}
