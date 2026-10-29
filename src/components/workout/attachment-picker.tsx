"use client";
import { Archive, Check, Loader2, Pencil, Plus, Search, Trash2, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { attachmentLabel } from "@/lib/domain/sides";
import type { AttachmentRef } from "@/lib/domain/types";
import { createAttachment, removeAttachment, renameAttachment, restoreAttachment } from "@/lib/data/mutations";
import type { AttachmentRow } from "@/lib/data/types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring";
const row = cn("flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-[14.5px] hover:bg-muted", focusRing);

/** Compact chip showing the recorded attachment. "Not recorded" is dashed and muted, never shown as a choice made. */
export function AttachmentChip({ value, onClick, className }: { value: AttachmentRef | null | undefined; onClick?: () => void; className?: string }) {
  const recorded = !!value?.state;
  const label = attachmentLabel(value);
  const chip = (
    <span className={cn(
      "inline-flex h-7 max-w-full items-center gap-1 rounded-full border px-2.5 text-[12.5px] font-medium",
      recorded ? "bg-subtle text-foreground/85" : "border-dashed text-muted-foreground",
      className,
    )}>
      <span className="truncate">{recorded || !onClick ? label : "Attachment"}</span>
      {!recorded && onClick && <Plus aria-hidden className="size-3.5 shrink-0" />}
    </span>
  );
  if (!onClick) return chip;
  return (
    <button type="button" onClick={onClick} aria-haspopup="dialog" aria-label={`Attachment: ${label}. Change`}
      className={cn("inline-flex min-h-11 max-w-full items-center rounded-full", focusRing)}>
      {chip}
    </button>
  );
}

/**
 * Choose the attachment for a workout or an exercise default. Searchable; custom attachments can be
 * added, renamed and removed here. Removing one used in history archives it instead of deleting it.
 */
export function AttachmentPicker({ open, onOpenChange, value, attachments, onChange, onListChange, title = "Attachment" }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  value: AttachmentRef | null | undefined;
  attachments: AttachmentRow[];
  onChange: (v: AttachmentRef) => void;
  onListChange: (list: AttachmentRow[]) => void;
  title?: string;
}) {
  const [q, setQ] = useState("");
  const [manage, setManage] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const active = attachments.filter((a) => !a.archived_at);
  const archived = attachments.filter((a) => a.archived_at);
  const term = q.trim().toLowerCase();
  const shown = useMemo(() => active.filter((a) => a.name.toLowerCase().includes(term)), [active, term]);
  const exact = active.some((a) => a.name.trim().toLowerCase() === term);

  function pick(v: AttachmentRef) {
    onChange(v);
    onOpenChange(false);
    setQ("");
  }

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    try { return await fn(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  async function add() {
    const row = await run(() => createAttachment(createClient(), q));
    if (!row) return;
    onListChange([...attachments, row].sort((a, b) => a.name.localeCompare(b.name)));
    pick({ state: "attachment", id: row.id, name: row.name });
  }

  async function rename() {
    if (!editing || !editing.name.trim()) return;
    const ok = await run(async () => { await renameAttachment(createClient(), editing.id, editing.name); return true; });
    if (!ok) return;
    onListChange(attachments.map((a) => (a.id === editing.id ? { ...a, name: editing.name.trim() } : a)));
    setEditing(null);
    toast("Renamed. Past workouts keep the name they were logged with.");
  }

  async function remove(a: AttachmentRow) {
    const res = await run(() => removeAttachment(createClient(), a.id));
    if (!res) return;
    if (res === "archived") {
      onListChange(attachments.map((x) => (x.id === a.id ? { ...x, archived_at: new Date().toISOString() } : x)));
      toast(`${a.name} is used in past workouts, so it was archived. History still shows it.`);
    } else {
      onListChange(attachments.filter((x) => x.id !== a.id));
      toast(`${a.name} removed.`);
    }
  }

  async function restore(a: AttachmentRow) {
    const ok = await run(async () => { await restoreAttachment(createClient(), a.id); return true; });
    if (ok) onListChange(attachments.map((x) => (x.id === a.id ? { ...x, archived_at: null } : x)));
  }

  const selected = (v: AttachmentRef) => (value?.state ?? null) === v.state && (v.state !== "attachment" || value?.id === v.id);
  const mark = (on: boolean) => <Check aria-hidden className={cn("ml-auto size-4 shrink-0 text-accent", !on && "invisible")} />;

  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setManage(false); setEditing(null); } }}>
      <SheetContent title={title} description="Optional. Different attachments aren't compared for progression.">
        <div className="relative mb-2">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search attachments" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or add…" className="pl-9" maxLength={60} />
        </div>
        <ul className="space-y-0.5" aria-label="Attachments">
          {!term && !manage && (
            <>
              <li><button type="button" aria-pressed={selected({ state: null, id: null, name: null })} className={cn(row, "text-muted-foreground")} onClick={() => pick({ state: null, id: null, name: null })}>Not recorded {mark(selected({ state: null, id: null, name: null }))}</button></li>
              <li><button type="button" aria-pressed={selected({ state: "none", id: null, name: null })} className={row} onClick={() => pick({ state: "none", id: null, name: null })}>No attachment {mark(selected({ state: "none", id: null, name: null }))}</button></li>
              <li aria-hidden className="mx-3 my-1 border-t" />
            </>
          )}
          {shown.map((a) => (
            <li key={a.id} className="flex items-center gap-1">
              {editing?.id === a.id ? (
                <form className="flex flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
                  <Input aria-label="Attachment name" autoFocus value={editing.name} maxLength={60} onChange={(e) => setEditing({ id: a.id, name: e.target.value })} />
                  <button type="submit" disabled={busy} aria-label="Save name" className={cn("grid size-11 shrink-0 place-items-center rounded-full hover:bg-muted", focusRing)}><Check className="size-4" /></button>
                </form>
              ) : manage ? (
                <>
                  <span className="min-h-11 flex-1 truncate px-3 py-3 text-[14.5px]">{a.name}</span>
                  <button type="button" aria-label={`Rename ${a.name}`} onClick={() => setEditing({ id: a.id, name: a.name })} className={cn("grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted", focusRing)}><Pencil className="size-4" /></button>
                  <button type="button" aria-label={`Remove ${a.name}`} disabled={busy} onClick={() => void remove(a)} className={cn("grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted", focusRing)}><Trash2 className="size-4" /></button>
                </>
              ) : (
                <button type="button" aria-pressed={selected({ state: "attachment", id: a.id, name: a.name })} className={row} onClick={() => pick({ state: "attachment", id: a.id, name: a.name })}>
                  <span className="truncate">{a.name}</span> {mark(selected({ state: "attachment", id: a.id, name: a.name }))}
                </button>
              )}
            </li>
          ))}
          {term && !exact && (
            <li>
              <button type="button" disabled={busy} className={cn(row, "font-medium text-accent")} onClick={() => void add()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add “{q.trim()}”
              </button>
            </li>
          )}
          {term && shown.length === 0 && exact && <li className="px-3 py-2 text-[13px] text-muted-foreground">No match.</li>}
        </ul>
        {manage && archived.length > 0 && (
          <div className="mt-4">
            <p className="mb-1 px-3 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Archived · kept for history</p>
            <ul className="space-y-0.5">
              {archived.map((a) => (
                <li key={a.id} className="flex items-center gap-1">
                  <span className="min-h-11 flex-1 truncate px-3 py-3 text-[14px] text-muted-foreground"><Archive aria-hidden className="mr-1.5 inline size-3.5" />{a.name}</span>
                  <button type="button" aria-label={`Restore ${a.name}`} disabled={busy} onClick={() => void restore(a)} className={cn("grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted", focusRing)}><Undo2 className="size-4" /></button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button type="button" onClick={() => { setManage((m) => !m); setEditing(null); }} className={cn("mt-3 h-11 w-full rounded-md text-[13.5px] font-medium text-muted-foreground hover:bg-muted", focusRing)}>
          {manage ? "Done" : "Edit attachments"}
        </button>
      </SheetContent>
    </Sheet>
  );
}
