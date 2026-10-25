"use client";
import { cn } from "@/lib/utils";

export function Segmented<T extends string>({
  value, onChange, options, className, size = "md",
}: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; className?: string; size?: "sm" | "md" }) {
  return (
    <div role="tablist" className={cn("inline-flex rounded-md bg-subtle p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "whitespace-nowrap rounded-[10px] px-3 font-medium text-muted-foreground transition-all",
            size === "sm" ? "h-7 text-[12px]" : "h-8 text-[13px]",
            value === o.value && "bg-card text-foreground shadow-sm",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
