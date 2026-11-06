import { ArrowLeft, Inbox, SquarePlus, UserRound } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** The one header used across Community: title, back link on sub-pages, share, inbox, profile. */
export function CommunityHeader({ title, back, unread = 0, actions, showNav = true }: {
  title: string; back?: { href: string; label: string }; unread?: number; actions?: React.ReactNode; showNav?: boolean;
}) {
  const icon = "relative grid size-11 place-items-center rounded-full text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <header className="mb-4 flex items-center gap-1">
      {back && (
        <Link href={back.href} aria-label={back.label} className={cn(icon, "-ml-2.5")}><ArrowLeft className="size-[22px]" /></Link>
      )}
      <h1 className="min-w-0 flex-1 truncate text-[24px] font-bold tracking-[-0.03em] md:text-[28px]">{title}</h1>
      {actions}
      {showNav && (
        <>
          <Link href="/community/share" aria-label="Share a workout" className={icon}><SquarePlus className="size-[23px]" strokeWidth={1.9} /></Link>
          <Link href="/community/inbox" aria-label={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"} className={icon}>
            <Inbox className="size-[23px]" strokeWidth={1.9} />
            {unread > 0 && (
              <span className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-destructive px-1 text-[10.5px] font-bold leading-none text-white">{unread > 99 ? "99+" : unread}</span>
            )}
          </Link>
          <Link href="/community/me" aria-label="Your profile" className={cn(icon, "-mr-2.5")}><UserRound className="size-[23px]" strokeWidth={1.9} /></Link>
        </>
      )}
    </header>
  );
}

export function Tabs({ items }: { items: { href: string; label: string; on: boolean }[] }) {
  return (
    <nav aria-label="Feed" className="mb-5 grid grid-cols-2 border-b">
      {items.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.on ? "page" : undefined}
          className={cn("relative flex h-11 items-center justify-center text-[14.5px] font-semibold transition-colors",
            t.on ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
          {t.label}
          {t.on && <span aria-hidden className="absolute inset-x-6 -bottom-px h-[2px] rounded-full bg-foreground" />}
        </Link>
      ))}
    </nav>
  );
}
