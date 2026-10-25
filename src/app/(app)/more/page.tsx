import { ChevronRight, Dumbbell, LayoutList, Ruler, Settings } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/misc";

const ITEMS = [
  { href: "/programs", label: "Programs", sub: "Templates, schedule, versions", icon: LayoutList },
  { href: "/exercises", label: "Exercise library", sub: "Muscles, increments, progression", icon: Dumbbell },
  { href: "/body", label: "Body measurements", sub: "Bodyweight and circumferences", icon: Ruler },
  { href: "/settings", label: "Settings", sub: "Theme, units, timers, export", icon: Settings },
];

export default function MorePage() {
  return (
    <>
      <PageHeader title="More" />
      <div className="divide-y overflow-hidden rounded-lg border bg-card">
        {ITEMS.map((i) => (
          <Link key={i.href} href={i.href} className="flex items-center gap-4 px-4 py-3.5 active:bg-muted">
            <span className="grid size-9 place-items-center rounded-md bg-subtle"><i.icon className="size-[18px]" strokeWidth={1.8} /></span>
            <span className="flex-1">
              <span className="block text-[15px] font-medium">{i.label}</span>
              <span className="block text-[13px] text-muted-foreground">{i.sub}</span>
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </>
  );
}
