"use client";
import { Ban, Flag, MoreHorizontal, UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/dropdown";
import { Textarea } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { blockUser, removeFriend, report, type ReportTarget } from "@/lib/data/social";
import { initials, REPORT_REASONS, reportMessage, type ReportReason } from "@/lib/domain/social";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** Initials avatar from the chosen display name. No photos, no other personal data. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-[14px] font-bold text-accent", className)}>
      {initials(name)}
    </span>
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
