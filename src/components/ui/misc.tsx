import * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-subtle/70", className)} {...p} />;
}

export function PageHeader({ title, subtitle, actions, className }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 md:mb-8", className)}>
      <div className="min-w-0">
        <h1 className="text-[30px] font-bold leading-[1.1] tracking-[-0.03em] md:text-[36px]">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[14px] text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** An empty screen says what will appear and how to get there. */
export function EmptyState({ icon, title, children, action, className }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed border-input bg-muted/40 px-6 py-12 text-center", className)}>
      {icon && <div className="mb-4 grid size-12 place-items-center rounded-full bg-accent-soft text-accent [&_svg]:size-[22px]">{icon}</div>}
      <p className="text-[16px] font-semibold tracking-tight">{title}</p>
      {children && <p className="mt-1.5 max-w-sm text-[14px] leading-relaxed text-muted-foreground">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[12.5px] font-medium text-muted-foreground">{label}</p>
      <p className="num mt-1 text-[26px] leading-tight">{value}</p>
      {sub && <p className="mt-0.5 text-[12.5px] text-muted-foreground tabular">{sub}</p>}
    </div>
  );
}

/** Section heading inside a page, outside any panel. */
export function SectionTitle({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-baseline justify-between gap-3", className)}>
      <h2 className="text-[17px] font-semibold tracking-[-0.015em]">{children}</h2>
      {action}
    </div>
  );
}
