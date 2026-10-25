"use client";
import {
  Activity, BarChart3, CalendarDays, Dumbbell, Home, LayoutList, MoreHorizontal, Ruler, Settings, Timer,
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
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-card/40 px-3 py-5 md:flex">
        <Link href="/" className="mb-7 flex items-center gap-2 px-3">
          <span className="grid size-7 place-items-center rounded-lg bg-foreground text-background">
            <Activity className="size-4" strokeWidth={2.5} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Forma</span>
        </Link>
        <nav className="space-y-0.5">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "flex h-9 items-center gap-3 rounded-md px-3 text-[14px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                active(path, n.href) && "bg-muted font-medium text-foreground",
              )}
            >
              <n.icon className="size-[17px]" strokeWidth={1.8} />
              {n.label}
            </Link>
          ))}
        </nav>
        {inProgress && !inWorkout && (
          <Link href={`/workout/${inProgress.id}`} className="mt-auto rounded-lg border bg-card p-3 text-[13px] hover:bg-muted">
            <span className="flex items-center gap-2 font-medium">
              <span className="size-2 animate-pulse rounded-full bg-accent" /> In progress
            </span>
            <span className="mt-0.5 block truncate text-muted-foreground">{inProgress.name} · Resume</span>
          </Link>
        )}
      </aside>

      <main className={cn("min-w-0 flex-1", !inWorkout && "pb-28 md:pb-10")}>
        {inProgress && !inWorkout && (
          <Link
            href={`/workout/${inProgress.id}`}
            className="pt-safe sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-accent px-4 py-2.5 text-[14px] font-medium text-accent-foreground md:hidden"
          >
            <span className="truncate">{inProgress.name} in progress</span>
            <span>Resume →</span>
          </Link>
        )}
        <div className={cn(!inWorkout && "mx-auto w-full max-w-6xl px-4 pt-6 md:px-8 md:pt-10", !inWorkout && !inProgress && "pt-safe")}>
          {children}
        </div>
      </main>

      {/* Mobile tab bar */}
      {!inWorkout && (
        <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-background/85 backdrop-blur-xl md:hidden">
          <div className="mx-auto grid h-[58px] max-w-md grid-cols-5">
            {MOBILE.map((n) => (
              <Link
                key={n.href}
                href={n.href === "/workout" && inProgress ? `/workout/${inProgress.id}` : n.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 text-[10.5px] font-medium text-muted-foreground",
                  active(path, n.href) && "text-foreground",
                )}
              >
                <n.icon className={cn("size-[22px]", active(path, n.href) && "text-accent")} strokeWidth={1.8} />
                {n.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
