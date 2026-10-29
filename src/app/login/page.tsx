import { Activity } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="pt-safe relative flex min-h-dvh items-center justify-center overflow-hidden px-5">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 size-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-3xl" />
      <div className="relative w-full max-w-[380px]">
        <div className="mb-10 flex flex-col items-center text-center">
          <span className="mb-5 grid size-14 place-items-center rounded-[16px] bg-primary text-primary-foreground shadow-[0_10px_30px_-10px_var(--primary)]">
            <Activity className="size-6" strokeWidth={2.4} />
          </span>
          <h1 className="text-[32px] font-bold tracking-[-0.035em]">Forma</h1>
          <p className="mt-1.5 text-[15px] text-muted-foreground">Train with intent. Progress with evidence.</p>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-raised sm:p-6"><LoginForm next={sp.next} initialError={sp.error} /></div>
      </div>
    </div>
  );
}
