import { Activity } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="pt-safe flex min-h-dvh items-center justify-center px-5">
      <div className="w-full max-w-[360px]">
        <div className="mb-10 flex flex-col items-center text-center">
          <span className="mb-5 grid size-12 place-items-center rounded-[14px] bg-foreground text-background">
            <Activity className="size-6" strokeWidth={2.4} />
          </span>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Forma</h1>
          <p className="mt-1.5 text-[15px] text-muted-foreground">Train with intent. Progress with evidence.</p>
        </div>
        <LoginForm next={sp.next} initialError={sp.error} />
      </div>
    </div>
  );
}
