"use client";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createProgram } from "@/lib/data/mutations";
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
