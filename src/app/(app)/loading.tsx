import { Skeleton } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-48" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
