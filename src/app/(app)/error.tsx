"use client";
import { Button } from "@/components/ui/button";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <p className="text-[20px] font-bold tracking-tight">Something went wrong</p>
      <p className="mt-2 text-[14px] text-muted-foreground">{error.message || "The page couldn't load. Your data is safe."}</p>
      <Button variant="primary" className="mt-6" onClick={reset}>Try again</Button>
    </div>
  );
}
