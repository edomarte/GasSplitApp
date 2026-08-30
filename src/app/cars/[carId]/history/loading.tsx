import { CardSkeleton, Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-2 h-8 w-40" />
      <div className="mt-6 space-y-4">
        <CardSkeleton rows={3} />
        <CardSkeleton rows={3} />
      </div>
    </main>
  );
}
