export const metadata = { title: "Offline" };
export const dynamic = "force-static";

export default function Offline() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6 text-center">
      <div className="max-w-sm">
        <h1 className="text-[26px] font-bold tracking-[-0.03em]">You&apos;re offline</h1>
        <p className="mt-2 text-[14px] text-muted-foreground">
          Forma needs a connection to load pages. If you were mid-workout, changes you made are kept on this device and will sync when you reconnect.
        </p>
      </div>
    </div>
  );
}
