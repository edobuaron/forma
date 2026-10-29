import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badge = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular leading-4 [&_svg]:size-3", {
  variants: {
    tone: {
      neutral: "bg-subtle text-muted-foreground",
      accent: "bg-accent-soft text-accent",
      positive: "bg-positive-soft text-positive",
      negative: "bg-negative-soft text-negative",
      record: "bg-record-soft text-record",
      outline: "border text-muted-foreground",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...p} />;
}
