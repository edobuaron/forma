"use client";
import {
  Activity, BarChart3, CalendarDays, ChevronRight, Dumbbell, Home, LayoutList, MoreHorizontal, Ruler, Settings, Timer,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Today", icon: Home },
  { href: "/workout", label: "Workout", icon: Timer },
  { href: "/history", label: "History", icon: CalendarDays },
  { href: "/analytics", label: "Progress", icon: BarChart3 },
  { href: "/exercises", label: "Exercises", icon: Dumbbell },
  { href: "/programs", label: "Programs", icon: LayoutList },
  { href: "/body", label: "Body", icon: Ruler },
  { href: "/settings", label: "Settings", icon: Settings },
];
const MOBILE = [NAV[0], NAV[1], NAV[2], NAV[3], { href: "/more", label: "More", icon: MoreHorizontal }];

function active(path: string, href: string) {
  if (href === "/") return path === "/";
  if (href === "/more") return ["/more", "/exercises", "/programs", "/body", "/settings"].some((p) => path.startsWith(p));
  return path === href || path.startsWith(href + "/");
}

export function Shell({ children, inProgress }: { children: React.ReactNode; inProgress: { id: string; name: string } | null }) {
  const path = usePathname();
  const inWorkout = /^\/workout\/[^/]+$/.test(path);

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar px-3 py-5 md:flex">
        <Link href="/" className="mb-8 flex items-center gap-2.5 px-2.5">
          <span className="grid size-8 place-items-center rounded-[10px] bg-primary text-primary-foreground shadow-[0_6px_16px_-6px_var(--primary)]">
            <Activity className="size-[18px]" strokeWidth={2.6} />
          </span>
          <span className="text-[17px] font-bold tracking-[-0.03em]">Forma</span>
        </Link>
        <nav aria-label="Main" className="space-y-1">
          {NAV.map((n, i) => {
            const on = active(path, n.href);
            return (
              <Link
                key={n.href}
                href={n.href === "/workout" && inProgress ? `/workout/${inProgress.id}` : n.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "group relative flex h-10 items-center gap-3 rounded-md px-3 text-[14px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  on && "bg-accent-soft font-semibold text-foreground hover:bg-accent-soft",
                  i === 4 && "mt-5",
                )}
              >
                {on && <span aria-hidden className="absolute inset-y-2 -left-3 w-[3px] rounded-r-full bg-accent" />}
                <n.icon className={cn("size-[18px]", on && "text-accent")} strokeWidth={on ? 2.2 : 1.8} />
                {n.label}
              </Link>
            );
          })}
        </nav>
        {inProgress && !inWorkout && (
          <Link href={`/workout/${inProgress.id}`} className="mt-auto rounded-lg border border-accent/30 bg-accent-soft p-3 text-[13px] transition-colors hover:border-accent/60">
            <span className="flex items-center gap-2 font-semibold text-accent">
              <span className="relative flex size-2"><span className="absolute inset-0 animate-ping rounded-full bg-accent/60" /><span className="relative size-2 rounded-full bg-accent" /></span>
              Workout in progress
            </span>
            <span className="mt-1 block truncate font-medium text-foreground">{inProgress.name}</span>
            <span className="mt-0.5 block text-muted-foreground">Resume</span>
          </Link>
        )}
      </aside>

      <main className={cn("min-w-0 flex-1", !inWorkout && "pb-32 md:pb-12")}>
        {inProgress && !inWorkout && (
          <Link
            href={`/workout/${inProgress.id}`}
            className="pt-safe sticky top-0 z-30 flex items-center justify-between gap-3 bg-primary px-4 py-2.5 text-[14px] font-semibold text-primary-foreground md:hidden"
          >
            <span className="flex min-w-0 items-center gap-2"><span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-primary-foreground" /><span className="truncate">{inProgress.name} in progress</span></span>
            <span className="flex shrink-0 items-center gap-1">Resume <ChevronRight className="size-4" /></span>
          </Link>
        )}
        <div className={cn(!inWorkout && "mx-auto w-full max-w-6xl px-4 pt-6 md:px-8 md:pt-10", !inWorkout && !inProgress && "pt-safe")}>
          {children}
        </div>
      </main>

      {/* Mobile tab bar */}
      {!inWorkout && (
        <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-sidebar/90 backdrop-blur-xl md:hidden">
          <div className="mx-auto grid h-[64px] max-w-md grid-cols-5">
            {MOBILE.map((n) => {
              const on = active(path, n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href === "/workout" && inProgress ? `/workout/${inProgress.id}` : n.href}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors active:text-foreground",
                    on && "font-semibold text-foreground",
                  )}
                >
                  <span className={cn("grid h-8 w-14 place-items-center rounded-full transition-colors", on && "bg-accent-soft")}>
                    <n.icon className={cn("size-[21px]", on && "text-accent")} strokeWidth={on ? 2.2 : 1.8} />
                  </span>
                  {n.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
