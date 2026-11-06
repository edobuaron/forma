"use client";
import { Ban, Flag, MoreHorizontal, UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/dropdown";
import { Textarea } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { blockUser, removeFriend, report, type ReportTarget } from "@/lib/data/social";
import { initials, REPORT_REASONS, reportMessage, type ReportReason } from "@/lib/domain/social";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

/** Text that depends on the viewer's clock, time zone or locale. Rendered only in the browser, so the
 *  server (which doesn't know the viewer's zone) never renders a different time. */
export function Local({ children }: { children: () => React.ReactNode }) {
  return useMounted() ? <>{children()}</> : null;
}

/** Stable hue per person, so the same friend always has the same colour. */
export function avatarHue(key: string): number {
  // FNV-1a, then a golden-ratio spread so similar ids still land on clearly different hues.
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return Math.floor(((h * 0.6180339887) % 1) * 360);
}

/** Avatars load photos through /api/avatar unless turned off (fixture previews have no account). */
const AvatarPhotos = createContext(true);
export function AvatarPhotosProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <AvatarPhotos.Provider value={enabled}>{children}</AvatarPhotos.Provider>;
}

/**
 * The person's photo when they set one and the viewer may see it, otherwise initials from the chosen
 * display name. `photo`: a version string when known, null when known to have none, undefined to try.
 * `src` overrides the source (a local preview while editing).
 */
export function Avatar({ name, id, className, photo, src }: { name: string; id?: string; className?: string; photo?: string | null; src?: string | null }) {
  const hue = avatarHue(id ?? name);
  const live = useContext(AvatarPhotos);
  const [loaded, setLoaded] = useState<string | null>(null);
  const url = src ?? (live && id && photo !== null ? `/api/avatar/${id}${photo ? `?v=${photo}` : ""}` : null);
  return (
    <span aria-hidden className={cn("relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-full text-[14px] font-bold tracking-tight text-white", className)}
      style={{ background: `linear-gradient(140deg, oklch(0.66 0.15 ${hue}), oklch(0.5 0.17 ${(hue + 40) % 360}))` }}>
      {initials(name)}
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- private, per-viewer image served by our own route
        <img src={url} alt="" loading="lazy" decoding="async" draggable={false}
          onLoad={() => setLoaded(url)} onError={() => setLoaded(null)}
          className={cn("absolute inset-0 size-full object-cover transition-opacity duration-200", loaded === url ? "opacity-100" : "opacity-0")} />
      )}
    </span>
  );
}

/** Quiet empty state: a short title, one line, and the actions that fix it. */
export function Empty({ title, children, actions, className }: { title: string; children?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("px-2 py-8 text-center", className)}>
      <p className="text-[16px] font-semibold tracking-tight">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-xs text-[14px] text-muted-foreground">{children}</p>}
      {actions && <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("overflow-hidden rounded-lg border bg-card shadow-card", className)}>{children}</div>;
}

export type ReportSubject = { type: ReportTarget; id: string; user: string; label: string };

/** Report sheet: a reason is required; details are optional. The server stores it for review. */
export function ReportSheet({ subject, onClose, onReported }: { subject: ReportSubject | null; onClose: () => void; onReported?: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!subject || !reason) return;
    setBusy(true);
    try {
      const r = await report(createClient(), { type: subject.type, id: subject.id, user: subject.user, reason, details });
      if (r === "reported" || r === "already_reported") { toast.success(reportMessage(r)); onReported?.(); onClose(); setReason(null); setDetails(""); }
      else toast.error(reportMessage(r));
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Sheet open={!!subject} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent title={`Report ${subject?.label ?? ""}`} description="Reports are reviewed. The person isn't told who reported them.">
        <fieldset className="space-y-2">
          <legend className="sr-only">Reason</legend>
          {REPORT_REASONS.map((r) => (
            <label key={r.value} className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3", reason === r.value && "border-accent bg-accent-soft")}>
              <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="size-4 accent-[var(--accent)]" />
              <span className="text-[14px] font-medium">{r.label}</span>
            </label>
          ))}
        </fieldset>
        <Textarea className="mt-3" maxLength={500} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Anything else we should know (optional)" aria-label="Details" />
        <p className="mt-2 text-[12.5px] text-muted-foreground">You can also block this person so they can't contact you.</p>
        <Button variant="primary" size="lg" className="mt-4 w-full" disabled={!reason || busy} onClick={send}>{busy ? "Sending…" : "Send report"}</Button>
      </SheetContent>
    </Sheet>
  );
}

/** Remove friend, block and report for one person. Everything is enforced by the database. */
export function PersonMenu({ userId, name, isFriend, onChanged }: { userId: string; name: string; isFriend: boolean; onChanged?: () => void }) {
  const router = useRouter();
  const [reporting, setReporting] = useState<ReportSubject | null>(null);
  const done = () => { onChanged?.(); router.refresh(); };
  return (
    <>
      <Menu>
        <MenuTrigger className="grid size-11 place-items-center rounded-full outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Options for ${name}`}>
          <MoreHorizontal className="size-5" />
        </MenuTrigger>
        <MenuContent>
          {isFriend && (
            <MenuItem onSelect={async () => {
              if (!confirm(`Remove ${name} from your friends? You won't be able to message each other until you reconnect.`)) return;
              try { await removeFriend(createClient(), userId); toast.success(`${name} removed`); done(); } catch (e) { toast.error((e as Error).message); }
            }}><UserMinus /> Remove friend</MenuItem>
          )}
          <MenuItem onSelect={() => setReporting({ type: "user", id: userId, user: userId, label: name })}><Flag /> Report</MenuItem>
          <MenuSeparator />
          <MenuItem destructive onSelect={async () => {
            if (!confirm(`Block ${name}? You'll stop being friends, they can't message, invite or find you, and they won't be told.`)) return;
            try { await blockUser(createClient(), userId); toast.success(`${name} blocked`); done(); } catch (e) { toast.error((e as Error).message); }
          }}><Ban /> Block</MenuItem>
        </MenuContent>
      </Menu>
      <ReportSheet subject={reporting} onClose={() => setReporting(null)} />
    </>
  );
}
