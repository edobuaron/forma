import { Suspense } from "react";
import { AuthScreen } from "./login-form";

export const metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="pt-safe relative flex min-h-dvh items-center justify-center overflow-hidden px-5 py-10">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 size-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-3xl" />
      <Suspense>
        <AuthScreen next={sp.next} initialError={sp.error} />
      </Suspense>
    </main>
  );
}
