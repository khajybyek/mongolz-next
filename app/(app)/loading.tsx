import { Skeleton } from "@/components/ui/skeleton";

/** Route-level loading UI — sidebar navigation now gives immediate feedback. */
export default function AppLoading() {
  return (
    <div className="space-y-4 animate-fade-in" aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64 mt-4" />
    </div>
  );
}
