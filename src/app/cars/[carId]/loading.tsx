import { CardSkeleton, Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="mt-2 h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-32" />
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Skeleton className="h-9 w-full sm:w-28" />
        <Skeleton className="h-9 w-full sm:w-32" />
      </div>
      <div className="mt-4 space-y-4">
        <CardSkeleton rows={3} />
        <CardSkeleton rows={2} />
      </div>
    </main>
  );
}
