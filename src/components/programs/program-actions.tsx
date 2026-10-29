"use client";
import { Loader2, Plus, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { addStarterProgram, createProgram } from "@/lib/data/mutations";
import { createClient } from "@/lib/supabase/client";

export function NewProgramButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="primary" size="sm" disabled={busy} onClick={async () => {
      const name = prompt("Program name");
      if (!name?.trim()) return;
      setBusy(true);
      try {
        const p = await createProgram(createClient(), name.trim());
        router.push(`/programs/${p.id}`);
      } catch (e) { toast.error((e as Error).message); setBusy(false); }
    }}>
      {busy ? <Loader2 className="animate-spin" /> : <Plus />} New
    </Button>
  );
}

/** Adds a fresh copy of the starter program. Never automatic; existing programs are untouched. */
export function AddStarterButton({ variant = "outline" }: { variant?: "outline" | "primary" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button variant={variant} size="sm" disabled={busy} onClick={async () => {
      if (!confirm("Add a fresh copy of the 4-day starter program? Your existing programs and history won't change.")) return;
      setBusy(true);
      try {
        const id = await addStarterProgram(createClient());
        toast.success("Starter program added");
        router.push(`/programs/${id}`);
      } catch (e) { toast.error((e as Error).message); setBusy(false); }
    }}>
      {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} Add starter program again
    </Button>
  );
}
